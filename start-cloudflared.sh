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

# Start frontend
cd "$DIR/frontend"
nohup npm run dev > /dev/null 2>&1 &

# Wait a few seconds for servers to initialize
echo "Waiting for servers to initialize..."
sleep 5

# Start cloudflared tunnel
echo "=========================================================="
echo "Starting Cloudflare Tunnel!"
echo "Look for the green 'https://[random-words].trycloudflare.com' URL below."
echo "You can open that URL on your phone or share it with others."
echo "Press Ctrl+C to stop the tunnel."
echo "=========================================================="

cloudflared tunnel --url http://localhost:3000
