#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───
STACK_NAME="agentcore-gui-custom"
REGION="${AWS_REGION:-us-east-1}"
TEMPLATE="infrastructure/template.yaml"

# ─── Parse args ───
MODE="full"
IMAGE_TAG="latest"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick|-q) MODE="quick"; shift ;;
    --tag|-t)   IMAGE_TAG="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: ./deploy.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --quick, -q    Build, push, and roll ECS only (skip SAM deploy)"
      echo "  --tag, -t TAG  Image tag (default: latest)"
      echo "  --help, -h     Show this help"
      echo ""
      echo "Examples:"
      echo "  ./deploy.sh              Full deploy (infra + app)"
      echo "  ./deploy.sh -q           Quick app-only deploy"
      echo "  ./deploy.sh -q -t v1.2   Quick deploy with custom tag"
      exit 0 ;;
    *) IMAGE_TAG="$1"; shift ;;
  esac
done

# ─── Colors ───
R='\033[0;31m' G='\033[0;32m' Y='\033[0;33m' B='\033[0;34m'
M='\033[0;35m' C='\033[0;36m' W='\033[1;37m' D='\033[0;90m' N='\033[0m'

step()  { echo -e "\n${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"; echo -e "${W}$1${N}"; }
info()  { echo -e "  ${D}▸${N} $1"; }
ok()    { echo -e "  ${G}✅ $1${N}"; }
warn()  { echo -e "  ${Y}⚠️  $1${N}"; }
fail()  { echo -e "  ${R}❌ $1${N}"; exit 1; }
link()  { echo -e "  ${M}🔗 $1${N}"; }
val()   { echo -e "  ${B}$1${N} ${W}$2${N}"; }

# ─── Preflight ───
step "🔍 Preflight checks"
command -v aws    >/dev/null || fail "aws CLI not found"
command -v docker >/dev/null || fail "docker not found"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")
ok "AWS Account: ${ACCOUNT_ID}"
ok "Region: ${REGION}"
info "Mode: ${MODE} | Tag: ${IMAGE_TAG}"

# Derived values
ECR_DOMAIN="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
ECR_URI="${ECR_DOMAIN}/${STACK_NAME}"
FULL_IMAGE="${ECR_URI}:${IMAGE_TAG}"

# ─── Build Docker Image ───
step "🐳 Building Docker image"
docker build -t "${STACK_NAME}:${IMAGE_TAG}" . 2>&1 | tail -1
ok "Image built: ${STACK_NAME}:${IMAGE_TAG}"
SIZE=$(docker images "${STACK_NAME}:${IMAGE_TAG}" --format '{{.Size}}')
val "📦 Image size:" "$SIZE"

# ─── Ensure ECR repo exists ───
step "🗄️  Ensuring ECR repository exists"
if aws ecr describe-repositories --repository-names "$STACK_NAME" --region "$REGION" >/dev/null 2>&1; then
  ok "ECR repo exists"
else
  aws ecr create-repository --repository-name "$STACK_NAME" --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 --region "$REGION" >/dev/null
  ok "ECR repo created"
fi

# ─── Push to ECR ───
step "📤 Pushing image to ECR"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_DOMAIN" 2>&1 | grep -i "login"
docker tag "${STACK_NAME}:${IMAGE_TAG}" "$FULL_IMAGE"
docker push "$FULL_IMAGE" 2>&1 | grep -E "^(latest|${IMAGE_TAG}|sha256)" || true
ok "Pushed ${FULL_IMAGE}"

# ─── SAM Deploy (full mode only) ───
if [ "$MODE" = "full" ]; then
  command -v sam >/dev/null || fail "sam CLI not found"

  step "🏗️  Deploying SAM stack"
  info "Stack: ${STACK_NAME} → ${REGION}"
  sam deploy \
    --template-file "$TEMPLATE" \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --capabilities CAPABILITY_IAM \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset \
    --resolve-s3 \
    --parameter-overrides "ContainerImage=${FULL_IMAGE}"
  ok "Stack deployed"
else
  step "⏭️  Skipping SAM deploy (quick mode)"
fi

# ─── Get Stack Outputs ───
step "📋 Reading stack outputs"
get_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

ALB_URL=$(get_output "ALBURL")
ALB_DNS=$(get_output "ALBDNSName")
CLUSTER=$(get_output "ECSClusterName")
SERVICE=$(get_output "ECSServiceName")

val "🌐 URL:" "$ALB_URL"
val "⚙️  Cluster:" "$CLUSTER"

# ─── Force ECS Deployment ───
step "🚀 Rolling out new ECS tasks"

# Register new task def revision to force fresh image pull
TASK_FAMILY="${STACK_NAME}-task"
info "Registering new task definition revision..."
aws ecs describe-task-definition --task-definition "$TASK_FAMILY" --region "$REGION" \
  --query 'taskDefinition.{family:family,cpu:cpu,memory:memory,networkMode:networkMode,requiresCompatibilities:requiresCompatibilities,executionRoleArn:executionRoleArn,taskRoleArn:taskRoleArn,containerDefinitions:containerDefinitions}' \
  --output json > /tmp/taskdef.json

NEW_TD=$(aws ecs register-task-definition --cli-input-json file:///tmp/taskdef.json --region "$REGION" --query 'taskDefinition.taskDefinitionArn' --output text)
ok "New task definition: ${NEW_TD##*/}"

info "Updating ECS service..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$NEW_TD" \
  --force-new-deployment \
  --region "$REGION" \
  --query 'service.deployments[0].{status:status,running:runningCount,desired:desiredCount}' \
  --output table 2>&1
ok "ECS deployment triggered"

# ─── Wait for service stable ───
step "⏳ Waiting for ECS service to stabilize..."
info "This may take 2-5 minutes"
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION" 2>&1 && ok "Service is stable!" || warn "Timed out — check ECS console"

# ─── Summary ───
step "🎉 Deployment Complete!"
echo ""
val "🌐 Application URL:" "$ALB_URL"
val "📊 ALB DNS:" "$ALB_DNS"
val "🗄️  ECR Image:" "${FULL_IMAGE}"
val "⚙️  ECS Cluster:" "$CLUSTER"
val "🚀 ECS Service:" "$SERVICE"
echo ""
link "App:     ${ALB_URL}"
link "Console: https://${REGION}.console.aws.amazon.com/ecs/v2/clusters/${CLUSTER}/services/${SERVICE}/health?region=${REGION}"
link "Logs:    https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#logsV2:log-groups/log-group/\$252Fecs\$252F${STACK_NAME}"
link "ECR:     https://${REGION}.console.aws.amazon.com/ecr/repositories/private/${ACCOUNT_ID}/${STACK_NAME}?region=${REGION}"
echo ""
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${W}  Deploy finished at $(date -u '+%Y-%m-%d %H:%M:%S UTC')${N}"
echo -e "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
