#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${PORT:-3000}"
TUNNEL_LOG="$(mktemp)"
TUNNEL_PID=""

cleanup() {
  if [[ -n "$TUNNEL_PID" ]]; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT INT TERM

echo "Starting Cloudflare quick tunnel to localhost:$PORT..."
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

echo "Waiting for HTTPS tunnel URL..."
PUBLIC_URL=""
for _ in {1..60}; do
  PUBLIC_URL="$(grep -oE 'https://[-a-z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    break
  fi
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "Cloudflare tunnel exited unexpectedly:" >&2
    cat "$TUNNEL_LOG" >&2
    exit 1
  fi
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "Timed out waiting for the tunnel URL:" >&2
  cat "$TUNNEL_LOG" >&2
  exit 1
fi

echo
echo "Phone controller URL (scan QR from this host): $PUBLIC_URL"
echo

PORT="$PORT" PUBLIC_BASE_URL="$PUBLIC_URL" npm run dev
