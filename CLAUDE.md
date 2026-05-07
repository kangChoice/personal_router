# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Model Hub (模型中转站) - A Node.js/Express proxy server that forwards API requests to multiple AI model providers. Users configure model endpoints via REST API, and the proxy handles authentication and request forwarding.

## Commands

```bash
npm start        # Run server in production mode
npm run dev      # Run with nodemon for development (auto-reload)
```

Server runs on `http://localhost:3000` (configurable via `PORT` env var).

## Architecture

- **server.js** - Express app entry point, mounts middleware and routes
- **db.js** - LowDB file-based database (db.json), stores `models`, `apiKeys` and `logs` collections
- **middleware/auth.js** - API Key authentication middleware
- **routes/models.js** - REST CRUD endpoints for model configurations at `/api/models`
- **routes/apiKeys.js** - REST CRUD endpoints for API key management at `/api/keys`
- **routes/proxy.js** - Proxy forwarding endpoints at `/api/proxy/:modelId/*`

## Authentication & Authorization

### API Key Authentication

All proxy requests require API Key authentication via:
- `Authorization: Bearer <your-api-key>` or
- `x-api-key: <your-api-key>`

The `authenticateApiKey` middleware validates: key exists, enabled, not expired, and quota not exhausted. On success it attaches `req.apiKey` (id, name, models, rateLimit, quota, usedQuota).

### Model-Level Access Control

`requireModelAccess()` middleware (from `middleware/auth.js`) restricts which models an API key can call. If the key's `models` array is non-empty, the requested `:modelId` must be in that list — otherwise 403.

Both proxy routes use `requireModelAccess()`. The model/config management routes do NOT use any auth middleware (no protection on `/api/models` or `/api/keys`).

## API Endpoints

### Model Management (`/api/models`)
- `GET /` - List all model configs
- `GET /:id` - Get single model config
- `POST /` - Create model config (requires: `name`, `apiKey`, `baseUrl`)
- `PUT /:id` - Update model config
- `DELETE /:id` - Delete model config

### API Key Management (`/api/keys`)
- `GET /` - List all API keys (key hidden, shows prefix)
- `GET /:id` - Get single API key details
- `POST /` - Create new API key (returns full key once)
- `PUT /:id` - Update API key settings
- `POST /:id/reset-quota` - Reset usage quota
- `DELETE /:id` - Delete API key
- `GET /:id/stats` - Get usage statistics for this key
- `GET /logs` - Query request logs (supports filtering by apiKeyId, modelId, success)

#### API Key Features
- `name` - Display name for the key
- `description` - Optional description
- `models` - Array of allowed model IDs (empty = all models)
- `rateLimit` - Requests per minute limit
- `quota` - Total request quota
- `expiresAt` - Expiration date (ISO string)
- `enabled` - Enable/disable the key

### Proxy (`/api/proxy`)
- `POST /:modelId/chat/completions` - Forward chat completion request
- `POST /:modelId/*` - Generic proxy for any API endpoint

### Health Check
- `GET /api/health` - Returns `{ status: 'ok' }`

### Logs (`/api/keys/logs`)
- `GET /?apiKeyId=<id>&modelId=<id>&success=<true|false>&limit=<n>&offset=<n>` - Query logs with pagination

## Proxy Behavior Details

- **`POST /:modelId/chat/completions`** — Specific route that forwards request body fields (`messages`, `temperature`, `max_tokens`, `stream`) to `{model.baseUrl}/chat/completions`. Defaults: temperature=0.7, max_tokens=2048, stream=false. Uses `response.json()` so streaming is not actually supported despite accepting the `stream` parameter.
- **`POST /:modelId/*`** — Catch-all that forwards the raw body to `{model.baseUrl}/{wildcard_path}`. No body transformation.
- Both routes log every request (success, failure, error) to the `logs` collection and increment `usedQuota` on the API key record.
- Both routes have a fallback "no auth" code path (when `req.apiKey` is undefined), though this won't be reached since `authenticateApiKey` is mounted on the parent router.

## Environment Variables

- `PORT` - Server port (default: 3000)

## Important Notes

- `db.json` is created relative to the working directory where `node server.js` is run, not relative to `db.js`. Always start the server from the `model-hub/` directory.
- There is no test suite. The `apiKeys` and `models` management routes have no authentication — they are open to anyone who can reach the server.
- The `stream: true` parameter is accepted but streaming responses are not actually implemented (uses `response.json()`).
