# ─────────────────────────────────────────────────────────────
# Dockerfile – workers/azure-ocr
#
# Runs the Azure Functions OCR worker on Azure Container Apps.
# The official azure-functions/node base image ships the
# Functions host, so the container is a drop-in replacement
# for a "func azure functionapp publish" deployment.
# ─────────────────────────────────────────────────────────────

# ── Stage 1: build ──────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /build

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Compile TypeScript
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN npm run build

# Prune dev-only deps so the runtime image stays lean
RUN npm prune --omit=dev

# ── Trim dead weight from node_modules ──────────────────────
RUN rm -rf \
      node_modules/@img/sharp-libvips-linuxmusl-x64 \
      node_modules/@img/sharp-linuxmusl-x64 \
      node_modules/@img/sharp-wasm32 \
      node_modules/@tesseract.js-data/eng/4.0.0 \
    && find node_modules \( -name '*.md' -o -name 'LICENSE*' -o -name 'CHANGELOG*' \) \
       -not -path '*/tesseract.js-core/*' -delete 2>/dev/null || true


# ── Stage 2: runtime ───────────────────────────────────────
FROM mcr.microsoft.com/azure-functions/node:4-node22

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

WORKDIR /home/site/wwwroot

# Copy the built app + production node_modules
COPY --from=build /build/dist/          dist/
COPY --from=build /build/node_modules/  node_modules/
COPY --from=build /build/package.json   package.json
COPY host.json                          host.json
