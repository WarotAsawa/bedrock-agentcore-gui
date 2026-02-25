// State
const state = {
  agents: [],
  gateways: [],
  sessions: JSON.parse(localStorage.getItem('ac_sessions') || '[]'),
  currentSessionId: null,
  streaming: false,
};

// Helpers
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function saveSessions() {
  localStorage.setItem('ac_sessions', JSON.stringify(state.sessions));
}

function getSession(id) {
  return state.sessions.find(s => s.id === id);
}

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// API
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function loadAgents() {
  try {
    state.agents = await fetchJSON('/api/agents');
    updateAgentBadge();
    return state.agents;
  } catch (e) {
    console.error('Failed to load agents:', e);
    return [];
  }
}

async function loadGateways() {
  try {
    state.gateways = await fetchJSON('/api/gateways');
    updateGatewayBadge();
    return state.gateways;
  } catch (e) {
    console.error('Failed to load gateways:', e);
    return [];
  }
}

function updateAgentBadge() {
  const b = $('#badge-agents');
  if (b) b.textContent = state.agents.length;
}

function updateGatewayBadge() {
  const b = $('#badge-gateways');
  if (b) b.textContent = state.gateways.length;
}

function updateSessionBadge() {
  const b = $('#badge-chat');
  if (b) b.textContent = state.sessions.length;
}

// Views
function switchView(name) {
  $$('.view-panel').forEach(v => v.classList.remove('active'));
  $$('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
  $$('.tab-btn[data-tab]').forEach(t => t.classList.remove('active'));

  const panel = $(`#view-${name}`);
  if (panel) panel.classList.add('active');

  const nav = $(`.nav-item[data-view="${name}"]`);
  if (nav) nav.classList.add('active');

  const tab = $(`.tab-btn[data-tab="${name}"]`);
  if (tab) tab.classList.add('active');

  if (name === 'agents') renderAgentsView();
  if (name === 'gateways') renderGatewaysView();
}

// Sidebar sessions
function renderSessionList() {
  const el = $('#session-list');
  if (!el) return;
  updateSessionBadge();

  if (state.sessions.length === 0) {
    el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-tertiary);text-align:center">No sessions yet</div>';
    return;
  }

  el.innerHTML = state.sessions.map(s => `
    <div class="session-item ${s.id === state.currentSessionId ? 'active' : ''}" onclick="openSession('${s.id}')">
      <span class="session-dot"></span>
      <span class="session-name">${esc(s.name)}</span>
      <button class="session-delete" onclick="event.stopPropagation();deleteSession('${s.id}')" title="Delete">×</button>
    </div>
  `).join('');
}

function deleteSession(id) {
  state.sessions = state.sessions.filter(s => s.id !== id);
  saveSessions();
  if (state.currentSessionId === id) {
    state.currentSessionId = null;
    renderChatArea();
  }
  renderSessionList();
}

function openSession(id) {
  state.currentSessionId = id;
  switchView('chat');
  renderSessionList();
  renderChatArea();
}

