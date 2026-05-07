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

## Authentication

All proxy requests require API Key authentication via:
- `Authorization: Bearer <your-api-key>` or
- `x-api-key: <your-api-key>`

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

## Environment Variables

- `PORT` - Server port (default: 3000)

## Files to Note

- `db.json` - Runtime database file (gitignored)
- `.env` - Environment configuration (gitignored)
