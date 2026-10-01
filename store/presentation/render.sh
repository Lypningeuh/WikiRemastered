#!/bin/sh
# Builds presentation.html (build.mjs), renders it at 2× and brings it down to 1280 × 800 for the
# store (sharper text):
#   sh store/presentation/render.sh  →  store/images/screenshot-0-presentation.png
# Needs Node, Google Chrome and a network connection (the cards show the site's pictures).
cd "$(dirname "$0")" || exit 1
node build.mjs >/dev/null || exit 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1280,800 --virtual-time-budget=6000 --screenshot="$PWD/presentation@2x.png" "file://$PWD/presentation.html" >/dev/null 2>&1
python3 -c "
from PIL import Image
Image.open('presentation@2x.png').convert('RGB').resize((1280, 800), Image.LANCZOS).save('../images/screenshot-0-presentation.png', optimize=True)"
rm -f presentation@2x.png
echo store/images/screenshot-0-presentation.png
