#!/bin/zsh

cd "$(dirname "$0")" || exit 1

port=5173

echo "Starting local server at http://localhost:$port"
echo "Press Ctrl+C to stop."
python3 -m http.server "$port"
