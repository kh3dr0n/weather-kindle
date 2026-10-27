#!/bin/sh
. /mnt/us/extensions/weathergraph/bin/common.sh

# Keep the device awake and hide the status bar while the graph is shown
lipc-set-prop com.lab126.powerd preventScreenSaver 1
lipc-set-prop com.lab126.pillow disableEnablePillow disable 2>/dev/null

while true; do
	fetch_and_show
	sleep $((INTERVAL_MIN * 60))
done
