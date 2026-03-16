#!/usr/bin/env node

/**
 * Call Prompter Setup — Configure Chrome to always launch with CDP
 *
 * Automatically finds Chrome shortcuts and adds --remote-debugging-port=9222
 * so the prompter can capture Google Meet captions.
 *
 * Usage:
 *   node setup.mjs          (auto-detect and configure)
 *   node setup.mjs --undo   (remove CDP flag from shortcuts)
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const CDP_PORT = 9222
const FLAG = `--remote-debugging-port=${CDP_PORT}`
const isUndo = process.argv.includes('--undo')

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

function log(msg) { console.log(`  ${msg}`) }

console.log(`\n  Call Prompter Setup${isUndo ? ' (undo)' : ''}`)
console.log(`  ─────────────────────\n`)

if (isWin) {
  setupWindows()
} else if (isMac) {
  setupMac()
} else if (isLinux) {
  setupLinux()
} else {
  log(`Unsupported platform: ${process.platform}`)
  log(`Manually add "${FLAG}" to your Chrome launch command.`)
}

function setupWindows() {
  const paths = [
    `${process.env.APPDATA}\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\Google Chrome.lnk`,
    `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk`,
    `${process.env.USERPROFILE}\\Desktop\\Google Chrome.lnk`,
    `C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk`,
  ]

  let found = false
  for (const p of paths) {
    if (!existsSync(p)) continue
    found = true
    try {
      const ps = isUndo
        ? `$s = (New-Object -COM WScript.Shell).CreateShortcut('${p}'); $s.Arguments = $s.Arguments -replace '${FLAG}',''; $s.Arguments = $s.Arguments.Trim(); $s.Save()`
        : `$s = (New-Object -COM WScript.Shell).CreateShortcut('${p}'); if($s.Arguments -notmatch 'remote-debugging-port'){$s.Arguments += ' ${FLAG}'}; $s.Save()`
      execSync(`powershell -Command "${ps}"`, { stdio: 'pipe' })
      log(`${isUndo ? 'Removed' : 'Added'} CDP flag: ${p.split('\\').pop()}`)
    } catch (err) {
      log(`Failed: ${p.split('\\').pop()} (${err.message})`)
    }
  }

  // Create desktop shortcut if none found
  if (!found && !isUndo) {
    try {
      const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      const desktopLnk = `${process.env.USERPROFILE}\\Desktop\\Chrome CDP.lnk`
      const ps = `$s = (New-Object -COM WScript.Shell).CreateShortcut('${desktopLnk}'); $s.TargetPath = '${chromePath}'; $s.Arguments = '${FLAG}'; $s.IconLocation = '${chromePath},0'; $s.Description = 'Chrome with CDP for Call Prompter'; $s.Save()`
      execSync(`powershell -Command "${ps}"`, { stdio: 'pipe' })
      log(`Created: Chrome CDP.lnk on Desktop`)
    } catch {
      log(`No Chrome shortcuts found. Create one manually with flag: ${FLAG}`)
    }
  }

  if (!found && isUndo) log('No shortcuts found to undo.')

  log('')
  log(isUndo ? 'CDP flag removed. Restart Chrome.' : 'Done! Restart Chrome for CDP to take effect.')
  log(isUndo ? '' : `Verify: open chrome://version and check "Command Line" contains ${FLAG}`)
}

function setupMac() {
  const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.call-prompter.chrome-cdp.plist`

  if (isUndo) {
    try {
      execSync(`rm -f "${plistPath}"`, { stdio: 'pipe' })
      log('Removed Chrome CDP launch agent.')
    } catch { log('Nothing to undo.') }
    return
  }

  log('macOS: Chrome does not support modifying .app arguments directly.')
  log('Options:')
  log('')
  log('1. Terminal alias (add to ~/.zshrc):')
  log(`   alias chrome='open -a "Google Chrome" --args ${FLAG}'`)
  log('')
  log('2. Or launch from terminal before your call:')
  log(`   open -a "Google Chrome" --args ${FLAG}`)
  log('')
  log('Then run: bun watch.mjs')
}

function setupLinux() {
  const desktopFiles = [
    `${process.env.HOME}/.local/share/applications/google-chrome.desktop`,
    '/usr/share/applications/google-chrome.desktop',
  ]

  for (const p of desktopFiles) {
    if (!existsSync(p)) continue
    try {
      if (isUndo) {
        execSync(`sed -i 's/ ${FLAG}//g' "${p}"`, { stdio: 'pipe' })
        log(`Removed CDP flag: ${p}`)
      } else {
        const check = execSync(`grep -c '${FLAG}' "${p}" 2>/dev/null || echo 0`, { encoding: 'utf-8' }).trim()
        if (check === '0') {
          execSync(`sed -i 's|^Exec=\\(.*chrome\\)|Exec=\\1 ${FLAG}|' "${p}"`, { stdio: 'pipe' })
          log(`Added CDP flag: ${p}`)
        } else {
          log(`Already configured: ${p}`)
        }
      }
    } catch (err) {
      log(`Failed: ${p} (try with sudo)`)
    }
  }

  log('')
  log(isUndo ? 'CDP flag removed. Restart Chrome.' : 'Done! Restart Chrome for CDP to take effect.')
}
