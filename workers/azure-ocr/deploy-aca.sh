#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# deploy-aca.sh – Deploy workers/azure-ocr to Azure Container Apps
#
# Prerequisites:
#   • az CLI logged in        (az login)
#   • Docker running locally  (docker info)
#
# Usage:
#   cd workers/azure-ocr
#   bash deploy-aca.sh
#
# First run creates everything. Re-runs update the container.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

# ── Tunables ────────────────────────────────────────────────
RESOURCE_GROUP="${ACA_RESOURCE_GROUP:-pokego-ocr-rg}"
LOCATION="${ACA_LOCATION:-centralindia}"
ACR_NAME="${ACA_ACR_NAME:-pokegoocrregistry}"
ACA_ENV="${ACA_ENV_NAME:-pokego-ocr-env}"
ACA_APP="${ACA_APP_NAME:-pokego-ocr-worker}"
IMAGE_TAG="${ACA_IMAGE_TAG:-latest}"
# ────────────────────────────────────────────────────────────

IMAGE="${ACR_NAME}.azurecr.io/${ACA_APP}:${IMAGE_TAG}"

echo "═══ 1/6  Resource group ═══"
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

echo "═══ 2/6  Container registry (ACR) ═══"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled true \
  --output none 2>/dev/null || true   # idempotent

echo "═══ 3/6  Build & push image ═══"
az acr build \
  --registry "$ACR_NAME" \
  --image "${ACA_APP}:${IMAGE_TAG}" \
  --file Dockerfile \
  .

echo "═══ 4/6  Container Apps environment ═══"
az containerapp env create \
  --name "$ACA_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none 2>/dev/null || true   # idempotent

echo "═══ 5/6  Deploy container app ═══"
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

if az containerapp show --name "$ACA_APP" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  # Update existing app
  az containerapp update \
    --name "$ACA_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$IMAGE" \
    --output none
else
  # Create new app
  az containerapp create \
    --name "$ACA_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ACA_ENV" \
    --image "$IMAGE" \
    --registry-server "${ACR_NAME}.azurecr.io" \
    --registry-username "$ACR_NAME" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 80 \
    --ingress external \
    --cpu 1 \
    --memory 2Gi \
    --min-replicas 1 \
    --max-replicas 3 \
    --env-vars \
      "AzureWebJobsStorage=UseDevelopmentStorage=false" \
      "FUNCTIONS_WORKER_RUNTIME=node" \
      "SUPABASE_URL=secretref:supabase-url" \
      "SUPABASE_SERVICE_ROLE_KEY=secretref:service-role-key" \
      "OCR_SWEEP_ON_STARTUP=true" \
    --output none
fi

echo "═══ 6/6  Done! ═══"
FQDN=$(az containerapp show \
  --name "$ACA_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" \
  -o tsv)

echo ""
echo "  App URL:  https://${FQDN}"
echo "  Profile OCR endpoint:  https://${FQDN}/api/profile-ocr"
echo ""
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │  IMPORTANT: Set secrets before the first sweep fires:   │"
echo "  │                                                         │"
echo "  │  az containerapp secret set \\                           │"
echo "  │    --name $ACA_APP \\                                    │"
echo "  │    --resource-group $RESOURCE_GROUP \\                   │"
echo "  │    --secrets \\                                          │"
echo "  │      supabase-url=<your-supabase-url> \\                 │"
echo "  │      service-role-key=<your-service-role-key>            │"
echo "  └──────────────────────────────────────────────────────────┘"
