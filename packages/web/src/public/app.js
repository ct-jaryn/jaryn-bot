const state = { sessionId: 'web', botId: 'default', source: null, sessions: [], panel: 'memory', token: '' }

// Token may come from ?token= (bookmark), localStorage, or the desktop shell.
function readToken() {
  const fromUrl = new URLSearchParams(location.search).get('token')
  if (fromUrl) { localStorage.setItem('jary_token', fromUrl); return fromUrl }
  return localStorage.getItem('jary_token') || ''
}
state.token = readToken()
if (window.jarynDesktop?.getConfig) {
  window.jarynDesktop.getConfig().then((cfg) => { if (cfg?.apiToken) state.token = cfg.apiToken }).catch(() => {})
}
const authHeaders = () => (state.token ? { authorization: `Bearer ${state.token}` } : {})
const withToken = (path) => (state.token ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(state.token)}` : path)

const $ = (id) => document.getElementById(id)
const messages = $('messages')
const approvals = $('approvals')
const questions = $('questions')
const panelBody = $('panel-body')

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
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...authHeaders(), ...(opts.headers ?? {}) },
  })
  if (res.status === 401) throw new Error('未授权：请在 URL 加 ?token=<JARY_API_TOKEN> 后重新打开')
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

async function loadBots() {
  try {
    const { bots } = await api('/api/bots')
    const select = $('bot-select')
    select.innerHTML = ''
    for (const bot of bots.length ? bots : [{ id: 'default' }]) {
      const option = document.createElement('option')
      option.value = bot.id
      option.textContent = bot.name ?? bot.id
      select.appendChild(option)
    }
    select.value = state.botId
  } catch { /* bots optional */ }
}

async function loadSessions() {
  const data = await api('/api/sessions')
  state.sessions = data.sessions
  const list = $('sessions')
  list.innerHTML = ''
  for (const s of data.sessions) {
    const li = document.createElement('li')
    li.className = s.id === state.sessionId ? 'active' : ''
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = s.title || s.id
    name.onclick = () => selectSession(s.id)
    const rename = document.createElement('span')
    rename.className = 'act'
    rename.textContent = '✎'
    rename.title = '重命名'
    rename.onclick = async (e) => { e.stopPropagation(); const title = prompt('会话标题', s.title ?? s.id); if (title) { await api(`/api/sessions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); loadSessions() } }
    const archive = document.createElement('span')
    archive.className = 'act'
    archive.textContent = '▤'
    archive.title = '归档'
    archive.onclick = async (e) => { e.stopPropagation(); await api(`/api/sessions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }); loadSessions() }
    const del = document.createElement('span')
    del.className = 'act'
    del.textContent = '✕'
    del.title = '删除'
    del.onclick = async (e) => { e.stopPropagation(); if (confirm(`删除会话 ${s.id}？`)) { await api(`/api/sessions/${s.id}`, { method: 'DELETE' }); if (state.sessionId === s.id) state.sessionId = 'web'; loadSessions() } }
    li.append(name, rename, archive, del)
    list.appendChild(li)
  }
}

async function selectSession(id) {
  state.sessionId = id
  $('session-label').textContent = id
  messages.innerHTML = ''
  approvals.innerHTML = ''
  questions.innerHTML = ''
  await loadSessions()
  const data = await api(`/api/events?sessionId=${encodeURIComponent(id)}`)
  for (const e of data.events) renderEvent(e)
  connect()
  if (!$('panels').hidden) refreshPanel()
}

function renderEvent(e) {
  if (e.type === 'input.owner') addMessage('user', e.data?.text ?? '')
  else if (e.type === 'assistant.message') addMessage('assistant', e.data?.text ?? '')
  else if (e.type === 'tool.call') addMessage('tool', `→ ${e.data?.name} ${JSON.stringify(e.data?.args ?? {})}`)
  else if (e.type === 'tool.result') addMessage('tool', `${e.data?.ok ? '✓' : '✗'} ${e.data?.name}`)
}

function connect() {
  state.source?.close()
  state.source = new EventSource(withToken(`/api/stream?sessionId=${encodeURIComponent(state.sessionId)}`))
  state.source.onmessage = (ev) => {
    const event = JSON.parse(ev.data)
    if (event.type === 'hello') return
    if (event.type === 'delta') {
      const d = event.delta
      if (d.type === 'text') {
        const last = messages.lastElementChild
        if (last?.classList.contains('assistant') && last.dataset.streaming === '1') last.textContent += d.text
        else { const el = addMessage('assistant', d.text); el.dataset.streaming = '1' }
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
    if (event.type === 'approval.resolved') document.getElementById(`ap-${event.id}`)?.remove()
    if (event.type === 'question') showQuestion(event)
    if (event.type === 'question.resolved') document.getElementById(`q-${event.id}`)?.remove()
  }
}

function showApproval(req) {
  const el = document.createElement('div')
  el.className = 'card approval'
  el.id = `ap-${req.id}`
  el.innerHTML = `<strong>需要审批：${esc(req.toolName)}</strong> <span class="muted">(${esc(req.risk)})</span><pre>${esc(JSON.stringify(req.args, null, 2))}</pre>`
  const allow = document.createElement('button')
  allow.className = 'allow'
  allow.textContent = '允许一次'
  allow.onclick = () => respondApproval(req.id, 'allowed')
  const deny = document.createElement('button')
  deny.className = 'deny'
  deny.textContent = '拒绝'
  deny.onclick = () => respondApproval(req.id, 'denied')
  el.append(allow, deny)
  approvals.appendChild(el)
}

async function respondApproval(id, decision) {
  await api(`/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) })
  document.getElementById(`ap-${id}`)?.remove()
}

