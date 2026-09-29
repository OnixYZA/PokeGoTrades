#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# deploy-aca.sh – Build workers/azure-ocr and roll it out to its Azure Container App
#
# The infrastructure already exists (provisioned in the portal): the resource group, the ACR (admin user
# disabled), the Container Apps environment, and the app itself, which pulls from ACR through its user-assigned
# identity. This script never creates any of that — it builds an image, points the app at it, and refuses to
# roll out onto an app whose Supabase wiring is missing or holds the service role key in plaintext.
#
# Prerequisites:
#   • az CLI logged in                       (az login)
#   • The app's secrets set once             (the preflight below prints the commands if they aren't)
#
# Usage:
#   bash workers/azure-ocr/deploy-aca.sh
# ──────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

# ── Tunables ────────────────────────────────────────────────
RESOURCE_GROUP="${ACA_RESOURCE_GROUP:-pgt-ocr-rg}"
ACA_APP="${ACA_APP_NAME:-pgt-ocr-app}"
ACR_NAME="${ACA_ACR_NAME:-pgtocr}"
IMAGE_REPO="${ACA_IMAGE_REPO:-pgt-ocr}"
# ────────────────────────────────────────────────────────────

# A fresh tag per deploy: pointing the app at the same `:latest` string again leaves its revision template
# unchanged, so there is nothing new to roll out. The same id names the new revision.
DEPLOY_ID="v$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
IMAGE="${ACR_NAME}.azurecr.io/${IMAGE_REPO}:${DEPLOY_ID}"

echo "═══ 1/3  Preflight ═══"
# Names and secret refs only (`SUPABASE_URL=`, `SUPABASE_SERVICE_ROLE_KEY=service-role-key`, ...), never values.
ENV_WIRING=$(az containerapp show \
  --name "$ACA_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.containers[0].env[].join('=', [name, secretRef || ''])" \
  --output tsv)

if ! grep -qx 'SUPABASE_URL=' <<<"$ENV_WIRING" \
  || ! grep -qx 'SUPABASE_SERVICE_ROLE_KEY=service-role-key' <<<"$ENV_WIRING"; then
  cat >&2 <<EOF
$ACA_APP needs SUPABASE_URL set and SUPABASE_SERVICE_ROLE_KEY read from its 'service-role-key' secret
(src/core/env.ts throws without them). Set them once, then re-run:

  printf 'Supabase service_role key: '; read -rs SRK; echo
  printf %s "\$SRK" | az containerapp secret set -g $RESOURCE_GROUP -n $ACA_APP --secrets service-role-key=@- --output none
  unset SRK
  az containerapp update -g $RESOURCE_GROUP -n $ACA_APP --output none --set-env-vars \\
    SUPABASE_URL=https://<project-ref>.supabase.co \\
    SUPABASE_SERVICE_ROLE_KEY=secretref:service-role-key
EOF
  exit 1
fi

if ! grep -qx 'PGT_WORKER_SECRET=pgt-worker-secret' <<<"$ENV_WIRING"; then
  cat >&2 <<EOF
$ACA_APP needs PGT_WORKER_SECRET read from its 'pgt-worker-secret' secret (src/core/env.ts's readWorkerSecret,
checked by src/functions/profileOcr.ts on every request now that it's authLevel 'anonymous'). Set it once, then
re-run:

  SECRET=\$(openssl rand -hex 32)
  printf %s "\$SECRET" | az containerapp secret set -g $RESOURCE_GROUP -n $ACA_APP --secrets pgt-worker-secret=@- --output none
  printf %s "\$SECRET" | pbcopy
  unset SECRET
  az containerapp update -g $RESOURCE_GROUP -n $ACA_APP --output none --set-env-vars \\
    PGT_WORKER_SECRET=secretref:pgt-worker-secret

The same value is now on your clipboard: paste it into Supabase Vault as 'azure_ocr_key' (the dashboard's Vault
UI, not the SQL editor, so it never lands in SQL history), then copy something else over it.
EOF
  exit 1
fi

# The Functions host keeps the timer's schedule in AzureWebJobsStorage (profileOcr no longer needs a function
# key from it — see the PGT_WORKER_SECRET check above). Warn rather than fail: the worker's own code never reads it.
if ! grep -qx 'AzureWebJobsStorage=webjobs-storage' <<<"$ENV_WIRING"; then
  echo "warning: AzureWebJobsStorage is not read from a 'webjobs-storage' secret on $ACA_APP." >&2
fi

echo "═══ 2/3  Build & push ${IMAGE} ═══"
# ACR Tasks are blocked on Azure for Students subscriptions, so we build locally and push.
# We explicitly build for linux/amd64 so the image matches Container Apps even when deployed from Apple Silicon.
az acr login --name "$ACR_NAME"
docker build --platform linux/amd64 \
  -t "${ACR_NAME}.azurecr.io/${IMAGE_REPO}:${DEPLOY_ID}" \
  -t "${ACR_NAME}.azurecr.io/${IMAGE_REPO}:latest" \
  -f Dockerfile \
  .

docker push "${ACR_NAME}.azurecr.io/${IMAGE_REPO}:${DEPLOY_ID}"
docker push "${ACR_NAME}.azurecr.io/${IMAGE_REPO}:latest"

echo "═══ 3/3  Roll out ═══"
# min-replicas 1: ocrSweep is a timer inside the Functions host, so it only fires while a replica is running.
# Scaled to zero, nothing drains listing_proofs at all, and profile_proofs only moves when the webhook calls in.
az containerapp update \
  --name "$ACA_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE" \
  --min-replicas 1 \
  --output none

FQDN=$(az containerapp show \
  --name "$ACA_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" \
  --output tsv)

LATEST_REV=$(az containerapp show -g "$RESOURCE_GROUP" -n "$ACA_APP" --query properties.latestRevisionName -o tsv)
echo ""
echo "  Revision:              ${LATEST_REV}"
echo "  Image:                 ${IMAGE}"
echo "  Profile OCR endpoint:  https://${FQDN}/api/profile-ocr"
echo ""
echo "  Health:  az containerapp revision show -g $RESOURCE_GROUP -n $ACA_APP --revision ${LATEST_REV} \\"
echo "             --query '{health:properties.healthState, running:properties.runningState}'"
