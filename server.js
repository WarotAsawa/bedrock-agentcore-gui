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

// ─── Logging ───
function log(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

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
    log('error', 'ListAgentRuntimes failed', { error: err.message, code: err.name, requestId: err.$metadata?.requestId });
    res.status(500).json({ error: err.message });
  }
});

// Get agent runtime detail
app.get('/api/agents/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const resp = await controlClient.send(new GetAgentRuntimeCommand({ agentRuntimeId: id }));
    log('info', 'GetAgentRuntime', { agentRuntimeId: id, status: resp.status });
    res.json(resp);
  } catch (err) {
    log('error', 'GetAgentRuntime failed', { agentRuntimeId: id, error: err.message, code: err.name, requestId: err.$metadata?.requestId });
    res.status(500).json({ error: err.message });
  }
});

// List agent runtime endpoints
app.get('/api/agents/:id/endpoints', async (req, res) => {
  const { id } = req.params;
  try {
    const endpoints = [];
    let nextToken;
    do {
      const resp = await controlClient.send(new ListAgentRuntimeEndpointsCommand({
        agentRuntimeId: id,
        maxResults: 100,
        nextToken,
      }));
      endpoints.push(...(resp.agentRuntimeEndpoints || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    log('info', 'ListAgentRuntimeEndpoints', { agentRuntimeId: id, count: endpoints.length });
    res.json(endpoints);
  } catch (err) {
    log('error', 'ListAgentRuntimeEndpoints failed', { agentRuntimeId: id, error: err.message, code: err.name, requestId: err.$metadata?.requestId });
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
    log('error', 'ListGateways failed', { error: err.message, code: err.name, requestId: err.$metadata?.requestId });
    res.status(500).json({ error: err.message });
  }
});

// Get gateway detail (includes endpoint URL)
app.get('/api/gateways/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const resp = await controlClient.send(new GetGatewayCommand({ gatewayId: id }));
    log('info', 'GetGateway', { gatewayId: id, status: resp.status });
    res.json(resp);
  } catch (err) {
    log('error', 'GetGateway failed', { gatewayId: id, error: err.message, code: err.name, requestId: err.$metadata?.requestId });
    res.status(500).json({ error: err.message });
  }
});

// List gateway targets (MCP tools come from targets)
app.get('/api/gateways/:id/targets', async (req, res) => {
  const { id } = req.params;
  try {
    const targets = [];
    let nextToken;
    do {
      const resp = await controlClient.send(new ListGatewayTargetsCommand({
        gatewayIdentifier: id,
        maxResults: 100,
        nextToken,
      }));
      targets.push(...(resp.items || []));
      nextToken = resp.nextToken;
    } while (nextToken);
    log('info', 'ListGatewayTargets', { gatewayId: id, count: targets.length });
    res.json(targets);
  } catch (err) {
    log('error', 'ListGatewayTargets failed', { gatewayId: id, error: err.message, code: err.name, requestId: err.$metadata?.requestId });
    res.status(500).json({ error: err.message });
  }
});

// Invoke agent runtime - streaming SSE
app.post('/api/chat', async (req, res) => {
  const { agentRuntimeArn, prompt, sessionId, qualifier } = req.body;

  if (!agentRuntimeArn || !prompt) {
    return res.status(400).json({ error: 'agentRuntimeArn and prompt are required' });
  }

  const chatId = crypto.randomBytes(4).toString('hex');
  log('info', 'Chat started', { chatId, agentRuntimeArn, sessionId: sessionId || 'new', promptLength: prompt.length });

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
    log('info', 'InvokeAgentRuntime connected', { chatId, runtimeSessionId: resp.runtimeSessionId, requestId: resp.$metadata?.requestId });

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

        // Normalize non-streaming result format: {"result": {"content": [{"text": "..."}]}}
        if (parsed.result?.content) {
          for (const block of parsed.result.content) {
            if (block.text) {
              res.write(`data: ${JSON.stringify({ data: block.text })}\n\n`);
            }
            if (block.reasoningContent?.reasoningText?.text) {
              log('info', 'Chat reasoning', { chatId, length: block.reasoningContent.reasoningText.text.length });
            }
          }
          if (parsed.session_id) {
            res.write(`event: session\ndata: ${JSON.stringify({ runtimeSessionId: parsed.session_id })}\n\n`);
          }
          continue;
        }

        // Forward clean event
        res.write(`data: ${JSON.stringify(parsed)}\n\n`);
      }
    }

    res.write('event: done\ndata: [DONE]\n\n');
    log('info', 'Chat completed', { chatId });
    res.end();
  } catch (err) {
    log('error', 'InvokeAgentRuntime failed', { chatId, error: err.message, code: err.name, requestId: err.$metadata?.requestId });
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// SPA fallback — redirect to login
app.get('/{*splat}', (req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  log('info', 'Server started', { port: PORT, region: REGION });
});
