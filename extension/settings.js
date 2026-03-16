const SERVER = 'http://127.0.0.1:4243'

// Load saved settings
chrome.storage.local.get(['provider', 'api_key', 'model', 'custom_url'], (data) => {
  if (data.provider) document.getElementById('provider').value = data.provider
  if (data.api_key) document.getElementById('api-key').value = data.api_key
  if (data.model) document.getElementById('model').value = data.model
  if (data.custom_url) document.getElementById('custom-url').value = data.custom_url
})

document.getElementById('save').addEventListener('click', () => {
  const settings = {
    provider: document.getElementById('provider').value,
    api_key: document.getElementById('api-key').value,
    model: document.getElementById('model').value,
    custom_url: document.getElementById('custom-url').value,
  }

  chrome.storage.local.set(settings, () => {
    // Also write config.json to server if it's running
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