function showQuestion(event) {
  const el = document.createElement('div')
  el.className = 'card question'
  el.id = `q-${event.id}`
  el.innerHTML = `<strong>${esc(event.question)}</strong>`
  const input = document.createElement('input')
  input.placeholder = '你的回答'
  const send = document.createElement('button')
  send.className = 'allow'
  send.textContent = '回答'
  send.onclick = async () => {
    await api(`/api/questions/${event.id}`, { method: 'POST', body: JSON.stringify({ answer: input.value }) })
    el.remove()
  }
  el.append(input, send)
  for (const option of event.options ?? []) {
    const chip = document.createElement('button')
    chip.textContent = option
    chip.onclick = async () => {
      await api(`/api/questions/${event.id}`, { method: 'POST', body: JSON.stringify({ answer: option }) })
      el.remove()
    }
    el.appendChild(chip)
  }
  questions.appendChild(el)
}

async function send(text) {
  if (text.startsWith('/')) {
    addMessage('user', text)
    try {
      const result = await api(`/api/sessions/${state.sessionId}/command`, { method: 'POST', body: JSON.stringify({ command: text }) })
      addMessage('tool', JSON.stringify(result, null, 2).slice(0, 1500))
      if (text === '/new' && result.session) await selectSession(result.session.id)
      if (text === '/stop') setStatus('idle')
    } catch (err) {
      addMessage('error', err.message)
    }
    return
  }
  setStatus('running')
  addMessage('user', text)
  await api('/api/message', { method: 'POST', body: JSON.stringify({ sessionId: state.sessionId, text, botId: state.botId }) })
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
  const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ botId: state.botId }) })
  await selectSession(data.session.id)
}
$('bot-select').onchange = (e) => { state.botId = e.target.value }
$('stop-btn').onclick = async () => {
  const res = await api(`/api/sessions/${state.sessionId}/cancel`, { method: 'POST' })
  addMessage('tool', res.cancelled ? '已请求停止' : '当前没有运行中的任务')
}
$('panel-toggle').onclick = () => {
  $('panels').hidden = !$('panels').hidden
  if (!$('panels').hidden) refreshPanel()
}
for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.remove('active')
    tab.classList.add('active')
    state.panel = tab.dataset.tab
    refreshPanel()
  }
}

const sol = (image, ts) => `<img src="data:image/png;base64,${image}" style="max-width:100%" data-ts="${ts}">`

