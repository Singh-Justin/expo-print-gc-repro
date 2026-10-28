#!/bin/sh
# Forces a Java GC in the app about 10 times a second. ART answers SIGUSR1 with a forced GC
# ("SIGUSR1 forcing GC" in logcat). Needs a debuggable build, such as `npx expo run:android`.
# Stop with Ctrl+C.
PKG=${1:-com.example.printgcrepro}
exec adb shell "run-as $PKG sh -c 'while true; do P=\$(pidof $PKG); [ -n \"\$P\" ] && kill -10 \$P; sleep 0.1; done'"
