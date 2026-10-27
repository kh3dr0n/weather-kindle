#!/bin/sh
. /mnt/us/extensions/weathergraph/bin/common.sh

if [ -f "$PID_FILE" ]; then
	kill "$(cat "$PID_FILE")" 2>/dev/null
	rm -f "$PID_FILE"
fi
pkill -f weathergraph/bin/loop.sh 2>/dev/null

lipc-set-prop com.lab126.powerd preventScreenSaver 0
lipc-set-prop com.lab126.pillow disableEnablePillow enable 2>/dev/null
log "stopped"

# Repaint the normal Kindle UI
sleep 1
eips -c
lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home 2>/dev/null
