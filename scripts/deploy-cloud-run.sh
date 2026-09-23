#!/usr/bin/env bash
# Builds the image with Cloud Build and deploys two Cloud Run services from it:
#   hotel-offer-api     public HTTP API + mock suppliers
#   hotel-offer-worker  Temporal worker (always-on CPU, internal ingress only)
#
# Safe to re-run: every resource is created only if missing.
# Configuration comes from the environment or from $DEPLOY_ENV_FILE
# (default: .env.cloud). See .env.cloud.example and the README.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${DEPLOY_ENV_FILE:-.env.cloud}"
if [[ -f "$ENV_FILE" ]]; then
  echo "Loading configuration from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

require() {
  local missing=0
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      echo "Missing required variable: $name" >&2
      missing=1
    fi
  done
  ((missing == 0)) || exit 1
}

require GCP_PROJECT TEMPORAL_ADDRESS TEMPORAL_NAMESPACE

REGION="${GCP_REGION:-us-central1}"
REPO="${AR_REPOSITORY:-hotel-offers}"
API_SERVICE="${API_SERVICE:-hotel-offer-api}"
WORKER_SERVICE="${WORKER_SERVICE:-hotel-offer-worker}"
RUN_SA_NAME="${RUN_SERVICE_ACCOUNT:-hotel-offer-run}"
RUN_SA="${RUN_SA_NAME}@${GCP_PROJECT}.iam.gserviceaccount.com"
TEMPORAL_KEY_SECRET="${TEMPORAL_API_KEY_SECRET:-temporal-api-key}"
REDIS_URL_SECRET="${REDIS_URL_SECRET:-redis-url}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO}/hotel-offer-orchestrator:${TAG}"

gc() { gcloud --project "$GCP_PROJECT" --quiet "$@"; }

echo "==> Project $GCP_PROJECT, region $REGION, image $IMAGE"

echo "==> Enabling required APIs"
gc services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com

if ! gc artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1; then
  echo "==> Creating Artifact Registry repository $REPO"
  gc artifacts repositories create "$REPO" --location "$REGION" \
    --repository-format docker --description "Hotel Offer Orchestrator images"
fi

if ! gc iam service-accounts describe "$RUN_SA" >/dev/null 2>&1; then
  echo "==> Creating runtime service account $RUN_SA"
  gc iam service-accounts create "$RUN_SA_NAME" \
    --display-name "Hotel Offer Orchestrator (Cloud Run)"
fi

# Creates the secret if missing, and adds a new version only when the value changed.
ensure_secret() {
  local secret="$1" value="${2:-}"
  if ! gc secrets describe "$secret" >/dev/null 2>&1; then
    [[ -n "$value" ]] || {
      echo "Secret $secret does not exist; set its value (see README)" >&2
      exit 1
    }
    echo "==> Creating secret $secret"
    printf '%s' "$value" | gc secrets create "$secret" \
      --replication-policy automatic --data-file=-
  elif [[ -n "$value" ]] &&
    [[ "$(gc secrets versions access latest --secret "$secret" 2>/dev/null)" != "$value" ]]; then
    echo "==> Updating secret $secret"
    printf '%s' "$value" | gc secrets versions add "$secret" --data-file=-
  fi
  gc secrets add-iam-policy-binding "$secret" \
    --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor \
    >/dev/null
}

ensure_secret "$TEMPORAL_KEY_SECRET" "${TEMPORAL_API_KEY:-}"
ensure_secret "$REDIS_URL_SECRET" "${REDIS_URL:-}"

echo "==> Building image with Cloud Build"
gc builds submit --tag "$IMAGE" .

COMMON_FLAGS=(
  --image "$IMAGE"
  --region "$REGION"
  --service-account "$RUN_SA"
  --set-secrets "TEMPORAL_API_KEY=${TEMPORAL_KEY_SECRET}:latest,REDIS_URL=${REDIS_URL_SECRET}:latest"
)
# Memorystore (private IP) needs Direct VPC egress; skip for public Redis (e.g. Upstash).
if [[ -n "${VPC_NETWORK:-}" ]]; then
  COMMON_FLAGS+=(
    --network "$VPC_NETWORK"
    --subnet "${VPC_SUBNET:-$VPC_NETWORK}"
    --vpc-egress private-ranges-only
  )
fi
TEMPORAL_ENV="TEMPORAL_ADDRESS=${TEMPORAL_ADDRESS},TEMPORAL_NAMESPACE=${TEMPORAL_NAMESPACE},TEMPORAL_TASK_QUEUE=${TEMPORAL_TASK_QUEUE:-hotel-offers},HOTEL_CACHE_TTL_SECONDS=${HOTEL_CACHE_TTL_SECONDS:-300}"

echo "==> Deploying API service $API_SERVICE"
gc run deploy "$API_SERVICE" "${COMMON_FLAGS[@]}" \
  --port 8080 \
  --allow-unauthenticated \
  --cpu 1 --memory 512Mi \
  --min-instances "${API_MIN_INSTANCES:-0}" \
  --max-instances "${API_MAX_INSTANCES:-10}" \
  --set-env-vars "$TEMPORAL_ENV"

API_URL="$(gc run services describe "$API_SERVICE" --region "$REGION" --format 'value(status.url)')"

# The worker polls Temporal instead of serving requests, so its CPU must stay
# allocated (--no-cpu-throttling) and at least one instance must stay up.
echo "==> Deploying worker service $WORKER_SERVICE"
gc run deploy "$WORKER_SERVICE" "${COMMON_FLAGS[@]}" \
  --command node --args dist/worker.js \
  --port 8080 \
  --no-allow-unauthenticated --ingress internal \
  --no-cpu-throttling \
  --cpu 1 --memory 1Gi \
  --min-instances "${WORKER_MIN_INSTANCES:-1}" \
  --max-instances "${WORKER_MAX_INSTANCES:-3}" \
  --set-env-vars "${TEMPORAL_ENV},SUPPLIER_BASE_URL=${API_URL}"

echo
echo "==> Deployed"
echo "API:     $API_URL"
echo "Try:     curl $API_URL/health"
echo "         curl \"$API_URL/api/hotels?city=delhi\""
