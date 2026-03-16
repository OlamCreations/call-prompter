#!/bin/bash
echo ""
echo "  Call Prompter - Starting..."
echo "  --------------------------"
echo ""

# Kill any existing server
lsof -ti:4242,4243 2>/dev/null | xargs kill -9 2>/dev/null
sleep 1

cd "$(dirname "$0")"

echo "  UI: http://127.0.0.1:4243"
echo "  Press Ctrl+C to stop"
echo ""

bun server.mjs "$@" 2>/dev/null || node server.mjs "$@"