async function refreshNotifications() {
  try {
    const data = await api('/api/notifications?unread=1')
    $('notify-count').textContent = String(data.unread ?? 0)
  } catch { /* notifications optional */ }
}
$('notify-btn').onclick = async () => {
  $('panels').hidden = false
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === 'notifications')
  state.panel = 'notifications'
  await refreshPanel()
}

async function refreshPanel() {
  const body = panelBody
  body.innerHTML = '<div class="muted">加载中…</div>'
  try {
    if (state.panel === 'memory') {
      const data = await api('/api/memory')
      body.innerHTML = `<div class="muted">共 ${data.stats.total} 条（pinned ${data.stats.pinned}）</div>` +
        data.categories.map((c) => `<div class="row"><strong>${esc(c.kind)}</strong> × ${c.count}<div class="muted">${c.titles.map(esc).join('<br>')}</div></div>`).join('') +
        `<input id="mem-text" placeholder="记住一件事…"><button id="mem-add">保存记忆</button>`
      $('mem-add').onclick = async () => {
        const text = $('mem-text').value.trim()
        if (!text) return
        await api('/api/memory', { method: 'POST', body: JSON.stringify({ text, kind: 'fact' }) })
        refreshPanel()
      }
      return
    }
    if (state.panel === 'tasks') {
      const { tasks } = await api('/api/tasks')
      body.innerHTML = tasks.length === 0 ? '<div class="muted">暂无任务</div>'
        : tasks.map((t) => `<div class="row"><strong>${esc(t.title)}</strong><div class="muted">${esc(t.status)}${t.ownerBot ? ' · ' + esc(t.ownerBot) : ''}</div></div>`).join('')
      return
    }
    if (state.panel === 'pages') {
      const { pages } = await api('/api/pages')
      body.innerHTML = (pages.length === 0 ? '<div class="muted">暂无页面</div>' : pages.map((p) => `<div class="row"><a href="/pages/${p.id}" target="_blank">${esc(p.title)}</a></div>`).join(''))
      return
    }
    if (state.panel === 'artifacts') {
      const { artifacts } = await api('/api/artifacts')
      body.innerHTML = artifacts.length === 0 ? '<div class="muted">暂无产物</div>'
        : artifacts.map((a) => `<div class="row">${esc(a.name)} <span class="muted">${a.bytes}B · ${esc(a.mime)}</span></div>`).join('')
      return
    }
    if (state.panel === 'jobs') {
      const { jobs, runs } = await api('/api/jobs')
      body.innerHTML = (jobs.length === 0 ? '<div class="muted">暂无例程</div>' : jobs.map((j) => `<div class="row"><strong>${esc(j.name)}</strong><div class="muted">${esc(j.trigger.kind)} · runs ${j.runCount}${j.nextRunAt ? ' · next ' + new Date(j.nextRunAt).toLocaleString() : ''}</div><button data-run="${j.id}">立即运行</button></div>`).join('')) +
        (runs.length ? `<div class="muted" style="margin-top:8px">最近运行</div>` + runs.slice(0, 5).map((r) => `<div class="row muted">${esc(r.status)} · ${new Date(r.startedAt).toLocaleString()}</div>`).join('') : '')
      for (const btn of body.querySelectorAll('button[data-run]')) {
        btn.onclick = async () => { await api(`/api/jobs/${btn.dataset.run}/run`, { method: 'POST' }); refreshPanel() }
      }
      return
    }
    if (state.panel === 'initiative') {
      const { proposals } = await api('/api/initiative')
      body.innerHTML = `<button id="scan">扫描提议</button>` + (proposals.length === 0 ? '<div class="muted">暂无提议</div>'
        : proposals.map((p) => `<div class="row"><strong>${esc(p.title)}</strong><div class="muted">${esc(p.reason)} · score ${p.score.toFixed(2)}</div><button data-accept="${p.id}">接受</button><button data-dismiss="${p.id}">忽略</button></div>`).join(''))
      $('scan').onclick = async () => { await api('/api/initiative/scan', { method: 'POST' }); refreshPanel() }
      for (const btn of body.querySelectorAll('button[data-accept]')) btn.onclick = async () => { await api(`/api/initiative/${btn.dataset.accept}/accept`, { method: 'POST' }); refreshPanel() }
      for (const btn of body.querySelectorAll('button[data-dismiss]')) btn.onclick = async () => { await api(`/api/initiative/${btn.dataset.dismiss}/dismiss`, { method: 'POST', body: '{}' }); refreshPanel() }
      return
    }
    if (state.panel === 'usage') {
      const usage = await api('/api/usage')
      body.innerHTML = `<div class="row">输入 tokens：${usage.inputTokens}</div><div class="row">输出 tokens：${usage.outputTokens}</div><div class="row">缓存读：${usage.cacheReadTokens}</div><div class="row">累计费用：$${Number(usage.costUsd).toFixed(4)}</div>`
      return
    }
    if (state.panel === 'notifications') {
      const data = await api('/api/notifications?limit=50')
      body.innerHTML = `<button id="read-all">全部已读</button>` + (data.notifications.length === 0 ? '<div class="muted">暂无通知</div>'
        : data.notifications.map((n) => `<div class="row${n.read ? ' muted' : ''}"><strong>${esc(n.title)}</strong><div class="muted">${esc(n.kind)} · ${new Date(n.ts).toLocaleString()}${n.suppressed ? ' · 安静时段' : ''}</div><div class="muted">${esc(n.body ?? '')}</div></div>`).join(''))
      $('read-all').onclick = async () => { await api('/api/notifications/read-all', { method: 'POST' }); await refreshNotifications(); refreshPanel() }
      return
    }
    if (state.panel === 'audit') {
      const { entries } = await api('/api/audit?limit=30')
      body.innerHTML = entries.length === 0 ? '<div class="muted">暂无审计</div>'
        : entries.map((a) => `<div class="row muted">${new Date(a.ts).toLocaleString()} · ${esc(a.action)}${a.target ? ' · ' + esc(a.target) : ''}</div>`).join('')
      return
    }
  } catch (err) {
    body.innerHTML = `<div class="msg error">${esc(err.message)}</div>`
  }
}

