#!/usr/bin/env bash
# One-time GCP bootstrap for kylenowski.com. Safe to re-run.
#
# Creates only what Terraform/CI need before they can manage everything else:
#   - the APIs Terraform needs to start
#   - a GCS bucket for Terraform state
#   - Workload Identity Federation so GitHub Actions can log in to GCP with no keys
#   - two CI service accounts:
#       ci-deployer  admin-level; usable ONLY by workflow runs on refs/heads/main
#       ci-reader    read-only;   usable by any run in this repo (PR plans, inspect workflow)
#   - a monthly budget alert (best effort)
#
# Run as a project Owner:  gcloud auth login && ./scripts/bootstrap-gcp.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-kylenowski-com}"
REGION="${REGION:-us-central1}"
BUDGET_USD="${BUDGET_USD:-10}"

# GitHub identity. Numeric IDs (not names) so a renamed/re-created repo can't inherit access.
GITHUB_REPO="kchrzanowski3/kylenowski.com"
GITHUB_REPO_ID="1466849242"
GITHUB_OWNER_ID="24440832"

STATE_BUCKET="${PROJECT_ID}-tfstate"
POOL="github"
PROVIDER="github"
DEPLOYER="ci-deployer"
READER="ci-reader"

g() { gcloud --project="$PROJECT_ID" --quiet "$@"; }

PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOYER_SA="${DEPLOYER}@${PROJECT_ID}.iam.gserviceaccount.com"
READER_SA="${READER}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"

echo "==> Enabling bootstrap APIs"
g services enable \
  serviceusage.googleapis.com cloudresourcemanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  storage.googleapis.com billingbudgets.googleapis.com cloudbilling.googleapis.com

echo "==> Terraform state bucket gs://${STATE_BUCKET}"
if ! g storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  g storage buckets create "gs://${STATE_BUCKET}" \
    --location="$REGION" --uniform-bucket-level-access --public-access-prevention
fi
g storage buckets update "gs://${STATE_BUCKET}" --versioning >/dev/null

echo "==> Workload Identity pool + GitHub OIDC provider"
if ! g iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  g iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
fi
WIF_ARGS=(
  --location=global --workload-identity-pool="$POOL"
  --issuer-uri="https://token.actions.githubusercontent.com"
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref"
  --attribute-condition="assertion.repository_id == '${GITHUB_REPO_ID}' && assertion.repository_owner_id == '${GITHUB_OWNER_ID}'"
)
if g iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  g iam workload-identity-pools providers update-oidc "$PROVIDER" "${WIF_ARGS[@]}" >/dev/null
else
  g iam workload-identity-pools providers create-oidc "$PROVIDER" "${WIF_ARGS[@]}" --display-name="GitHub Actions"
fi

echo "==> CI service accounts"
for sa in "$DEPLOYER" "$READER"; do
  if ! g iam service-accounts describe "${sa}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    g iam service-accounts create "$sa" --display-name="GitHub Actions: ${sa}"
  fi
done

grant() { g projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null; }

# Deployer: manages everything Terraform owns (incl. IAM), so it is effectively an admin.
# That's why only runs on main can use it.
for role in roles/editor roles/resourcemanager.projectIamAdmin roles/iam.serviceAccountAdmin roles/firebase.admin; do
  grant "$DEPLOYER_SA" "$role"
done
# Reader: can see everything, change nothing.
for role in roles/viewer roles/iam.securityReviewer roles/logging.viewer; do
  grant "$READER_SA" "$role"
done

g storage buckets add-iam-policy-binding "gs://${STATE_BUCKET}" --member="serviceAccount:${DEPLOYER_SA}" --role=roles/storage.objectAdmin >/dev/null
g storage buckets add-iam-policy-binding "gs://${STATE_BUCKET}" --member="serviceAccount:${READER_SA}" --role=roles/storage.objectViewer >/dev/null

echo "==> Letting GitHub Actions impersonate the CI service accounts"
g iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.ref/refs/heads/main" >/dev/null
g iam service-accounts add-iam-policy-binding "$READER_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository_id/${GITHUB_REPO_ID}" >/dev/null

echo "==> Budget alert (\$${BUDGET_USD}/month)"
BILLING_ACCOUNT="$(g billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' | sed 's#billingAccounts/##')"
if [ -z "$BILLING_ACCOUNT" ]; then
  echo "    !! No billing account linked to ${PROJECT_ID}. Link one in the console (Billing), then re-run."
elif g billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)' 2>/dev/null | grep -qx "${PROJECT_ID} monthly"; then
  echo "    already exists"
else
  g billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name="${PROJECT_ID} monthly" \
    --budget-amount="${BUDGET_USD}USD" --filter-projects="projects/${PROJECT_ID}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    || echo "    !! Could not create the budget (needs Billing Account Administrator/Costs Manager). Create it in the console instead."
fi

cat <<EOF

Done. Values for the workflows (not secrets):
  GCP_PROJECT_ID   = ${PROJECT_ID}
  GCP_WIF_PROVIDER = ${POOL_ID}/providers/${PROVIDER}
  GCP_DEPLOYER_SA  = ${DEPLOYER_SA}
  GCP_READER_SA    = ${READER_SA}
  TF_STATE_BUCKET  = ${STATE_BUCKET}
EOF
