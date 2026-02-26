#!/bin/zsh
set -e

# Start the Hiring app (Node + Express)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Ensure dependencies are installed (no-op if already installed)
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting server..."
echo "Open http://localhost:3000 in your browser"

npm run start

# Keep terminal open if the server exits
echo "Server stopped. Press Enter to close."
read