let screenSource = null
let takeover = false
const screenPanel = $('screen-panel')
const screenImg = $('screen-img')

$('screen-toggle').onclick = () => {
  screenPanel.hidden = !screenPanel.hidden
  if (screenPanel.hidden) { screenSource?.close(); screenSource = null; screenImg.src = ''; return }
  if (!screenSource) {
    // MJPEG renders natively in <img> and is lower latency than SSE + data URLs.
    screenImg.src = withToken(`/api/computer/mjpeg?botId=${encodeURIComponent(state.sessionId)}&quality=55&t=${Date.now()}`)
    screenSource = { close() { screenImg.src = '' } }
  }
}
screenImg.onclick = (ev) => {
  const rect = screenImg.getBoundingClientRect()
  const x = Math.round(((ev.clientX - rect.left) / rect.width) * 1280)
  const y = Math.round(((ev.clientY - rect.top) / rect.height) * 900)
  fetch('/api/computer/input', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ botId: state.sessionId, event: { type: 'click', x, y } }) })
}
$('takeover-btn').onclick = async () => {
  takeover = !takeover
  await fetch('/api/computer/takeover', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ botId: state.sessionId, enabled: takeover }) })
  $('takeover-btn').textContent = takeover ? '交还' : '接管'
}
$('screen-send').onclick = async () => {
  const text = $('screen-text').value
  if (!text) return
  $('screen-text').value = ''
  await fetch('/api/computer/input', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ botId: state.sessionId, event: { type: 'type', text } }) })
  await fetch('/api/computer/input', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ botId: state.sessionId, event: { type: 'key', key: 'Enter' } }) })
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

Promise.all([loadBots(), loadSessions()]).then(() => { void refreshNotifications(); setInterval(refreshNotifications, 15000); return selectSession(state.sessionId) }).catch((err) => addMessage('error', err.message))