// Chat
function renderChatArea() {
  const session = getSession(state.currentSessionId);
  const header = $('#chat-header');
  const messages = $('#chat-messages');
  const empty = $('#chat-empty');
  const inputArea = $('#chat-input-area');

  if (!session) {
    header.innerHTML = '';
    messages.innerHTML = '';
    messages.style.display = 'none';
    empty.style.display = 'flex';
    inputArea.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  messages.style.display = 'flex';
  inputArea.style.display = 'block';

  const agent = state.agents.find(a => a.agentRuntimeArn === session.agentArn);
  const agentName = agent ? agent.agentRuntimeName : session.agentArn.split('/').pop();

  header.innerHTML = `
    <div class="chat-runtime-badge"><span class="rd"></span>${esc(agentName)}</div>
    <span style="font-size:12px;color:var(--text-secondary)">${esc(session.name)}</span>
  `;

  renderMessages(session);
}

function renderMessages(session) {
  const el = $('#chat-messages');
  el.innerHTML = session.messages.map(m => {
    if (m.role === 'user') {
      return `<div class="msg msg-user"><div class="msg-bubble"><div class="msg-sender">You</div><div class="msg-text">${esc(m.content)}</div></div></div>`;
    }
    // Agent message with possible tool calls
    let toolsHtml = '';
    if (m.tools && m.tools.length) {
      toolsHtml = m.tools.map(t => renderToolInvocation(t)).join('');
    }
    return `<div class="msg msg-agent"><div class="msg-bubble"><div class="msg-sender">Agent</div>${toolsHtml}<div class="msg-text md-content">${md(m.content)}</div></div></div>`;
  }).join('');

  el.scrollTop = el.scrollHeight;
}

function renderToolInvocation(tool) {
  const statusClass = tool.status === 'completed' ? 'completed' : 'executing';
  const statusIcon = tool.status === 'completed'
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>';

  let bodyHtml = '';
  if (tool.input) {
    bodyHtml += `<div class="tool-inv-section-label">Input</div><div class="tool-inv-code">${esc(typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2))}</div>`;
  }
  if (tool.output) {
    bodyHtml += `<div class="tool-inv-section-label" style="margin-top:8px">Output</div><div class="tool-inv-code">${esc(typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2))}</div>`;
  }

  return `
    <div class="tool-invocation ${bodyHtml ? '' : 'tool-inv-collapsed'}">
      <div class="tool-inv-header" onclick="this.parentElement.classList.toggle('tool-inv-collapsed')">
        <div class="tool-inv-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>
        <span class="tool-inv-name">${esc(tool.name || 'tool')}</span>
        <span class="tool-inv-status ${statusClass}">${statusIcon} ${tool.status || 'executing'}</span>
      </div>
      <div class="tool-inv-body">${bodyHtml}</div>
    </div>`;
}

// Streaming chat
async function sendMessage() {
  const input = $('#chat-input');
  const prompt = input.value.trim();
  if (!prompt || state.streaming) return;

  const session = getSession(state.currentSessionId);
  if (!session) return;

  // Add user message
  session.messages.push({ role: 'user', content: prompt });
  saveSessions();
  input.value = '';
  autoResize(input);
  renderMessages(session);

  // Start streaming
  state.streaming = true;
  $('#send-btn').disabled = true;

  const agentMsg = { role: 'agent', content: '', tools: [] };
  session.messages.push(agentMsg);

  // Add streaming message bubble
  const messagesEl = $('#chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg msg-agent';
  msgDiv.innerHTML = `<div class="msg-bubble"><div class="msg-sender">Agent</div><div id="streaming-tools"></div><div class="msg-text md-content" id="streaming-text"><span class="streaming-cursor"></span></div></div>`;
  messagesEl.appendChild(msgDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentRuntimeArn: session.agentArn,
        prompt,
        sessionId: session.runtimeSessionId || undefined,
      }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolUse = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (line.startsWith('event: session')) continue;
        if (line.startsWith('event: done')) continue;
        if (line.startsWith('event: error')) continue;
        if (!line.startsWith('data: ')) continue;

        const raw = line.slice(6);
        if (raw === '[DONE]') continue;

        // Try parse session info
        try {
          const d = JSON.parse(raw);

          // Session ID
          if (d.runtimeSessionId) {
            session.runtimeSessionId = d.runtimeSessionId;
            saveSessions();
            continue;
          }

          // Handle event-based streaming from Strands/AgentCore
          if (d.event) {
            const evt = d.event;

            // Content text delta
            if (evt.contentBlockDelta?.delta?.text) {
              const text = evt.contentBlockDelta.delta.text;
              agentMsg.content += text;
              updateStreamingText(agentMsg.content);
              messagesEl.scrollTop = messagesEl.scrollHeight;
              continue;
            }

            // Tool use start
            if (evt.contentBlockStart?.start?.toolUse) {
              const tu = evt.contentBlockStart.start.toolUse;
              currentToolUse = {
                name: tu.name || tu.toolUseId || 'tool',
                input: '',
                output: null,
                status: 'executing',
                blockIndex: evt.contentBlockStart.contentBlockIndex,
              };
              agentMsg.tools.push(currentToolUse);
              updateStreamingTools(agentMsg.tools);
              continue;
            }

            // Tool use delta (input accumulation)
            if (evt.contentBlockDelta?.delta?.toolUse?.input) {
              if (currentToolUse) {
                currentToolUse.input += evt.contentBlockDelta.delta.toolUse.input;
                updateStreamingTools(agentMsg.tools);
              }
              continue;
            }

            // Content block stop
            if (evt.contentBlockStop !== undefined) {
              if (currentToolUse && evt.contentBlockStop?.contentBlockIndex === currentToolUse.blockIndex) {
                // Try parse accumulated input
                try { currentToolUse.input = JSON.parse(currentToolUse.input); } catch {}
              }
              continue;
            }

            continue;
          }

          // Tool result from callback events
          if (d.current_tool_use) {
            const tu = d.current_tool_use;
            // Find or create tool entry
            let tool = agentMsg.tools.find(t => t.name === (tu.name || tu.toolUseId));
            if (!tool) {
              tool = { name: tu.name || tu.toolUseId || 'tool', input: tu.input, output: null, status: 'executing' };
              agentMsg.tools.push(tool);
            }
            if (tu.input && !tool.input) tool.input = tu.input;
            updateStreamingTools(agentMsg.tools);
            continue;
          }

          // Tool result
          if (d.tool_result !== undefined) {
            if (currentToolUse) {
              currentToolUse.output = d.tool_result;
              currentToolUse.status = 'completed';
              currentToolUse = null;
              updateStreamingTools(agentMsg.tools);
            }
            continue;
          }

          // Simple text delta
          if (d.data && typeof d.data === 'string') {
            agentMsg.content += d.data;
            updateStreamingText(agentMsg.content);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            continue;
          }

          // Delta with text
          if (d.delta?.text) {
            agentMsg.content += d.delta.text;
            updateStreamingText(agentMsg.content);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            continue;
          }

        } catch {
          // Not JSON, treat as plain text
          if (raw && raw !== 'undefined') {
            agentMsg.content += raw;
            updateStreamingText(agentMsg.content);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
      }
    }

    // Mark any remaining tools as completed
    agentMsg.tools.forEach(t => { if (t.status !== 'completed') t.status = 'completed'; });

  } catch (e) {
    agentMsg.content += `\n[Error: ${e.message}]`;
  }

  saveSessions();
  state.streaming = false;
  $('#send-btn').disabled = false;
  renderMessages(session);
}

function updateStreamingText(text) {
  const el = $('#streaming-text');
  if (el) el.innerHTML = md(text) + '<span class="streaming-cursor"></span>';
}

function updateStreamingTools(tools) {
  const el = $('#streaming-tools');
  if (el) el.innerHTML = tools.map(t => renderToolInvocation(t)).join('');
}

// Agents view
function renderAgentsView() {
  const el = $('#agents-content');
  if (!el) return;

  if (!state.agents.length) {
    el.innerHTML = '<div class="loading-spinner"><span class="spinner"></span> Loading agents...</div>';
    loadAgents().then(() => renderAgentsView());
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="view-title">Agent Runtimes</div><div class="view-subtitle">${state.agents.length} agents in your account</div></div>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Status</th><th>Version</th><th>ARN</th><th>Updated</th></tr></thead>
        <tbody>${state.agents.map(a => `
          <tr>
            <td><span class="runtime-name">${esc(a.agentRuntimeName)}</span></td>
            <td><span class="status-badge ${a.status}">${a.status}</span></td>
            <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-tertiary)">v${a.agentRuntimeVersion || '1'}</td>
            <td><span class="arn-text" title="${esc(a.agentRuntimeArn)}">${esc(a.agentRuntimeArn)}</span></td>
            <td style="font-size:12px;color:var(--text-tertiary)">${a.lastUpdatedAt ? new Date(a.lastUpdatedAt).toLocaleDateString() : '-'}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>`;
}

// Gateways view
function renderGatewaysView() {
  const el = $('#gateways-content');
  if (!el) return;

  if (!state.gateways.length && state.gateways.length !== 0) {
    el.innerHTML = '<div class="loading-spinner"><span class="spinner"></span> Loading gateways...</div>';
    loadGateways().then(() => renderGatewaysView());
    return;
  }

  if (state.gateways.length === 0) {
    el.innerHTML = `
      <div class="view-header"><div><div class="view-title">AgentCore Gateways</div><div class="view-subtitle">No gateways found</div></div></div>
      <div style="text-align:center;padding:40px;color:var(--text-tertiary);font-size:13px">No gateways configured in this account/region.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="view-header">
      <div><div class="view-title">AgentCore Gateways</div><div class="view-subtitle">${state.gateways.length} gateways</div></div>
    </div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Status</th><th>Protocol</th><th>Auth</th><th>ID</th><th>Targets</th></tr></thead>
        <tbody>${state.gateways.map(g => `
          <tr class="clickable-row" onclick="viewGatewayTargets('${g.gatewayId}')">
            <td><span class="runtime-name">${esc(g.name)}</span>${g.description ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${esc(g.description)}</div>` : ''}</td>
            <td><span class="status-badge ${g.status}">${g.status}</span></td>
            <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-tertiary)">${g.protocolType || '-'}</td>
            <td style="font-size:12px;color:var(--text-tertiary)">${g.authorizerType || '-'}</td>
            <td><span class="arn-text">${esc(g.gatewayId)}</span></td>
            <td><button onclick="event.stopPropagation();viewGatewayTargets('${g.gatewayId}')" style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);color:var(--aurora-violet);padding:4px 10px;border-radius:var(--radius-sm);font-size:11px;font-family:var(--font-mono);cursor:pointer">View Targets</button></td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>
    <div id="gateway-targets-detail"></div>`;
}

async function viewGatewayTargets(gatewayId) {
  const el = $('#gateway-targets-detail');
  if (!el) return;

  el.innerHTML = '<div class="loading-spinner" style="margin-top:20px"><span class="spinner"></span> Loading targets...</div>';

  try {
    const targets = await fetchJSON(`/api/gateways/${gatewayId}/targets`);
    if (!targets.length) {
      el.innerHTML = '<div style="margin-top:20px;padding:20px;text-align:center;color:var(--text-tertiary);font-size:13px">No targets configured for this gateway.</div>';
      return;
    }

    el.innerHTML = `
      <div style="margin-top:24px">
        <div class="view-title" style="font-size:16px;margin-bottom:12px">Gateway Targets (${targets.length})</div>
        ${targets.map(t => `
          <div class="target-card">
            <div class="target-card-name">${esc(t.name || t.targetId)}</div>
            ${t.description ? `<div class="target-card-desc">${esc(t.description)}</div>` : ''}
            <div class="target-card-meta">
              ID: ${esc(t.targetId || '-')} · Status: ${t.status || '-'}
              ${t.createdAt ? ` · Created: ${new Date(t.createdAt).toLocaleDateString()}` : ''}
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div style="margin-top:20px;padding:20px;color:var(--aurora-rose);font-size:13px">Error loading targets: ${esc(e.message)}</div>`;
  }
}

// New chat modal
function openNewChatModal() {
  const modal = $('#new-chat-modal');
  const select = $('#modal-agent-select');

  select.innerHTML = state.agents
    .filter(a => a.status === 'READY')
    .map(a => `<option value="${esc(a.agentRuntimeArn)}">${esc(a.agentRuntimeName)} (v${a.agentRuntimeVersion || '1'})</option>`)
    .join('');

  if (!select.innerHTML) {
    select.innerHTML = '<option disabled>No READY agents available</option>';
  }

  $('#modal-session-name').value = `Chat ${state.sessions.length + 1}`;
  modal.classList.add('active');
}

function closeNewChatModal() {
  $('#new-chat-modal').classList.remove('active');
}

function createNewChat() {
  const arn = $('#modal-agent-select').value;
  const name = $('#modal-session-name').value.trim() || `Chat ${state.sessions.length + 1}`;

  if (!arn) return;

  const session = {
    id: genId(),
    name,
    agentArn: arn,
    runtimeSessionId: null,
    messages: [],
    createdAt: new Date().toISOString(),
  };

  state.sessions.unshift(session);
  saveSessions();
  closeNewChatModal();
  openSession(session.id);
}

// Textarea auto-resize
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Escape HTML
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// Markdown renderer (lightweight)
function md(text) {
  if (!text) return '';
  let h = esc(text);
  // Code blocks ```
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
  // Inline code
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headers
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Unordered lists
  h = h.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  // Ordered lists
  h = h.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Links
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Line breaks (but not inside pre)
  h = h.replace(/\n/g, '<br>');
  // Clean up <br> inside pre
  h = h.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_, cls, code) =>
    `<pre><code${cls}>${code.replace(/<br>/g, '\n')}</code></pre>`
  );
  return h;
}

// Sidebar toggle (mobile)
function toggleSidebar() {
  $('#sidebar').classList.toggle('open');
  $('#sidebarBackdrop').classList.toggle('open');
}

// Init
async function init() {
  await Promise.all([loadAgents(), loadGateways()]);
  renderSessionList();
  renderChatArea();

  // Chat input handlers
  const input = $('#chat-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener('input', () => autoResize(input));
}

document.addEventListener('DOMContentLoaded', init);
