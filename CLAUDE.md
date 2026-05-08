# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Model Hub (模型中转站) - A Node.js/Express proxy server that forwards API requests to AI model providers. It supports **OpenAI-compatible** (`/chat/completions`) and **Anthropic-compatible** (`/anthropic/v1/messages`) protocols, plus a generic wildcard proxy. All routes are currently **passthrough** — they forward requests as-is to the upstream, only overriding the `model` field. Protocol conversion functions (Anthropic↔OpenAI) exist in `proxy.js` but are dormant (not wired to any route). Users configure model endpoints via REST API, and the proxy handles authentication and request forwarding.

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
- **routes/proxy.js** — Core proxy logic. All three routes are passthrough (forward as-is, only override `model`). Also contains dormant Anthropic↔OpenAI protocol conversion functions and SSE streaming helpers that are defined but not currently wired to any route.
  - `POST /api/proxy/chat/completions` — Forwards to upstream's `/chat/completions`. Supports streaming via `streamOpenAIPassthrough` (pipe).
  - `POST /api/proxy/anthropic/v1/messages` — Forwards to upstream's `/v1/messages`. Supports streaming via pipe. No protocol conversion.
  - `POST /api/proxy/*` — Generic wildcard proxy, forwards to upstream's `/<captured-path>`. Only overrides `model` field.
- **routes/models.js** — CRUD for model configurations at `/api/models`.
- **routes/apiKeys.js** — CRUD for API keys at `/api/keys`, plus `/logs` query endpoint.
- **nodemon.json** — Configured to ignore `db.json` changes, preventing restart loops when the database is written to.
- **public/** — Admin panel frontend (index.html, css/style.css, js/app.js, js/api.js, js/pages/{models,keys,logs}.js). Served as static files by Express.

### Model Resolution

`resolveModel(req)` in proxy.js uses a **two-step fallback**:

1. **API Key name match**: If `model` matches an API key's `name`, use that key's first model (from `apiKey.models[0]`). This lets you use the API key name as the model hint.
2. **Model name match (fallback)**: Match `model` directly against model config `name` fields. If `model` is absent, returns the first model in the database.

Both steps enforce access control: if the authenticated API key has a restricted `models` list, the resolved model must be in that list.

Model names are **unique** (enforced at create/update). Note that `resolveModel` tries API key name first, so an API key name that collides with a model name will shadow the model.

Key implications:
- Claude Code's `ANTHROPIC_MODEL` must match either an API key name or a model config `name`.
- The upstream request uses the model config's `modelName` field (e.g. `deepseek-chat`).
- The `:modelId` URL param is not used by proxy routes.

## Authentication

All proxy routes require API Key authentication via:
- `Authorization: Bearer <your-api-key>` or `x-api-key: <your-api-key>`

The middleware validates: key exists, enabled, not expired, and quota not exhausted. On success it attaches `req.apiKey`.

Model management (`/api/models`) and key management (`/api/keys`) routes have **no authentication**.

## Dormant Protocol Conversion Functions

The following functions are defined in `proxy.js` but **not currently wired** to any route. They exist for scenarios where an Anthropic-speaking client needs to reach an OpenAI-only upstream.

### Anthropic → OpenAI (request direction) — `anthropicToOpenAI(body, modelName)`
- `system` field (string or array of text blocks) → system message
- Tool definitions: Anthropic `input_schema` → OpenAI `parameters`
- `tool_choice`: `{type:"any"}` → `"required"`, `{type:"tool",name:"x"}` → `{type:"function",function:{name:"x"}}`
- Messages with mixed text/image/tool_use/tool_result content blocks → split into multiple OpenAI messages
- Image base64 data → `data:` URI in `image_url` blocks
- `tool_use` → OpenAI `tool_calls` with ID mapping
- `tool_result` → OpenAI `tool` role message with matching `tool_call_id`

### OpenAI → Anthropic (response direction) — `openAIToAnthropic()` / `streamOpenAIToAnthropic()`
- Response conversion for both streaming and non-streaming modes
- `finish_reason` mapping: `stop`→`end_turn`, `length`→`max_tokens`, `tool_calls`→`tool_use`
- Streaming: OpenAI SSE chunks → Anthropic SSE events (content_block_delta with text_delta or input_json_delta)
- Tool calls in streaming: OpenAI delta tool_calls accumulate in memory and emit Anthropic content_block_start/delta/stop events

## API Endpoints

### Model Management (`/api/models`)
- `GET /` — List all model configs
- `GET /:id` — Get single model config
- `POST /` — Create model config (requires: `name`, `apiKey`, `baseUrl`; optional: `modelName`, `description`). Returns 409 if `name` already exists.
- `PUT /:id` — Update model config. Returns 409 if new `name` conflicts with another model.
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
- `POST /anthropic/v1/messages` — Anthropic-compatible (passthrough)
- `POST /*` — Generic wildcard proxy (passthrough)

### Health Check
- `GET /api/health` — Returns `{ status: 'ok' }`

## Important Notes

- `db.json` is created relative to the working directory, not relative to `db.js`. Always start the server from `model-hub/`.
- Model management and key management endpoints have no authentication — accessible to anyone who can reach the server.
- The proxy uses `node-fetch` v2 (CommonJS compatible).
- Logs accumulate in db.json without automatic cleanup.
- The Anthropic↔OpenAI protocol conversion functions exist in `proxy.js` but are dormant. If you need to proxy an Anthropic client to an OpenAI-only upstream, wire `anthropicToOpenAI` into the request path and `openAIToAnthropic` (or `streamOpenAIToAnthropic`) into the response path.
