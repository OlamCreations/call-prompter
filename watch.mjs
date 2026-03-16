#!/usr/bin/env node

/**
 * Call Prompter Watcher — Auto-detect Google Meet and launch prompter
 *
 * Polls Chrome CDP every 5s for meet.google.com tabs.
 * When detected: launches prompter server + opens UI.
 * When Meet tab closes: stops prompter, triggers post-call summary.
 *
 * Usage:
 *   bun src/call-prompter/watch.mjs
 *
 * Requires: Chrome with --remote-debugging-port=9222
 */

import { spawn, execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CDP_PORT = 9222
const POLL_INTERVAL = 5000
const UI_PATH = join(__dirname, 'ui.html')
const SERVER_PATH = join(__dirname, 'server.mjs')

let prompterProcess = null
let activeMeetUrl = null
let callStartTime = null

async function getMeetTabs() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, { signal: AbortSignal.timeout(3000) })
    const targets = await res.json()
    return targets.filter(t => t.url?.includes('meet.google.com') && !t.url.includes('meet.google.com/landing'))
  } catch {
    return []
  }
}

function extractMeetInfo(tab) {
  const url = tab.url || ''
  const title = tab.title || ''
  // Meet title format: "Meeting name - Google Meet" or participant names
  const meetName = title.replace(' - Google Meet', '').replace(' | Google Meet', '').trim()
  const meetCode = url.match(/meet\.google\.com\/([a-z\-]+)/)?.[1] || 'unknown'
  return { meetName, meetCode, url }
}

function startPrompter(meetInfo) {
  console.log(`\n  [WATCH] Meet détecté: ${meetInfo.meetName}`)
  console.log(`  [WATCH] Code: ${meetInfo.meetCode}`)
  console.log(`  [WATCH] Lancement du prompteur...\n`)

  callStartTime = Date.now()

  prompterProcess = spawn('bun', [SERVER_PATH, `--prospect=${meetInfo.meetName}`, `--context=Google Meet auto-detected`], {
    stdio: 'inherit',
    detached: false,
  })

  prompterProcess.on('exit', (code) => {
    console.log(`  [WATCH] Prompteur arrêté (code ${code})`)
    prompterProcess = null
  })

  // Open UI after a short delay
  setTimeout(() => {
    try {
      if (process.platform === 'win32') {
        execSync(`powershell -Command "Start-Process '${UI_PATH}'"`, { stdio: 'ignore' })
      } else {
        execSync(`xdg-open "${UI_PATH}" 2>/dev/null || open "${UI_PATH}" 2>/dev/null`, { stdio: 'ignore' })
      }
      console.log(`  [WATCH] UI ouverte`)
    } catch {
      console.log(`  [WATCH] Ouvre manuellement: ${UI_PATH}`)
    }
  }, 1500)
}

function stopPrompter() {
  if (!prompterProcess) return

  const duration = callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0
  const minutes = Math.floor(duration / 60)

  console.log(`\n  [WATCH] Meet fermé. Call: ${minutes}min`)
  console.log(`  [WATCH] Arrêt du prompteur...`)

  prompterProcess.kill('SIGTERM')
  prompterProcess = null
  activeMeetUrl = null
  callStartTime = null

  // TODO: trigger post-call summary via call-intel pipeline
  console.log(`  [WATCH] Post-call summary à implémenter (call-intel pipeline)`)
  console.log(`  [WATCH] En attente du prochain Meet...\n`)
}

async function poll() {
  const meetTabs = await getMeetTabs()

  if (meetTabs.length > 0 && !prompterProcess) {
    // Meet detected, start prompter
    const info = extractMeetInfo(meetTabs[0])
    activeMeetUrl = meetTabs[0].url
    startPrompter(info)
  } else if (meetTabs.length === 0 && prompterProcess) {
    // Meet closed, stop prompter
    stopPrompter()
  }
}

// ─── Main ────────────────────────────────────────────────────

console.log(`\n  Metatron Call Prompter — Watcher`)
console.log(`  ────────────────────────────────`)
console.log(`  CDP:      http://127.0.0.1:${CDP_PORT}`)
console.log(`  Poll:     ${POLL_INTERVAL / 1000}s`)
console.log(`  UI:       ${UI_PATH}`)
console.log(`\n  En attente d'un onglet Google Meet...`)
console.log(`  (Chrome doit tourner avec --remote-debugging-port=${CDP_PORT})\n`)

setInterval(poll, POLL_INTERVAL)
// First check immediately
poll()
