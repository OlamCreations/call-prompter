/**
 * Call Prompter — Content Script (Google Meet)
 *
 * Reads captions from the Meet DOM and sends them to the background
 * service worker via chrome.runtime.sendMessage (not WebSocket directly,
 * because Meet's CSP blocks ws://localhost connections).
 */

const CAPTION_SELECTORS = [
  '[jsname="tgaKEf"]',
  '[data-message-text]',
  '.iOzk7',
  '.TBMuR',
  'div[class*="caption"]',
]

const GARBAGE_RE = /arrow_downward|arrow_upward|aller en bas|go to bottom|scroll down/gi

let lastSentText = ''
let debounceTimer = null
let currentCaption = ''

function log(msg) {
  console.log(`[Call Prompter] ${msg}`)
}

function cleanCaption(raw) {
  return raw
    .replace(GARBAGE_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function readCaptions() {
  for (const sel of CAPTION_SELECTORS) {
    const containers = document.querySelectorAll(sel)
    if (containers.length === 0) continue

    const texts = []
    containers.forEach(container => {
      const spans = container.querySelectorAll('span')
      if (spans.length > 0) {
        spans.forEach(span => {
          const t = span.textContent.trim()
          if (t && t.length > 1) texts.push(t)
        })
      } else {
        const t = container.textContent.trim()
        if (t && t.length > 1) texts.push(t)
      }
    })

    const raw = texts.join(' ')
    const cleaned = cleanCaption(raw)

    if (cleaned && cleaned.length > 3 && cleaned !== currentCaption) {
      currentCaption = cleaned

      // Debounce 1.5s — wait for caption to finish
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (currentCaption && currentCaption !== lastSentText) {
          lastSentText = currentCaption
          // Send to background script (not WebSocket)
          chrome.runtime.sendMessage({
            type: 'caption',
            text: currentCaption,
            ts: Date.now(),
          }, (response) => {
            if (response?.ok) {
              log(`Sent: "${currentCaption.slice(0, 50)}..."`)
            }
          })
        }
      }, 1500)
    }
    return
  }
}

// MutationObserver + backup poll
const observer = new MutationObserver(() => readCaptions())

function startObserving() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  setInterval(readCaptions, 2000)
  log('Caption observer started (sends via background script)')
}

// Status check from popup
chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({
      lastText: lastSentText.slice(0, 50),
      url: window.location.href,
    })
  }
})

log('Initializing on ' + window.location.href)

if (document.readyState === 'complete') {
  startObserving()
} else {
  window.addEventListener('load', startObserving)
}
