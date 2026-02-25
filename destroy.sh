#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="agentcore-gui"
REGION="${AWS_REGION:-us-east-1}"

RED='\033[0;31m' GREEN='\033[0;32m' CYAN='\033[0;36m' BOLD='\033[1;37m' DIM='\033[0;90m' NC='\033[0m'
step()  { echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n${BOLD}$1${NC}"; }
ok()    { echo -e "  ${GREEN}✅ $1${NC}"; }
info()  { echo -e "  ${DIM}▸${NC} $1"; }
fail()  { echo -e "  ${RED}❌ $1${NC}"; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${STACK_NAME}"

echo -e "\n${RED}⚠️  This will permanently destroy:${NC}"
echo -e "  • CloudFormation stack: ${BOLD}${STACK_NAME}${NC}"
echo -e "  • ECR repository: ${BOLD}${STACK_NAME}${NC}"
echo -e "  • Region: ${BOLD}${REGION}${NC}"
echo -e "  • Account: ${BOLD}${ACCOUNT_ID}${NC}"
echo ""
read -p "Type 'destroy' to confirm: " CONFIRM
[[ "$CONFIRM" == "destroy" ]] || { echo "Aborted."; exit 0; }

# ─── Scale ECS to 0 first (speeds up stack delete) ───
step "🔽 Scaling ECS service to 0"
CLUSTER=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ECSClusterName'].OutputValue" --output text 2>/dev/null || true)
SERVICE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ECSServiceName'].OutputValue" --output text 2>/dev/null || true)
if [[ -n "$CLUSTER" && -n "$SERVICE" ]]; then
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count 0 --region "$REGION" --no-cli-pager >/dev/null 2>&1 || true
  ok "Scaled to 0"
else
  info "Stack not found or no service, skipping"
fi

# ─── Delete CloudFormation stack ───
step "🗑️  Deleting CloudFormation stack: ${STACK_NAME}"
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
  info "Waiting for stack deletion (this may take a few minutes)..."
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
  ok "Stack deleted"
else
  info "Stack does not exist, skipping"
fi

# ─── Delete ECR repository ───
step "🗑️  Deleting ECR repository: ${STACK_NAME}"
if aws ecr describe-repositories --repository-names "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws ecr delete-repository --repository-name "$STACK_NAME" --region "$REGION" --force --no-cli-pager >/dev/null
  ok "ECR repository deleted"
else
  info "ECR repository does not exist, skipping"
fi

step "🎉 Teardown complete!"
echo -e "  All resources for ${BOLD}${STACK_NAME}${NC} have been removed.\n"
