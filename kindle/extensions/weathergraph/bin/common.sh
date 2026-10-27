#!/bin/sh
EXT_DIR="/mnt/us/extensions/weathergraph"
. "$EXT_DIR/weathergraph.conf"
PID_FILE="/tmp/weathergraph.pid"
IMG="/tmp/weathergraph.png"
LOG="/tmp/weathergraph.log"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

show_image() {
	if command -v fbink >/dev/null 2>&1; then
		fbink -q -c -f -g file="$1",halign=CENTER,valign=CENTER
	else
		eips -c
		eips -f -g "$1"
	fi
}

show_text() {
	if command -v fbink >/dev/null 2>&1; then
		fbink -q -pm -y -2 "$1"
	else
		eips 1 38 "$1"
	fi
}

wait_for_wifi() {
	lipc-set-prop com.lab126.cmd wirelessEnable 1 2>/dev/null
	i=0
	while [ $i -lt 30 ]; do
		[ "$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)" = "CONNECTED" ] && return 0
		sleep 2
		i=$((i + 1))
	done
	return 1
}

fetch_and_show() {
	if ! wait_for_wifi; then
		log "wifi not connected"
		show_text "Weather: no WiFi ($(date '+%H:%M'))"
		return 1
	fi
	if curl -fsS --max-time 60 -o "$IMG.tmp" "$SERVER_URL"; then
		mv "$IMG.tmp" "$IMG"
		show_image "$IMG"
		log "updated"
	else
		log "download failed"
		rm -f "$IMG.tmp"
		[ -f "$IMG" ] && show_image "$IMG"
		show_text "Weather: server unreachable ($(date '+%H:%M'))"
		return 1
	fi
}
