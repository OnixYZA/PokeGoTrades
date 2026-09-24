#!/usr/bin/env bash
# Builds build/ocr-worker.zip for AWS Lambda (nodejs22.x or newer). Needs `zip` on the PATH.
#
# tesseract.js is WebAssembly and matches any architecture, but sharp (used for the pixel-dimension check
# in src/process.ts) ships prebuilt native binaries, and npm resolves those against the *building* machine.
# Packaging on macOS therefore yields @img/sharp-darwin-* and a Lambda that dies on its first proof. The
# install below pins the target platform explicitly; set ARCH=arm64 for a Graviton function.
set -euo pipefail
cd "$(dirname "$0")/.."

ARCH="${ARCH:-x64}"

rm -rf build dist
mkdir -p build/lambda/lang

npm run --silent build
cp -R dist build/lambda/dist
cp package.json package-lock.json build/lambda/

# Production dependencies only, from the lockfile. No install scripts: nothing here needs one.
(cd build/lambda && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)

# Replace the build host's sharp binaries with the ones Lambda actually runs. sharp picks its prebuilt
# @img/sharp-<platform> package from the host, so this has to be asked for by name; --libc=glibc matches
# the Amazon Linux base image.
(cd build/lambda && rm -rf node_modules/@img \
  && npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error \
       --os=linux --cpu="$ARCH" --libc=glibc sharp)

# The English model comes from a dev dependency that also carries variants we never load (14 MB in all).
# Ship just the one file tesseract.js reads, in lang/ beside dist/ (see resolveLangPath in src/env.ts).
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz build/lambda/lang/
rm -rf build/lambda/node_modules/@tesseract.js-data   # npm leaves an empty folder for the omitted dev dependency

# The zip holds no .env and no source maps.
(cd build/lambda && zip -qr ../ocr-worker.zip . -x '*.map' -x '.env*')

echo "unpacked: $(du -sh build/lambda | cut -f1)   zip: $(du -h build/ocr-worker.zip | cut -f1)   (Lambda limits: 250 MB unpacked, 50 MB zip for a direct upload)"
