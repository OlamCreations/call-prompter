/**
 * Background service worker — WebSocket bridge
 *
 * Content scripts on meet.google.com can't connect to ws://localhost
 * due to CSP restrictions. This background script acts as a bridge:
 *
 * Content Script → chrome.runtime.sendMessage → Background → WebSocket → Server
 */

const WS_URL = 'ws://127.0.0.1:4242'
let ws = null
let connected = false

function connectWs() {
  if (ws && ws.readyState <= 1) return

  try {
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      connected = true
      console.log('[CP Background] Connected to server')
    }

    ws.onclose = () => {
      connected = false
      ws = null
      console.log('[CP Background] Disconnected. Retrying in 5s...')
      setTimeout(connectWs, 5000)
    }

    ws.onerror = () => {
      try { ws.close() } catch {}
    }
  } catch {
    setTimeout(connectWs, 5000)
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'caption' && msg.text) {
    if (connected && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'caption',
        text: msg.text,
        speaker: msg.speaker || 'Meet',
        ts: msg.ts || Date.now(),
        source: 'extension',
      }))
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false, reason: 'not connected' })
    }
  }

  if (msg.type === 'getWsStatus') {
    sendResponse({ connected })
  }

  return true // Keep message channel open for async response
})

// Connect on startup
connectWs()
