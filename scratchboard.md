# Bedrock AgentCore GUI - Scratchboard

## Project Overview
Web application (JavaScript + Containers) serving as a Bedrock AgentCore Runtime GUI.

## Features
1. List all AgentCore Runtime Agents
2. List all available MCP Tools (via Gateway)
3. List all Bedrock AgentCore Gateways
4. Create new chat sessions (stored locally in browser)
5. Streaming chat responses from AgentCore Runtime
6. Show tool invocation details during agent execution

## Infrastructure (SAM → ECS Fargate)
- **Platform**: ECS Fargate in private subnets
- **Networking**: Public ALB → Private ECS tasks
- **Domain**: core-gui.warot.dev
- **Hosted Zone**: Z06170111LCZF339GRX97
- **TLS Cert**: arn:aws:acm:*:*:certificate/5784ca07-91e0-4406-b5b8-ffe219725420
- **No public S3/databases**

## Plan

### Task 1: Create SAM template (infrastructure/template.yaml)
- [x] Use existing VPC vpc-0cfe699bb947aae86
- [x] Use existing subnets (subnet-0e52d9d83ea75fd6c, subnet-06c6745485e95f30c, subnet-092b5424a02a07e02)
- [x] Use existing ALB SG sg-0302870a30e67d0a2, ECS SG sg-06110d8b46ae4af96
- [x] ECS Cluster + Fargate Service
- [x] ALB (public) with HTTPS listener + TLS cert
- [x] Route53 A record alias → ALB
- [x] IAM Role for ECS tasks (Bedrock AgentCore permissions)
- [x] ECR Repository for container image
- [x] CloudWatch Log Group

### Task 2: Create application backend (Node.js/Express proxy)
- [x] Express server with API routes
- [x] GET /api/agents → list_agent_runtimes (paginated)
- [x] GET /api/agents/:id → get_agent_runtime
- [x] GET /api/agents/:id/endpoints → list_agent_runtime_endpoints
- [x] GET /api/gateways → list_gateways (paginated)
- [x] GET /api/gateways/:id → get_gateway (includes endpoint URL)
- [x] GET /api/gateways/:id/targets → list_gateway_targets
- [x] POST /api/chat → invoke_agent_runtime (streaming SSE)
- [x] Health check endpoint (/health)
- [x] SPA fallback for frontend routing

### Task 3: Create frontend (static HTML/JS)
- [x] Aurora UI themed interface per design steering (style.css)
- [x] Sidebar: agent list, gateway list, session list
- [x] Chat panel with streaming response rendering (SSE reader)
- [x] Tool invocation detail display (collapsible, input/output)
- [x] Local session storage for chat history (localStorage)
- [x] New chat modal with agent selection
- [x] Agents table view (name, status, version, ARN)
- [x] Gateways table view with target drill-down
- [x] Mobile responsive sidebar toggle

### Task 4: Dockerfile + build config
- [x] Multi-stage Dockerfile (deps + runtime, 209MB image)
- [x] .dockerignore
- [x] samconfig.toml defaults
- [x] Container tested: health, API, agents all working

## Current Status
✅ Task 1 - SAM Template COMPLETE
✅ Task 2 - Backend COMPLETE
✅ Task 3 - Frontend COMPLETE
✅ Task 4 - Dockerfile + Config COMPLETE
🎉 ALL TASKS DONE
