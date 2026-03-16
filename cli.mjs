#!/usr/bin/env node

/**
 * Call Prompter CLI — launch server, watch mode, or demo
 *
 * Usage:
 *   call-prompter --prospect="Client X" --context="Discovery"
 *   call-prompter --demo
 *   call-prompter --watch   (auto-detect Google Meet tabs)
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const isWatch = args.includes('--watch')
const script = isWatch ? 'watch.mjs' : 'server.mjs'

const child = spawn('bun', [join(__dirname, script), ...args.filter(a => a !== '--watch')], {
  stdio: 'inherit',
  cwd: __dirname,
})

child.on('exit', (code) => process.exit(code || 0))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
