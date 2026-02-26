const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const {
  BedrockAgentCoreControlClient,
  ListAgentRuntimesCommand,
  GetAgentRuntimeCommand,
  ListAgentRuntimeEndpointsCommand,
  ListGatewaysCommand,
  GetGatewayCommand,
  ListGatewayTargetsCommand,
} = require('@aws-sdk/client-bedrock-agentcore-control');
const {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} = require('@aws-sdk/client-bedrock-agentcore');

const app = express();
const PORT = process.env.PORT || 3000;
const REGION = process.env.AWS_REGION || 'us-east-1';

const controlClient = new BedrockAgentCoreControlClient({ region: REGION });
const dataClient = new BedrockAgentCoreClient({ region: REGION });

app.use(express.json());
app.use(cookieParser());

// ─── Auth ───
const CREDENTIALS = { username: process.env.APP_USERNAME || 'admin', password: process.env.APP_PASSWORD || 'P@ssw0rd' };
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const sessions = new Map();

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  return token;
}

function isAuthenticated(req) {
  const token = req.cookies?.session;
  return token && sessions.has(token);
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
    const token = createSession();
    res.cookie('session', token, { httpOnly: true, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// Session check
app.get('/api/me', (req, res) => {
  if (isAuthenticated(req)) return res.json({ ok: true });
  res.status(401).json({ error: 'Not authenticated' });
});

// Logout
app.post('/api/logout', (req, res) => {
  const token = req.cookies?.session;
  if (token) sessions.delete(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

// Health check (always open)
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Auth guard — before static serving
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html' || req.path === '/health' ||
      req.path.endsWith('.css') || req.path.endsWith('.js') ||
      req.path.startsWith('/api/login') || req.path.startsWith('/api/me') || req.path.startsWith('/api/logout')) {
    return next();
  }
  if (req.path === '/chat.html') {
    if (!isAuthenticated(req)) return res.redirect('/');
    return next();
  }
  if (req.path.startsWith('/api/') && !isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// List all agent runtimes
app.get('/api/agents', async (_, res) => {
  try {
    const agents = [];
    let nextToken;
    do {
      const resp = await controlClient.send(new ListAgentRuntimesCommand({
        maxResults: 100,
        nextToken,
      }));
      agents.push(...(resp.agentRuntimes || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    res.json(agents);
  } catch (err) {
    console.error('ListAgentRuntimes error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get agent runtime detail
app.get('/api/agents/:id', async (req, res) => {
  try {
    const resp = await controlClient.send(new GetAgentRuntimeCommand({
      agentRuntimeId: req.params.id,
    }));
    res.json(resp);
  } catch (err) {
    console.error('GetAgentRuntime error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List agent runtime endpoints
app.get('/api/agents/:id/endpoints', async (req, res) => {
  try {
    const endpoints = [];
    let nextToken;
    do {
      const resp = await controlClient.send(new ListAgentRuntimeEndpointsCommand({
        agentRuntimeId: req.params.id,
        maxResults: 100,
        nextToken,
      }));
      endpoints.push(...(resp.agentRuntimeEndpoints || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    res.json(endpoints);
  } catch (err) {
    console.error('ListAgentRuntimeEndpoints error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List all gateways
app.get('/api/gateways', async (_, res) => {
  try {
    const gateways = [];
    let nextToken;
    do {
      const resp = await controlClient.send(new ListGatewaysCommand({
        maxResults: 100,
        nextToken,
      }));
      gateways.push(...(resp.items || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    res.json(gateways);
  } catch (err) {
    console.error('ListGateways error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get gateway detail (includes endpoint URL)
app.get('/api/gateways/:id', async (req, res) => {
  try {
    const resp = await controlClient.send(new GetGatewayCommand({
      gatewayId: req.params.id,
    }));
    res.json(resp);
  } catch (err) {
    console.error('GetGateway error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List gateway targets (MCP tools come from targets)
app.get('/api/gateways/:id/targets', async (req, res) => {
  try {
    const targets = [];
    let nextToken;
    do {
      const resp = await controlClient.send(new ListGatewayTargetsCommand({
        gatewayIdentifier: req.params.id,
        maxResults: 100,
        nextToken,
      }));
      targets.push(...(resp.items || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    res.json(targets);
  } catch (err) {
    console.error('ListGatewayTargets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Invoke agent runtime - streaming SSE
app.post('/api/chat', async (req, res) => {
  const { agentRuntimeArn, prompt, sessionId, qualifier } = req.body;

  if (!agentRuntimeArn || !prompt) {
    return res.status(400).json({ error: 'agentRuntimeArn and prompt are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const payload = JSON.stringify({ prompt });

    const params = {
      agentRuntimeArn,
      payload: Buffer.from(payload),
      contentType: 'application/json',
      accept: 'text/event-stream',
    };
    if (sessionId) params.runtimeSessionId = sessionId;
    if (qualifier) params.qualifier = qualifier;

    const resp = await dataClient.send(new InvokeAgentRuntimeCommand(params));

    // Send back the session ID
    res.write(`event: session\ndata: ${JSON.stringify({ runtimeSessionId: resp.runtimeSessionId })}\n\n`);

    // Read the raw stream and filter to only meaningful events
    for await (const chunk of resp.response) {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.startsWith('data: ') ? line.slice(6) : line;
        if (!trimmed || trimmed.startsWith("'") || trimmed.startsWith('"\'') || trimmed.startsWith('"{\'')) continue;

        // Try parse as JSON — skip non-JSON debug dumps
        let parsed;
        try {
          parsed = JSON.parse(trimmed.replace(/^"(.*)"$/, '$1'));
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;

        // Skip internal lifecycle noise
        if (parsed.init_event_loop || parsed.start === true || parsed.start_event_loop || parsed.stop_event_loop) continue;

        // Forward clean event
        res.write(`data: ${JSON.stringify(parsed)}\n\n`);
      }
    }

    res.write('event: done\ndata: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('InvokeAgentRuntime error:', err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// SPA fallback — redirect to login
app.get('/{*splat}', (req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`AgentCore GUI server running on port ${PORT}`);
});
