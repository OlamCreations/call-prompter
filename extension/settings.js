const SERVER = 'http://127.0.0.1:4243'

const providerEl = document.getElementById('provider')
const keySection = document.getElementById('key-section')
const customSection = document.getElementById('custom-section')
const modelHelp = document.getElementById('model-help')
const modelInput = document.getElementById('model')

const guides = {
  ollama: { show: 'guide-ollama', needsKey: false, model: 'llama3', modelTip: 'Popular: llama3, mistral, gemma2, phi3' },
  openai: { show: 'guide-openai', needsKey: true, model: 'gpt-4o-mini', modelTip: 'Recommended: gpt-4o-mini (cheap + fast) or gpt-4o (best)' },
  anthropic: { show: 'guide-anthropic', needsKey: true, model: 'claude-sonnet-4-20250514', modelTip: 'Recommended: claude-sonnet (fast) or claude-opus (best)' },
  claude: { show: 'guide-claude', needsKey: false, model: '', modelTip: 'Uses your Claude account. No model selection needed.' },
  custom: { show: 'guide-custom', needsKey: true, model: '', modelTip: 'Depends on your provider.' },
}

function updateUI() {
  const p = providerEl.value
  const g = guides[p] || {}

  // Hide all guides, show current
  document.querySelectorAll('.guide').forEach(el => el.style.display = 'none')
  if (g.show) document.getElementById(g.show).style.display = 'block'

  // Show/hide key section
  keySection.style.display = g.needsKey ? 'block' : 'none'

  // Show/hide custom URL
  customSection.className = p === 'custom' ? '' : 'hidden'

  // Update model placeholder and help
  modelInput.placeholder = g.model || 'default'
  modelHelp.textContent = g.modelTip || ''
}

providerEl.addEventListener('change', updateUI)

// Load saved settings
chrome.storage.local.get(['provider', 'api_key', 'model', 'custom_url'], (data) => {
  if (data.provider) providerEl.value = data.provider
  if (data.api_key) document.getElementById('api-key').value = data.api_key
  if (data.model) modelInput.value = data.model
  if (data.custom_url) document.getElementById('custom-url').value = data.custom_url
  updateUI()
})

// Initial UI
updateUI()

document.getElementById('save').addEventListener('click', () => {
  const settings = {
    provider: providerEl.value,
    api_key: document.getElementById('api-key').value,
    model: modelInput.value,
    custom_url: document.getElementById('custom-url').value,
  }

  chrome.storage.local.set(settings, () => {
    // Write config.json to server
    fetch(SERVER + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).catch(() => {})

    document.getElementById('saved').style.display = 'block'
    setTimeout(() => { document.getElementById('saved').style.display = 'none' }, 3000)
  })
})

document.getElementById('back').addEventListener('click', () => {
  window.location.href = 'popup.html'
})
