#!/usr/bin/env node

/**
 * Record a demo video of Call Prompter for LinkedIn/GitHub
 * Requires: playwright (npx playwright install chromium)
 * Usage: node record-demo.mjs
 */

import { chromium } from 'playwright'

const OUTPUT_DIR = 'C:/dev/projects/open-source/call-prompter'

async function main() {
  console.log('Launching browser...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1280, height: 720 },
    },
  })

  const page = await context.newPage()
  console.log('Navigating to UI...')
  await page.goto('http://127.0.0.1:4243/ui.html')
  await page.waitForTimeout(2000)

  console.log('Starting demo mode (double-click)...')
  await page.dblclick('#feed')

  console.log('Recording 45 seconds of demo...')
  await page.waitForTimeout(45000)

  // Final screenshot
  await page.screenshot({ path: `${OUTPUT_DIR}/screenshot.png`, type: 'png' })
  console.log('Screenshot saved')

  await page.close()
  const videoPath = await page.video()?.path()
  console.log('Video saved:', videoPath)

  await context.close()
  await browser.close()
  console.log('Done!')
}

main().catch(console.error)
