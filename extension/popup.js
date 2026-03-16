const SERVER_HTTP = 'http://127.0.0.1:4243'
const dot = document.getElementById('dot')
const statusText = document.getElementById('status-text')
const info = document.getElementById('info')
const stats = document.getElementById('stats')

// Check server status
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

// Check if on Meet tab
try {
  chrome?.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0]
    if (tab && !tab.url?.includes('meet.google.com')) {
      const meetNote = document.createElement('div')
      meetNote.className = 'info'
      meetNote.textContent = 'Open a Google Meet call to start capturing captions.'
      meetNote.style.color = '#D8A15A'
      info.after(meetNote)
    }
  })
} catch {}

document.getElementById('open-ui').addEventListener('click', () => {
  try { chrome.tabs.create({ url: SERVER_HTTP }) } catch { window.open(SERVER_HTTP) }
})

document.getElementById('start-server').addEventListener('click', () => {
  const btn = document.getElementById('start-server')
  fetch(SERVER_HTTP + '/status', { signal: AbortSignal.timeout(2000) })
    .then(() => {
      btn.textContent = 'Already Running'
      btn.style.color = '#0D9488'
      setTimeout(() => { btn.textContent = 'Start Server'; btn.style.color = '' }, 2000)
    })
    .catch(() => {
      // Try restart endpoint first (if server was running but stuck)
      fetch(SERVER_HTTP + '/restart', { method: 'POST', signal: AbortSignal.timeout(2000) })
        .then(() => {
          btn.textContent = 'Restarting...'
          setTimeout(() => location.reload(), 2000)
        })
        .catch(() => {
          // Server truly down — show instructions
          btn.textContent = 'Not Running'
          btn.style.color = '#E06060'
          info.innerHTML = '<strong>Start the server:</strong><br><code>Double-click start.bat</code><br>or run: <code>bun server.mjs</code>'
          setTimeout(() => { btn.textContent = 'Start Server'; btn.style.color = '' }, 4000)
        })
    })
})

document.getElementById('reload-ext').addEventListener('click', () => {
  chrome.runtime.reload()
})

document.getElementById('settings').addEventListener('click', () => {
  window.location.href = 'settings.html'
})

document.getElementById('help').addEventListener('click', () => {
  try { chrome.tabs.create({ url: 'https://github.com/OlamCreations/call-prompter' }) } catch { window.open('https://github.com/OlamCreations/call-prompter') }
})
