# Model Hub (模型中转站)

一个 Node.js/Express 代理服务，统一管理多个 AI 模型的 API 接入。支持 OpenAI 和 Anthropic 两种协议，提供 API Key 认证、配额管理、请求日志等功能。

## 快速开始

### 前提条件

- Node.js 16+
- npm

### 安装与启动

```bash
# 安装依赖
npm install

# 开发模式启动（修改代码自动重启）
npm run dev

# 生产模式启动
npm start
```

服务默认运行在 **http://localhost:9999**（可通过 `PORT` 环境变量修改）。

## 目录结构

```
model-hub/
├── server.js              # 入口文件，Express 应用配置
├── db.js                  # LowDB 数据库初始化
├── db.json                # 数据文件（自动生成）—— 存储所有配置和日志
├── package.json           # 项目依赖和脚本
├── public/                # 前端页面
│   ├── index.html         # 管理后台主页面
│   ├── css/               # 样式文件
│   └── js/                # 前端 JavaScript
├── middleware/
│   └── auth.js            # API Key 认证中间件
├── routes/
│   ├── proxy.js           # 【核心】代理转发 + 协议转换
│   ├── models.js          # 模型配置 CRUD 接口
│   └── apiKeys.js         # API Key 管理 + 日志查询
└── CLAUDE.md              # Claude Code 项目指南
```

### 各文件说明

| 文件 | 作用 |
|------|------|
| `server.js` | Express 应用入口。挂载 CORS、JSON 解析（限制 200MB）、静态文件、路由。启动 HTTP 服务。 |
| `db.js` | 初始化 LowDB（基于 JSON 文件的数据库），定义 `models`、`apiKeys`、`logs` 三个集合。 |
| `db.json` | 自动生成的数据库文件，包含所有模型配置、API Key 和请求日志。**切勿手动编辑。** |
| `middleware/auth.js` | 认证中间件。从 `Authorization` 或 `x-api-key` 头提取 Key，验证启用/过期/配额状态。 |
| `routes/proxy.js` | 核心代理逻辑。支持 OpenAI 协议（`/chat/completions`）和 Anthropic 协议（`/anthropic/v1/messages`），以及通用代理。包含完整的协议转换和 SSE 流式响应。 |
| `routes/models.js` | 模型配置的增删改查接口。 |
| `routes/apiKeys.js` | API Key 的增删改查、配额重置、使用统计和日志查询。 |
| `public/` | 管理后台前端页面，用于可视化操作。 |

## 核心概念

### 模型配置 (Model)

每个模型配置包含：

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 别名，供外部调用时指定 | `deepseek-V4-personal` |
| `modelName` | 发送给上游的真实模型名 | `deepseek-chat` |
| `apiKey` | 上游 API 的密钥 | `sk-xxx...` |
| `baseUrl` | 上游 API 地址 | `https://api.deepseek.com` |

### API Key

调用代理时需要传入的认证凭据，支持：

- 访问控制：限定 Key 只能调用指定模型
- 配額限制：限制总请求次数
- 过期时间
- 启用/禁用

### 协议转换

本中转站最重要的功能：将 **Anthropic 协议**（Claude Code 使用的格式）转换为 **OpenAI 协议**（DeepSeek 等厂商使用的格式）。

转换内容包括：
- **系统提示词**：Anthropic 顶层 `system` → OpenAI 的 system message
- **消息内容**：多类型 content blocks（text/image/tool_use/tool_result）→ OpenAI 多消息序列
- **工具调用**：工具定义、tool_choice、tool_use/tool_result 的 ID 映射
- **流式响应**：OpenAI SSE 流 → Anthropic SSE 事件序列

## API 使用指南

### 调用模型

```bash
# OpenAI 协议（推荐用于测试）
curl -X POST http://localhost:9999/api/proxy/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-api-key>" \
  -d '{
    "model": "deepseek-V4-personal",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 100
  }'

# Anthropic 协议（Claude Code 使用）
curl -X POST http://localhost:9999/api/proxy/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-api-key>" \
  -d '{
    "model": "deepseek-V4-personal",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 100
  }'

# 流式调用（添加 "stream": true）
curl -N -X POST http://localhost:9999/api/proxy/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-api-key>" \
  -d '{
    "model": "deepseek-V4-personal",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

### 管理模型配置

```bash
# 查看所有模型
curl http://localhost:9999/api/models

# 新增模型
curl -X POST http://localhost:9999/api/models \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-model",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.example.com",
    "modelName": "gpt-4"
  }'

# 更新模型
curl -X PUT http://localhost:9999/api/models/<model-id> \
  -H "Content-Type: application/json" \
  -d '{"name": "new-name"}'

# 删除模型
curl -X DELETE http://localhost:9999/api/models/<model-id>
```

### 管理 API Key

```bash
# 查看所有 Key
curl http://localhost:9999/api/keys

# 创建 Key
curl -X POST http://localhost:9999/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "my-key", "models": ["<model-id>"]}'

# 查看 Key 统计
curl http://localhost:9999/api/keys/<key-id>/stats

# 查询请求日志
curl "http://localhost:9999/api/keys/logs?limit=10&offset=0"

# 重置配额
curl -X POST http://localhost:9999/api/keys/<key-id>/reset-quota
```

## Claude Code 配置

将 Claude Code 指向本地中转站（修改 `~/.claude/settings.json`）：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-<你的中转站API Key>",
    "ANTHROPIC_BASE_URL": "http://localhost:9999/api/proxy/anthropic",
    "ANTHROPIC_MODEL": "你的模型配置name"
  }
}
```

**注意**：使用中转站前必须确保服务已启动（`npm run dev`）。

## 安全提示

- `/api/models` 和 `/api/keys` 管理接口**没有认证**，不要暴露到公网
- 日志会无限累积在 `db.json` 中，建议定期清理
- API Key 的完整密钥仅在创建时返回一次，请妥善保存

## 常见问题

**Q: 返回 "没有匹配的模型配置"**
A: 请求 body 中的 `model` 字段必须与模型配置的 `name` 一致。

**Q: 图片请求返回错误**
A: DeepSeek 等部分上游模型不支持图片识别，这是上游限制。

**Q: 流式调用不输出内容**
A: 确认请求包含 `"stream": true`，且上游模型支持流式。
