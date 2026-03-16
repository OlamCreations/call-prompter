const SERVER = 'http://127.0.0.1:4243'

const providerEl = document.getElementById('provider')
const keySection = document.getElementById('key-section')
const customSection = document.getElementById('custom-section')
const modelHelp = document.getElementById('model-help')
const modelInput = document.getElementById('model')
const modelSection = document.getElementById('model-section')

const guides = {
  ollama: { show: 'guide-ollama', needsKey: false, model: 'llama3', modelTip: 'Popular: llama3, mistral, gemma2, phi3' },
  openai: { show: 'guide-openai', needsKey: true, model: 'gpt-4o-mini', modelTip: 'Recommended: gpt-4o-mini (cheap + fast) or gpt-4o (best)' },
  anthropic: { show: 'guide-anthropic', needsKey: true, model: 'claude-sonnet-4-20250514', modelTip: 'Recommended: claude-sonnet (fast) or claude-opus (best)' },
  claude: { show: 'guide-claude', needsKey: false, model: '', modelTip: 'Uses your Claude account. No model selection needed.' },
  custom: { show: 'guide-custom', needsKey: true, model: '', modelTip: 'Depends on your provider.' },
}

// ─── Storage abstraction (chrome.storage or localStorage fallback) ───

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(keys, resolve)
      } else {
        const data = {}
        keys.forEach(k => { const v = localStorage.getItem('cp-' + k); if (v) data[k] = v })
        resolve(data)
      }
    } catch {
      const data = {}
      keys.forEach(k => { const v = localStorage.getItem('cp-' + k); if (v) data[k] = v })
      resolve(data)
    }
  })
}

function storageSet(obj) {
  return new Promise((resolve) => {
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set(obj, resolve)
      } else {
        Object.entries(obj).forEach(([k, v]) => localStorage.setItem('cp-' + k, v))
        resolve()
      }
    } catch {
      Object.entries(obj).forEach(([k, v]) => localStorage.setItem('cp-' + k, v))
      resolve()
    }
  })
}

// ─── UI update ───────────────────────────────────────────────

function updateUI() {
  const p = providerEl.value
  const g = guides[p] || {}

  document.querySelectorAll('.guide').forEach(el => el.classList.remove('visible'))
  const guideEl = g.show ? document.getElementById(g.show) : null
  if (guideEl) guideEl.classList.add('visible')

  keySection.style.display = g.needsKey ? 'block' : 'none'
  if (modelSection) modelSection.style.display = p === 'claude' ? 'none' : 'block'
  customSection.className = p === 'custom' ? '' : 'hidden'

  modelInput.placeholder = g.model || 'default'
  modelHelp.textContent = g.modelTip || ''
}

providerEl.addEventListener('change', updateUI)

// ─── Load saved settings ─────────────────────────────────────

storageGet(['provider', 'api_key', 'model', 'custom_url']).then(data => {
  if (data.provider) providerEl.value = data.provider
  if (data.api_key) document.getElementById('api-key').value = data.api_key
  if (data.model) modelInput.value = data.model
  if (data.custom_url) document.getElementById('custom-url').value = data.custom_url
  updateUI()
})

updateUI()

// ─── Save ────────────────────────────────────────────────────

document.getElementById('save').addEventListener('click', () => {
  const settings = {
    provider: providerEl.value,
    api_key: document.getElementById('api-key').value,
    model: modelInput.value,
    custom_url: document.getElementById('custom-url').value,
  }

  storageSet(settings).then(() => {
    fetch(SERVER + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).catch(() => {})

    document.getElementById('saved').style.display = 'block'
    setTimeout(() => { document.getElementById('saved').style.display = 'none' }, 3000)
  })
})

// ─── Back ────────────────────────────────────────────────────

document.getElementById('back').addEventListener('click', () => {
  if (window.history.length > 1) {
    window.history.back()
  } else {
    window.location.href = 'popup.html'
  }
})

// ─── Install Claude CLI ──────────────────────────────────────

document.getElementById('install-claude')?.addEventListener('click', () => {
  const btn = document.getElementById('install-claude')
  const status = document.getElementById('install-status')
  btn.disabled = true
  btn.textContent = 'Checking...'
  status.textContent = ''

  fetch(SERVER + '/install-claude', { method: 'POST', signal: AbortSignal.timeout(120000) })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        btn.textContent = data.already_installed ? 'Already Installed' : 'Installed'
        btn.style.color = '#0D9488'
        btn.style.borderColor = 'rgba(13,148,136,0.3)'
        status.textContent = data.already_installed
          ? 'Claude CLI already installed (' + data.version + '). Run: claude'
          : 'Installed. Open a terminal and run: claude'
        status.style.color = '#0D9488'
      } else {
        btn.textContent = 'Retry Install'
        btn.style.color = '#E06060'
        btn.disabled = false
        status.textContent = data.error || 'Failed. Try: npm install -g @anthropic-ai/claude-code'
        status.style.color = '#E06060'
      }
    })
    .catch(() => {
      btn.textContent = 'Install Claude Code CLI'
      btn.disabled = false
      status.textContent = 'Server not running. Start server first or install manually: npm install -g @anthropic-ai/claude-code'
      status.style.color = '#E06060'
    })
})
