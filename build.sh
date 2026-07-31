#!/bin/sh
# Build, stamping the bundle with the time it was made.
#
# Alt1 caches app bundles, so "reload it" and "it is reloaded" have been
# indistinguishable more than once. The stamp shows in the top right of the app,
# so a screenshot answers the question by itself.
set -e
cd "$(dirname "$0")"
STAMP=$(date +"%d %b %H:%M")
printf "// Which build this is, so a screenshot says so without anyone having to guess.\n// Rewritten by build.sh — do not edit by hand.\nexport default '%s';\n" "$STAMP" > src/js/build.js
NODE_OPTIONS=--openssl-legacy-provider npm run production
echo "stamped $STAMP"
