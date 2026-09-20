#!/usr/bin/env bash
# Builds build/ocr-worker.zip for AWS Lambda (nodejs22.x or newer; arm64 or x86_64: tesseract.js is WebAssembly,
# so there are no native binaries to match). Needs `zip` on the PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf build dist
mkdir -p build/lambda/lang

npm run --silent build
cp -R dist build/lambda/dist
cp package.json package-lock.json build/lambda/

# Production dependencies only, from the lockfile. No install scripts: nothing here needs one.
(cd build/lambda && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)

# The English model comes from a dev dependency that also carries variants we never load (14 MB in all).
# Ship just the one file tesseract.js reads, in lang/ beside dist/ (see resolveLangPath in src/env.ts).
cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz build/lambda/lang/
rm -rf build/lambda/node_modules/@tesseract.js-data   # npm leaves an empty folder for the omitted dev dependency

# The zip holds no .env and no source maps.
(cd build/lambda && zip -qr ../ocr-worker.zip . -x '*.map' -x '.env*')

echo "unpacked: $(du -sh build/lambda | cut -f1)   zip: $(du -h build/ocr-worker.zip | cut -f1)   (Lambda limits: 250 MB unpacked, 50 MB zip for a direct upload)"
