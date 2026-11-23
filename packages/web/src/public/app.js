const state = { sessionId: 'web', source: null, sessions: [] }

const $ = (id) => document.getElementById(id)
const messages = $('messages')
const approvals = $('approvals')

function addMessage(role, text) {
  const el = document.createElement('div')
  el.className = `msg ${role}`
  el.textContent = text
  messages.appendChild(el)
  messages.scrollTop = messages.scrollHeight
  return el
}

function setStatus(status) {
  $('status').textContent = status
  $('status').className = status
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

async function loadSessions() {
  const data = await api('/api/sessions')
  state.sessions = data.sessions
  const list = $('sessions')
  list.innerHTML = ''
  for (const s of data.sessions) {
    const li = document.createElement('li')
    li.textContent = s.id
    li.className = s.id === state.sessionId ? 'active' : ''
    li.onclick = () => selectSession(s.id)
    list.appendChild(li)
  }
}

async function selectSession(id) {
  state.sessionId = id
  $('session-label').textContent = id
  messages.innerHTML = ''
  approvals.innerHTML = ''
  await loadSessions()
  const data = await api(`/api/events?sessionId=${encodeURIComponent(id)}`)
  for (const e of data.events) renderEvent(e)
  connect()
}

function renderEvent(e) {
  if (e.type === 'input.owner') addMessage('user', e.data?.text ?? '')
  else if (e.type === 'assistant.message') addMessage('assistant', e.data?.text ?? '')
  else if (e.type === 'tool.call') addMessage('tool', `→ ${e.data?.name} ${JSON.stringify(e.data?.args ?? {})}`)
  else if (e.type === 'tool.result') addMessage('tool', `${e.data?.ok ? '✓' : '✗'} ${e.data?.name}`)
}

function connect() {
  state.source?.close()
  state.source = new EventSource(`/api/stream?sessionId=${encodeURIComponent(state.sessionId)}`)
  state.source.onmessage = (ev) => {
    const event = JSON.parse(ev.data)
    if (event.type === 'hello') return
    if (event.type === 'delta') {
      const d = event.delta
      if (d.type === 'text') {
        const last = messages.lastElementChild
        if (last?.classList.contains('assistant') && last.dataset.streaming === '1') last.textContent += d.text
        else {
          const el = addMessage('assistant', d.text)
          el.dataset.streaming = '1'
        }
      }
      return
    }
    if (event.type === 'turn.end') {
      for (const el of messages.querySelectorAll('[data-streaming="1"]')) delete el.dataset.streaming
      setStatus('idle')
      loadSessions()
      return
    }
    if (event.type === 'error') addMessage('error', event.message)
    if (event.type === 'approval') showApproval(event.request)
    if (event.type === 'approval.resolved') removeApproval(event.id)
  }
}

function showApproval(req) {
  const el = document.createElement('div')
  el.className = 'approval'
  el.id = `ap-${req.id}`
  el.innerHTML = `<strong>需要审批：${req.toolName}</strong> <span>(${req.risk})</span><pre>${escapeHtml(JSON.stringify(req.args, null, 2))}</pre>`
  const allow = document.createElement('button')
  allow.className = 'allow'
  allow.textContent = '允许一次'
  allow.onclick = () => respond(req.id, 'allowed')
  const deny = document.createElement('button')
  deny.className = 'deny'
  deny.textContent = '拒绝'
  deny.onclick = () => respond(req.id, 'denied')
  el.append(allow, deny)
  approvals.appendChild(el)
}

function removeApproval(id) { document.getElementById(`ap-${id}`)?.remove() }

async function respond(id, decision) {
  await api(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) })
  removeApproval(id)
}

function escapeHtml(text) { return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) }

async function send(text) {
  setStatus('running')
  addMessage('user', text)
  await api('/api/message', { method: 'POST', body: JSON.stringify({ sessionId: state.sessionId, text }) })
}

$('composer').onsubmit = (e) => {
  e.preventDefault()
  const input = $('input')
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  send(text)
}
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit() }
})
$('new-session').onclick = async () => {
  const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify({}) })
  await selectSession(data.session.id)
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

let screenSource = null
let takeover = false
const screenPanel = $('screen-panel')
const screenImg = $('screen-img')

$('screen-toggle').onclick = () => {
  screenPanel.hidden = !screenPanel.hidden
  if (screenPanel.hidden) { screenSource?.close(); screenSource = null; return }
  if (!screenSource) {
    screenSource = new EventSource('/api/computer/screen?botId=' + encodeURIComponent(state.sessionId) + '&fps=2')
    screenSource.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'frame') screenImg.src = `data:image/png;base64,${msg.image}`
    }
  }
}

screenImg.onclick = (ev) => {
  const rect = screenImg.getBoundingClientRect()
  const x = Math.round(((ev.clientX - rect.left) / rect.width) * 1280)
  const y = Math.round(((ev.clientY - rect.top) / rect.height) * 900)
  fetch('/api/computer/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId: state.sessionId, event: { type: 'click', x, y } }) })
}

$('takeover-btn').onclick = async () => {
  takeover = !takeover
  await fetch('/api/computer/takeover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId: state.sessionId, enabled: takeover }) })
  $('takeover-btn').textContent = takeover ? '交还' : '接管'
}

$('screen-send').onclick = async () => {
  const text = $('screen-text').value
  if (!text) return
  $('screen-text').value = ''
  await fetch('/api/computer/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId: state.sessionId, event: { type: 'type', text } }) })
  await fetch('/api/computer/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId: state.sessionId, event: { type: 'key', key: 'Enter' } }) })
}

loadSessions().then(() => selectSession(state.sessionId)).catch((err) => addMessage('error', err.message))
