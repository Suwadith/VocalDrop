#!/bin/bash

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Use AppleScript to open two new Terminal windows and run the servers
osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '$DIR/backend' && source venv/bin/activate && python main.py"
    do script "cd '$DIR/frontend' && npm run dev"
end tell
EOF

# Wait a few seconds for the servers to start
sleep 4

# Open the app in the default web browser
open http://localhost:3000
