/**
 * Call Prompter — Content Script (Google Meet)
 *
 * Strategy: try WebSocket direct first, fallback to background bridge.
 * Aggressive caption detection with nuclear DOM fallback.
 */

const WS_URL = 'ws://127.0.0.1:4242'

let ws = null
let wsConnected = false
let bgBridge = false
let lastSentText = ''
let debounceTimer = null
let foundSelector = null
let scanCount = 0

// ─── Logging (always visible in Meet console) ───────────────

function log(msg) { console.log('%c[CallPrompter]%c ' + msg, 'color:#0D9488;font-weight:bold;font-size:13px', 'color:inherit;font-size:12px') }
function warn(msg) { console.warn('%c[CallPrompter]%c ' + msg, 'color:#D8A15A;font-weight:bold;font-size:13px', 'color:inherit;font-size:12px') }
function err(msg) { console.error('%c[CallPrompter]%c ' + msg, 'color:#E06060;font-weight:bold;font-size:13px', 'color:inherit;font-size:12px') }

log('=== CONTENT SCRIPT LOADED on ' + window.location.href + ' ===')

// ─── Connection: WebSocket direct, fallback to background ───

function connect() {
  log('Attempting WebSocket direct to ' + WS_URL + '...')
  try {
    ws = new WebSocket(WS_URL)
    ws.onopen = () => {
      wsConnected = true
      bgBridge = false
      log('WebSocket DIRECT connected!')
    }
    ws.onclose = () => {
      wsConnected = false
      log('WebSocket closed. Retry in 5s...')
      setTimeout(connect, 5000)
    }
    ws.onerror = (e) => {
      warn('WebSocket direct failed (CSP?). Falling back to background bridge.')
      wsConnected = false
      ws = null
      useBgBridge()
    }
  } catch (e) {
    warn('WebSocket blocked: ' + e.message + '. Using background bridge.')
    useBgBridge()
  }
}

function useBgBridge() {
  bgBridge = true
  log('Using chrome.runtime background bridge')
}

function sendCaption(text) {
  const msg = { type: 'caption', text, ts: Date.now(), source: 'extension' }

  if (wsConnected && ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg))
    log('SENT (WS): "' + text.slice(0, 50) + '"')
    return
  }

  if (bgBridge) {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          err('Background bridge error: ' + chrome.runtime.lastError.message)
        } else if (resp?.ok) {
          log('SENT (BG): "' + text.slice(0, 50) + '"')
        } else {
          warn('Background bridge: server not connected')
        }
      })
    } catch (e) {
      err('chrome.runtime.sendMessage failed: ' + e.message)
    }
    return
  }

  warn('No connection available. Caption dropped: "' + text.slice(0, 40) + '"')
}

// ─── Caption detection ──────────────────────────────────────

const GARBAGE_RE = /^(arrow_downward|arrow_upward|aller en bas|go to bottom|scroll down|vous|you|meet|more_vert|present_to_all|mic_off|mic|videocam_off|videocam|call_end|chat|people|info|close|cancel|check)$/i
const MENU_RE = /BÊTA|Afrique du Sud|Taille de police|Couleur de la police|Ouvrir les paramètres|Caption settings|Font size|Font color/i

function cleanText(raw) {
  return raw
    .split(/\n|\r/)
    .map(s => s.trim())
    .filter(p => p.length > 2 && !GARBAGE_RE.test(p))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scanForCaptions() {
  scanCount++

  // Strategy 1: Known selectors
  const selectors = [
    '[jsname="tgaKEf"]', '[jsname="YSg1Xc"]', '[data-message-text]',
    '.iOzk7', '.TBMuR', '.a4cQT', '.oY2CYd',
    'div[class*="caption"]', 'div[class*="Caption"]',
    'div[class*="subtitle"]', 'div[class*="Subtitle"]',
    'div[class*="closed-caption"]',
  ]

  if (foundSelector) {
    const text = extractFromSelector(foundSelector)
    if (text) return processCaption(text)
  }

  for (const sel of selectors) {
    const text = extractFromSelector(sel)
    if (text) {
      if (!foundSelector) {
        foundSelector = sel
        log('FOUND working selector: ' + sel)
      }
      return processCaption(text)
    }
  }

  // Strategy 2: Nuclear fallback — find text in bottom 30% of screen
  const allEls = document.querySelectorAll('div, span')
  for (const el of allEls) {
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight * 0.65) continue
    if (rect.height > 150 || rect.height < 8) continue
    if (rect.width < 100) continue
    if (el.querySelector('button, input, [role="button"]')) continue

    const text = cleanText(el.innerText || '')
    if (text.length > 5 && text.length < 200 && text.includes(' ') && !MENU_RE.test(text)) {
      if (scanCount <= 5) log('NUCLEAR fallback found text at bottom of screen')
      return processCaption(text)
    }
  }

  // Log periodically
  if (scanCount === 5) warn('5 scans, no captions yet. Is CC enabled?')
  if (scanCount === 30) warn('30 scans, still no captions. Check Meet CC button.')
  if (scanCount % 60 === 0) warn(scanCount + ' scans, no captions. Selectors may need update.')
}

function extractFromSelector(sel) {
  const els = document.querySelectorAll(sel)
  if (els.length === 0) return ''
  const texts = []
  els.forEach(el => {
    const clone = el.cloneNode(true)
    clone.querySelectorAll('button, [role="button"], i, svg, [class*="icon"]').forEach(x => x.remove())
    const t = (clone.innerText || clone.textContent || '').trim()
    if (t && t.length > 1) texts.push(t)
  })
  return cleanText(texts.join(' '))
}

let currentCaption = ''
function processCaption(text) {
  if (text.length > 200 || MENU_RE.test(text)) return
  if (text === currentCaption) return
  currentCaption = text

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (currentCaption && currentCaption !== lastSentText) {
      lastSentText = currentCaption
      sendCaption(currentCaption)
    }
  }, 1200)
}

// ─── Observer + aggressive poll ─────────────────────────────

const observer = new MutationObserver(() => scanForCaptions())

let pollInterval = null

function start() {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  pollInterval = setInterval(() => {
    // Stop if extension was reloaded (context invalidated)
    try { chrome.runtime.id } catch { cleanup(); return }
    scanForCaptions()
  }, 800)
  log('Observer + poll started. Scanning for captions every 800ms...')
  log('If no captions appear, make sure:')
  log('  1. You are in a Meet call (not the lobby)')
  log('  2. CC button is enabled (bottom bar)')
  log('  3. You or someone is speaking')
}

function cleanup() {
  warn('Extension context invalidated — cleaning up. Refresh page (F5) to restart.')
  if (pollInterval) clearInterval(pollInterval)
  observer.disconnect()
  if (ws) try { ws.close() } catch {}
}

// ─── Status for popup ───────────────────────────────────────

chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({ lastText: lastSentText.slice(0, 50), foundSelector, scanCount, wsConnected, bgBridge })
  }
})

// ─── Init ───────────────────────────────────────────────────

connect()
if (document.readyState === 'complete') start()
else window.addEventListener('load', start)
