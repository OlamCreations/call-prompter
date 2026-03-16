/**
 * Call Prompter — Content Script (Google Meet)
 *
 * Reads captions from Meet DOM → sends to background → WebSocket → server.
 * Uses multiple selector strategies because Meet changes its DOM frequently.
 */

// ALL known caption selectors across Meet versions
const SELECTORS = [
  // 2024-2026 selectors
  '[jsname="tgaKEf"]',
  '[jsname="YSg1Xc"]',
  '[data-message-text]',
  '.iOzk7',
  '.TBMuR',
  '.a4cQT',
  '.oY2CYd',
  // Generic caption-like containers
  'div[class*="caption"] span',
  'div[class*="Caption"] span',
  'div[class*="subtitle"] span',
  'div[class*="Subtitle"] span',
  'div[class*="closed-caption"]',
  // Broad fallback: bottom-area text containers in Meet
  'div[jscontroller] div[jsname] span',
]

const GARBAGE_RE = /^(arrow_downward|arrow_upward|aller en bas|go to bottom|scroll down|vous|you|meet|more_vert|present_to_all|mic_off|videocam_off|call_end|chat|people|info)$/i

let lastSentText = ''
let debounceTimer = null
let currentCaption = ''
let foundSelector = null
let scanCount = 0

function log(msg) {
  console.log(`%c[Call Prompter]%c ${msg}`, 'color:#0D9488;font-weight:bold', 'color:inherit')
}

function warn(msg) {
  console.warn(`%c[Call Prompter]%c ${msg}`, 'color:#D8A15A;font-weight:bold', 'color:inherit')
}

function cleanText(raw) {
  const parts = raw.split(/\n|\r/).map(s => s.trim()).filter(Boolean)
  return parts
    .filter(p => !GARBAGE_RE.test(p) && p.length > 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scanForCaptions() {
  scanCount++

  // If we already found a working selector, try it first
  if (foundSelector) {
    const text = extractText(foundSelector)
    if (text) return onNewText(text)
  }

  // Try all selectors
  for (const sel of SELECTORS) {
    const text = extractText(sel)
    if (text) {
      if (!foundSelector) {
        foundSelector = sel
        log('Found captions using selector: ' + sel)
      }
      return onNewText(text)
    }
  }

  // Nuclear fallback: scan ALL visible text near bottom of screen
  // Meet captions are typically in the bottom 20% of the page
  if (scanCount % 10 === 0) {
    const allDivs = document.querySelectorAll('div')
    for (const div of allDivs) {
      const rect = div.getBoundingClientRect()
      // Only look at elements in the bottom portion of the screen
      if (rect.top < window.innerHeight * 0.7) continue
      if (rect.height > 200 || rect.height < 10) continue

      const text = cleanText(div.textContent || '')
      // Caption-like: has words, not too long, not a button
      if (text.length > 10 && text.length < 500 && text.includes(' ') && !div.querySelector('button')) {
        if (!foundSelector) {
          warn('Using fallback bottom-screen text scan')
        }
        return onNewText(text)
      }
    }
  }

  // Log every 30 scans if nothing found
  if (scanCount % 30 === 0) {
    warn('No captions found after ' + scanCount + ' scans. Make sure captions (CC) are enabled.')
  }
}

function extractText(selector) {
  const els = document.querySelectorAll(selector)
  if (els.length === 0) return ''

  const texts = []
  els.forEach(el => {
    // Get direct text content, skip nested buttons/icons
    const clone = el.cloneNode(true)
    clone.querySelectorAll('button, [role="button"], i, .material-icons, [class*="icon"]').forEach(x => x.remove())
    const t = clone.textContent.trim()
    if (t) texts.push(t)
  })

  return cleanText(texts.join(' '))
}

function onNewText(text) {
  if (!text || text === currentCaption) return
  currentCaption = text

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (currentCaption && currentCaption !== lastSentText) {
      lastSentText = currentCaption
      log('Caption: "' + currentCaption.slice(0, 60) + (currentCaption.length > 60 ? '..."' : '"'))

      chrome.runtime.sendMessage({
        type: 'caption',
        text: currentCaption,
        ts: Date.now(),
      }, (response) => {
        if (chrome.runtime.lastError) {
          warn('Send failed: ' + chrome.runtime.lastError.message)
        }
      })
    }
  }, 1500)
}

// ─── Observer + Poll ─────────────────────────────────────────

const observer = new MutationObserver(() => scanForCaptions())

function start() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  // Poll every 1s as backup
  setInterval(scanForCaptions, 1000)
  log('Started on ' + window.location.href)
  log('Scanning for captions... (enable CC in Meet if not already)')
}

// ─── Message handler for popup ───────────────────────────────

chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({
      lastText: lastSentText.slice(0, 50),
      foundSelector,
      scanCount,
      url: window.location.href,
    })
  }
})

// ─── Start ───────────────────────────────────────────────────

if (document.readyState === 'complete') {
  start()
} else {
  window.addEventListener('load', start)
}
