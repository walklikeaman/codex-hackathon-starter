#!/usr/bin/env bash
#
# Start the enrichment again by itself after the machine restarts.
#
#   bash scripts/install-enrich-agent.sh          # install and start
#   bash scripts/install-enrich-agent.sh --status # is it loaded, is it running
#   bash scripts/install-enrich-agent.sh --remove # stop and forget it
#
# `enrich-loop.sh` survives the script dying; nothing survived the MACHINE dying, and
# that is how the 16.09 run was lost. A LaunchAgent closes the last hole.
#
# **It starts at LOGIN, not at boot.** A user agent has no session to run in until
# somebody logs in, so a machine sitting at the login window is a machine not enriching.
# Running it through a boot is a LaunchDaemon, which runs as root before login — worth
# doing only if the laptop is left at the login screen on purpose, and not worth root
# for a job that reads Wikipedia.
#
# KeepAlive is conditional on purpose. `enrich-loop.sh` exits 0 only when the catalogue
# is finished, and an agent that restarted THAT would read the whole thing again; it
# exits non-zero when it was killed or gave up, which is worth restarting — after five
# minutes, so a broken configuration cannot become a hot loop.

set -euo pipefail

LABEL="com.glorymap.enrich"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="gui/$(id -u)"

case "${1:-}" in
  --status)
    launchctl print "$TARGET/$LABEL" 2>/dev/null | sed -n '1,12p' || echo "not loaded"
    pgrep -fl "enrich-loop.sh" || echo "no supervisor process"
    exit 0
    ;;
  --remove)
    launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
    [ -f "$PLIST" ] && rm "$PLIST"
    echo "removed $LABEL"
    exit 0
    ;;
esac

# The agent gets the PATH launchd gives it, which is not the one this shell has — so the
# directory node actually lives in is written into the plist rather than assumed.
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "no node on PATH — install it first" >&2; exit 1; }
NODE_DIR="$(dirname "$NODE")"

[ -x "$ROOT/scripts/enrich-loop.sh" ] || [ -f "$ROOT/scripts/enrich-loop.sh" ] || {
  echo "no scripts/enrich-loop.sh under $ROOT" >&2; exit 1; }

# **The keys must outlive the worktree they happen to live in.** The only .env.local with a
# service key sits inside `.claude/worktrees/…`, which is a scratch directory an agent
# session created and some later session may delete. That is survivable for a job somebody
# starts by hand and reads the error from; it is not survivable for one that is supposed to
# come back by itself after a reboot. So the file is copied once to a path that belongs to
# nobody's scratch, and the plist names that copy.
#
# The loop script is asked which file it would choose rather than the question being asked
# twice in two places and drifting.
ENV_FILE="${ENV_FILE:-$(bash "$ROOT/scripts/enrich-loop.sh" --print-env-file)}"
[ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ] || { echo "no usable env file" >&2; exit 1; }
case "$ENV_FILE" in
  */.claude/worktrees/*)
    DURABLE="$HOME/.glorymap.env"
    cp "$ENV_FILE" "$DURABLE"
    chmod 600 "$DURABLE"
    echo "copied the keys out of a scratch worktree into $DURABLE (chmod 600)"
    echo "  source: $ENV_FILE"
    ENV_FILE="$DURABLE"
    ;;
esac

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/enrich-loop.sh</string>
    <string>--limit</string>
    <string>5500</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>ENV_FILE</key><string>$ENV_FILE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>$HOME/enrich-agent.log</string>
  <key>StandardErrorPath</key><string>$HOME/enrich-agent.log</string>
</dict>
</plist>
PLIST_END

plutil -lint "$PLIST" >/dev/null
launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
launchctl bootstrap "$TARGET" "$PLIST"

echo "installed $PLIST"
echo "  run log:   ~/enrich.log"
echo "  agent log: ~/enrich-agent.log   (launchd's own stdout, usually the lock message)"
echo "  status:    bash scripts/install-enrich-agent.sh --status"
