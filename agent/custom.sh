#!/bin/bash
# Super-Retrogamers agent autostart.
#
# Deployed to /recalbox/share/system/custom.sh — invoked by /etc/init.d/S99custom
# at boot with "$1"=start and at shutdown with "$1"=stop:
#   test -e "/recalbox/share/system/custom.sh" && bash /recalbox/share/system/custom.sh $1
#
# The /recalbox/share partition is preserved across RecalboxOS upgrades, so this
# survives reboots AND OS updates. No exec bit needed (invoked via bash; the
# share is exfat and cannot carry exec bits anyway).

AGENT_DIR="/recalbox/share/system/sr-agent"
AGENT="$AGENT_DIR/agent.py"
LOG="$AGENT_DIR/agent.log"

case "$1" in
	stop)
		pkill -f "$AGENT" 2>/dev/null
		;;
	*)
		# start (also covers empty $1 when run by hand)
		if ! pgrep -f "$AGENT" >/dev/null 2>&1; then
			# detach stdin too (</dev/null) so a boot service / ssh session never
			# keeps the channel open by inheriting an open stdin fd
			nohup python3 "$AGENT" >>"$LOG" 2>&1 </dev/null &
		fi
		;;
esac
