#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/pocket-arena}"
REPO_DIR="${REPO_DIR:-$APP_ROOT/repo}"
RELEASES_DIR="${RELEASES_DIR:-$APP_ROOT/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_ROOT/current}"
SERVICE_NAME="${SERVICE_NAME:-pocket-arena}"
BRANCH="${1:-${DEPLOY_BRANCH:-main}}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Missing Git repository at $REPO_DIR" >&2
  echo "Clone the repository there before running this script." >&2
  exit 1
fi

mkdir -p "$RELEASES_DIR"

cd "$REPO_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

revision="$(git rev-parse --short=12 HEAD)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_dir="$RELEASES_DIR/$timestamp-$revision"
previous_release=""
if [[ -L "$CURRENT_LINK" ]]; then
  previous_release="$(readlink -f "$CURRENT_LINK" || true)"
fi

mkdir -p "$release_dir"
git archive HEAD | tar -x -C "$release_dir"

cd "$release_dir"
npm ci
npm run typecheck
npm test
npm run build

ln -sfn "$release_dir" "$CURRENT_LINK"

if ! sudo systemctl restart "$SERVICE_NAME"; then
  echo "Service restart failed; rolling back current symlink." >&2
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$CURRENT_LINK"
    sudo systemctl restart "$SERVICE_NAME" || true
  fi
  exit 1
fi

for attempt in {1..20}; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "Deployed $revision and health check passed."
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
      sort -rn |
      awk -v keep="$KEEP_RELEASES" 'NR > keep { print $2 }' |
      xargs -r rm -rf
    exit 0
  fi
  sleep 1
done

echo "Health check failed; rolling back current symlink." >&2
if [[ -n "$previous_release" && -d "$previous_release" ]]; then
  ln -sfn "$previous_release" "$CURRENT_LINK"
  sudo systemctl restart "$SERVICE_NAME" || true
fi
exit 1
