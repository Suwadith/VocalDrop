#!/bin/bash
# Get the directory where the script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Load environment so Node (npm) and Python are accessible
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -f ~/.zshrc ]; then source ~/.zshrc; fi
if [ -f ~/.bash_profile ]; then source ~/.bash_profile; fi
if [ -s "$HOME/.nvm/nvm.sh" ]; then source "$HOME/.nvm/nvm.sh"; fi

# Kill existing instances running on default ports
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8000 | xargs kill -9 2>/dev/null
pkill -f "cloudflared tunnel"

# Start backend
cd "$DIR/backend"
if [ -d "venv" ]; then
    source venv/bin/activate
fi
nohup python main.py > /dev/null 2>&1 &

# Start frontend in production mode (bypasses all Next.js dev server WebSocket/HMR issues over tunnels)
cd "$DIR/frontend"
nohup npm start > /dev/null 2>&1 &

# Wait a few seconds for servers to initialize
echo "Waiting for servers to initialize..."
sleep 5

# Start cloudflared tunnel in the background and log output
> /tmp/cloudflared.log
nohup cloudflared tunnel --http-host-header localhost --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &

# Wait for the URL to be generated (try for up to 15 seconds)
TUNNEL_URL=""
for i in {1..15}; do
    TUNNEL_URL=$(grep -o 'https://.*\.trycloudflare\.com' /tmp/cloudflared.log | head -n 1)
    if [ ! -z "$TUNNEL_URL" ]; then
        break
    fi
    sleep 1
done

if [ ! -z "$TUNNEL_URL" ]; then
    echo "=========================================================="
    echo "🎤 VocalDrop is Ready!"
    echo "Remote URL: $TUNNEL_URL"
    echo "=========================================================="
    
    # Try to copy to clipboard (Mac/Linux)
    if command -v pbcopy >/dev/null 2>&1; then
        echo -n "$TUNNEL_URL" | pbcopy
    elif command -v xclip >/dev/null 2>&1; then
        echo -n "$TUNNEL_URL" | xclip -selection clipboard
    fi
    
    # Try to show Mac notifications if on Mac
    if command -v osascript >/dev/null 2>&1; then
        osascript -e "display notification \"URL: $TUNNEL_URL\" with title \"🎤 VocalDrop is Ready!\" subtitle \"Copied to clipboard\""
        osascript -e "tell application \"System Events\" to display dialog \"VocalDrop is running in the background!\n\nRemote URL:\n$TUNNEL_URL\n\n(This link has already been copied to your clipboard)\" buttons {\"Awesome!\"} default button \"Awesome!\" with title \"VocalDrop Ready\""
    fi
else
    echo "Failed to generate Cloudflare tunnel URL. Check logs."
fi
