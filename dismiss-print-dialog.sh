#!/bin/sh
# Presses Back whenever the system print dialog has focus, so the printAsync run can continue on
# its own. It never presses Back while the app has focus. Stop with Ctrl+C.
while true; do
  if adb shell dumpsys window | grep -E 'mCurrentFocus=' | grep -q printspooler; then
    adb shell input keyevent KEYCODE_BACK
  fi
  sleep 0.3
done
