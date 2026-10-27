#!/bin/sh
. /mnt/us/extensions/weathergraph/bin/common.sh

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
	fetch_and_show
	exit 0
fi

# Give KUAL time to close its menu before we draw
sleep 2
nohup sh "$EXT_DIR/bin/loop.sh" >/dev/null 2>&1 &
echo $! > "$PID_FILE"
log "started (pid $!)"
