#!/usr/bin/env bash
# Builds the release packages into dist/.
#   ImageFormatSaver.zip          Chrome, Edge, Brave, Opera, Vivaldi (unzip, then Load unpacked)
#   ImageFormatSaver-chrome.zip   same files, named for Chrome users
#   ImageFormatSaver-edge.zip     same files, named for Edge users
#   ImageFormatSaver-firefox.zip  Firefox package (Firefox manifest, files at the root)
set -euo pipefail
cd "$(dirname "$0")"
FILES="background.js convert.js options.html options.css options.js icons"
CHROMIUM_ONLY="offscreen.html offscreen.js offscreen-client.js"
OUT=dist; TMP=$(mktemp -d)
mkdir -p "$OUT"
rm -f "$OUT"/ImageFormatSaver*.zip

mkdir "$TMP/image-format-saver"
cp -r $FILES $CHROMIUM_ONLY manifest.json "$TMP/image-format-saver/"
(cd "$TMP" && zip -qr -X pkg.zip image-format-saver)
for n in ImageFormatSaver ImageFormatSaver-chrome ImageFormatSaver-edge; do cp "$TMP/pkg.zip" "$OUT/$n.zip"; done

mkdir "$TMP/ff"
cp -r $FILES "$TMP/ff/"
cp manifest.firefox.json "$TMP/ff/manifest.json"
(cd "$TMP/ff" && zip -qr -X ../ff.zip .)
cp "$TMP/ff.zip" "$OUT/ImageFormatSaver-firefox.zip"

rm -r "$TMP"
ls -l "$OUT"
