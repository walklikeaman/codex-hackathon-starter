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
