const SERVER_HTTP = 'http://127.0.0.1:4243'
const dot = document.getElementById('dot')
const statusText = document.getElementById('status-text')
const info = document.getElementById('info')
const stats = document.getElementById('stats')

fetch(SERVER_HTTP + '/status', { signal: AbortSignal.timeout(3000) })
  .then(r => r.json())
  .then(data => {
    dot.className = 'dot on'
    statusText.textContent = 'Server running'
    info.innerHTML = 'Prospect: <strong>' + data.prospect + '</strong><br>Provider: ' + data.provider
    stats.style.display = 'flex'
    document.getElementById('stat-chunks').textContent = data.chunks
    document.getElementById('stat-clients').textContent = data.connected
    document.getElementById('stat-sentiment').textContent = data.sentiment
  })
  .catch(() => {
    dot.className = 'dot off'
    statusText.textContent = 'Server not running'
    info.innerHTML = 'Start the server first:<br><code>bun server.mjs --prospect="Client"</code>'
    document.getElementById('open-ui').disabled = true
  })

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0]
  if (!tab?.url?.includes('meet.google.com')) {
    const meetNote = document.createElement('div')
    meetNote.className = 'info'
    meetNote.textContent = 'Open a Google Meet call to start capturing captions.'
    meetNote.style.color = '#D8A15A'
    info.after(meetNote)
  }
})

document.getElementById('open-ui').addEventListener('click', () => {
  chrome.tabs.create({ url: SERVER_HTTP })
})

document.getElementById('help').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://github.com/OlamCreations/call-prompter' })
})

document.getElementById('settings')?.addEventListener('click', () => {
  window.location.href = 'settings.html'
})
