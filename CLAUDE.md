# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Model Hub (模型中转站) - A Node.js/Express proxy server that forwards API requests to AI model providers. It supports both **OpenAI-compatible** (`/chat/completions`) and **Anthropic-compatible** (`/anthropic/v1/messages`) protocols with full protocol conversion (system prompt, tool_use, tool_result, images, streaming SSE). Users configure model endpoints via REST API, and the proxy handles authentication and request forwarding.

## Commands

```bash
npm start        # Run server in production mode
npm run dev      # Run with nodemon for development (auto-reload)
```

Server runs on `http://localhost:9999` (configurable via `PORT` env var).

## Architecture

- **server.js** - Express app entry point, mounts middleware and routes. Body parser limit is 200mb (required for Claude Code requests).
- **db.js** - LowDB file-based database (db.json), stores `models`, `apiKeys`, `logs` collections.
- **middleware/auth.js** - API Key authentication middleware (`authenticateApiKey`) and model access control (`requireModelAccess`).
- **routes/proxy.js** — Core proxy logic with Anthropic↔OpenAI protocol conversion and SSE streaming.
  - `POST /api/proxy/chat/completions` — OpenAI-compatible route, passes through to upstream as-is (no protocol conversion), supports streaming.
  - `POST /api/proxy/anthropic/v1/messages` — Anthropic-compatible route, converts Anthropic request body to OpenAI format for upstream, converts response back to Anthropic format. Supports streaming with full SSE event sequence (message_start → content_block_start/delta/stop → message_delta → message_stop).
  - `POST /api/proxy/*` — Generic wildcard proxy, passes through with minimal transformation (only overrides `model` field).
- **routes/models.js** — CRUD for model configurations at `/api/models`.
- **routes/apiKeys.js** — CRUD for API keys at `/api/keys`, plus `/logs` query endpoint.

### Model Resolution

`resolveModel(req)` in proxy.js matches the `model` field from the request body against the `name` field in model configs. This means:
- The `:modelId` URL param is no longer used by the proxy routes.
- Claude Code's `ANTHROPIC_MODEL` must match a model config's `name`.
- The upstream request uses the model config's `modelName` field (e.g. `deepseek-chat`).

## Authentication

All proxy routes require API Key authentication via:
- `Authorization: Bearer <your-api-key>` or `x-api-key: <your-api-key>`

The middleware validates: key exists, enabled, not expired, and quota not exhausted. On success it attaches `req.apiKey`.

Model management (`/api/models`) and key management (`/api/keys`) routes have **no authentication**.

## Protocol Conversion Details

### Anthropic → OpenAI (request direction)
- `system` field (string or array of text blocks) → system message
- Tool definitions: Anthropic `input_schema` → OpenAI `parameters`
- `tool_choice`: `{type:"any"}` → `"required"`, `{type:"tool",name:"x"}` → `{type:"function",function:{name:"x"}}`
- Messages with mixed text/image/tool_use/tool_result content blocks → split into multiple OpenAI messages
- Image base64 data → `data:` URI in `image_url` blocks
- `tool_use` → OpenAI `tool_calls` with ID mapping
- `tool_result` → OpenAI `tool` role message with matching `tool_call_id`

### OpenAI → Anthropic (response direction)
- Response conversion for both streaming and non-streaming modes
- `finish_reason` mapping: `stop`→`end_turn`, `length`→`max_tokens`, `tool_calls`→`tool_use`
- Streaming: OpenAI SSE chunks → Anthropic SSE events (content_block_delta with text_delta or input_json_delta)
- Tool calls in streaming: OpenAI delta tool_calls accumulate in memory and emit Anthropic content_block_start/delta/stop events

## API Endpoints

### Model Management (`/api/models`)
- `GET /` — List all model configs
- `GET /:id` — Get single model config
- `POST /` — Create model config (requires: `name`, `apiKey`, `baseUrl`; optional: `modelName`, `description`)
- `PUT /:id` — Update model config
- `DELETE /:id` — Delete model config

### API Key Management (`/api/keys`)
- `GET /` — List all API keys (key hidden, shows prefix)
- `GET /:id` — Get single API key details
- `POST /` — Create new API key (returns full key once)
- `PUT /:id` — Update API key settings
- `POST /:id/reset-quota` — Reset usage quota
- `DELETE /:id` — Delete API key
- `GET /:id/stats` — Usage statistics
- `GET /logs` — Query request logs (supports filtering by apiKeyId, modelId, success; pagination via limit/offset)

### Proxy (`/api/proxy`)
- `POST /chat/completions` — OpenAI-compatible (passthrough)
- `POST /anthropic/v1/messages` — Anthropic-compatible (protocol conversion)
- `POST /*` — Generic wildcard proxy

### Health Check
- `GET /api/health` — Returns `{ status: 'ok' }`

## Important Notes

- `db.json` is created relative to the working directory, not relative to `db.js`. Always start the server from `model-hub/`.
- Model management and key management endpoints have no authentication — accessible to anyone who can reach the server.
- The proxy uses `node-fetch` v2 (CommonJS compatible).
- Logs accumulate in db.json without automatic cleanup.
