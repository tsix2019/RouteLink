#!/usr/bin/env bash
# Local-only build environment for this Windows machine (C: is nearly full).
# Usage: source scripts/dev-env.sh
export GRADLE_USER_HOME="D:/.gradle-home"
export npm_config_cache="D:/.npm-cache"
export ANDROID_HOME="D:/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# PATH entries must be POSIX paths in Git Bash (a "D:" prefix would split on the colon).
_sdk_posix="$(cygpath -u "$ANDROID_HOME" 2>/dev/null || echo "$ANDROID_HOME")"
export PATH="$_sdk_posix/platform-tools:$_sdk_posix/emulator:$PATH"
unset _sdk_posix
if [ -z "$JAVA_HOME" ]; then
  JAVA_HOME="$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java.home = //p' | tr -d '\r')"
  export JAVA_HOME
fi
