/**
 * Example hooks file for Call Prompter
 *
 * Hooks let you plug your own pipelines into the analysis loop:
 * - RAG retrieval before each analysis
 * - CRM lookups
 * - Custom logging
 * - Post-call workflows
 *
 * Usage:
 *   cp hooks.example.mjs hooks.mjs
 *   # Edit hooks.mjs with your own logic
 *   bun server.mjs --prospect="Acme" --hooks=hooks.mjs
 *
 * Or just name it hooks.mjs in the project root — it's auto-loaded.
 */

export default {
  /**
   * Called BEFORE each LLM analysis.
   * Return a string that gets appended to the prompt as extra context.
   * Use this for RAG, vector search, CRM lookups, etc.
   *
   * @param {object} chunk - { text: string, ts: number }
   * @param {string} history - Last 10 chunks joined by newline
   * @param {string} userContext - Content from context.md or --context-file
   * @returns {Promise<string>} Extra context to inject into the prompt
   */
  async beforeAnalysis(chunk, history, userContext) {
    // Example: RAG retrieval from a vector database
    //
    // const results = await fetch('http://localhost:8080/search', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ query: chunk.text, top_k: 3 }),
    // }).then(r => r.json())
    //
    // return results.map(r => r.text).join('\n')

    // Example: CRM lookup based on keywords
    //
    // const keywords = chunk.text.match(/\b[A-Z][a-z]+\b/g) || []
    // const company = keywords.find(k => k.length > 3)
    // if (company) {
    //   const crm = await fetch(`http://localhost:3000/api/contacts?q=${company}`).then(r => r.json())
    //   return `CRM data: ${JSON.stringify(crm.results?.[0] || {})}`
    // }

    return '' // Return empty string for no extra context
  },

  /**
   * Called AFTER the LLM returns parsed insights.
   * Modify, enrich, or filter the insights before they're broadcast to the UI.
   *
   * @param {object} parsed - The parsed JSON from the LLM
   * @param {object} chunk - Current conversation chunk
   * @param {string} history - Recent conversation history
   * @returns {Promise<object>} Modified insights object
   */
  async afterAnalysis(parsed, chunk, history) {
    // Example: Add custom scoring
    //
    // const dealScore = parsed.closing_opportunity ? 90 :
    //   parsed.sentiment === 'hot' ? 70 :
    //   parsed.sentiment === 'warm' ? 50 : 30
    // return { ...parsed, deal_score: dealScore }

    // Example: Filter out low-confidence insights
    //
    // if (parsed.insight && parsed.insight.length < 10) {
    //   return { ...parsed, insight: null }
    // }

    return parsed
  },

  /**
   * Called on every new transcript chunk.
   * Use for logging, real-time streaming to other systems, etc.
   *
   * @param {object} chunk - { text: string, ts: number }
   */
  async onTranscript(chunk) {
    // Example: Log to a file
    //
    // const fs = await import('node:fs')
    // fs.appendFileSync('call-log.txt', `[${new Date(chunk.ts).toISOString()}] ${chunk.text}\n`)

    // Example: Stream to a webhook
    //
    // await fetch('https://your-webhook.com/transcript', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(chunk),
    // })
  },

  /**
   * Called when the call ends (watch mode only).
   * Use for post-call summaries, CRM updates, follow-up emails, etc.
   *
   * @param {string} fullTranscript - Complete call transcript
   * @param {object[]} insights - All insights from the call
   */
  async onCallEnd(fullTranscript, insights) {
    // Example: Send summary to Slack
    //
    // await fetch(process.env.SLACK_WEBHOOK, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     text: `Call ended. ${insights.length} insights. Sentiment: ${insights.at(-1)?.sentiment || 'unknown'}`,
    //   }),
    // })

    // Example: Trigger a post-call analysis pipeline
    //
    // await fetch('http://localhost:9900/execute', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     blueprint: 'call-intel',
    //     input: { call_transcript: fullTranscript, insights },
    //   }),
    // })
  },
}
