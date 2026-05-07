const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// ---- 日志和配额辅助函数 ----

function logRequest({ apiKey, modelId, endpoint, method, statusCode, success, duration, requestSize, responseSize, errorMessage }) {
  if (!apiKey) return;
  db.get('logs').push({
    id: uuidv4(),
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.name,
    modelId,
    endpoint,
    method,
    statusCode,
    success,
    duration,
    requestSize,
    responseSize: responseSize || 0,
    errorMessage,
    createdAt: new Date().toISOString()
  }).write();
}

function incrementQuota(apiKey) {
  if (!apiKey) return;
  const keyRecord = db.get('apiKeys').find({ id: apiKey.id }).value();
  if (!keyRecord) return;
  db.get('apiKeys')
    .find({ id: apiKey.id })
    .assign({
      usedQuota: (keyRecord.usedQuota || 0) + 1,
      lastUsedAt: new Date().toISOString()
    })
    .write();
}

// ---- 模型解析 ----

// 从请求 body 的 model 字段匹配模型配置的 name，同时检查访问权限
function resolveModel(req) {
  const modelHint = req.body?.model;
  const model = modelHint
    ? db.get('models').find({ name: modelHint }).value()
    : db.get('models').first().value();

  if (!model) return null;

  // 检查 API Key 的模型访问权限
  if (req.apiKey?.models?.length > 0 && !req.apiKey.models.includes(model.id)) {
    return { forbidden: true, allowedModels: req.apiKey.models };
  }

  return model;
}

// ---- Anthropic ↔ OpenAI 协议转换 ----

const FINISH_REASON_MAP = {
  'stop': 'end_turn',
  'length': 'max_tokens',
  'content_filter': 'content_filter',
  'tool_calls': 'tool_use'
};

function anthropicToOpenAI(body, modelName) {
  const openaiBody = {
    model: modelName || body.model,
    messages: [],
    max_tokens: body.max_tokens || 2048,
    temperature: body.temperature,
    stream: body.stream || false
  };

  if (body.system) {
    openaiBody.messages.push({ role: 'system', content: body.system });
  }

  if (body.messages) {
    for (const msg of body.messages) {
      let content;
      if (Array.isArray(msg.content)) {
        content = msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('');
      } else {
        content = msg.content || '';
      }
      openaiBody.messages.push({ role: msg.role, content });
    }
  }

  if (body.stop_sequences) openaiBody.stop = body.stop_sequences;
  if (body.top_p !== undefined) openaiBody.top_p = body.top_p;

  return openaiBody;
}

function openAIToAnthropic(openaiResponse, modelName) {
  const choice = openaiResponse.choices?.[0] || {};

  return {
    id: (openaiResponse.id || '').replace(/^chatcmpl/, 'msg'),
    type: 'message',
    role: 'assistant',
    model: modelName || openaiResponse.model,
    content: [
      { type: 'text', text: choice.message?.content || '' }
    ],
    stop_reason: FINISH_REASON_MAP[choice.finish_reason] || choice.finish_reason || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

function openAIErrorToAnthropic(openaiBody) {
  const err = openaiBody.error || openaiBody;
  return {
    type: 'error',
    error: {
      type: err.type || 'api_error',
      message: err.message || 'Unknown error'
    }
  };
}

// ---- 路由 ----
// 模型不再放在 URL 里，而是从请求 body.model 匹配模型配置的 name 字段

// OpenAI 兼容路由: POST /chat/completions
router.post('/chat/completions', async (req, res) => {
  try {
    const model = resolveModel(req);
    if (!model) {
      return res.status(404).json({ error: '没有匹配的模型配置，请检查 ANTHROPIC_MODEL 是否与模型配置的 name 一致' });
    }
    if (model.forbidden) {
      return res.status(403).json({ error: '无权访问此模型', allowedModels: model.allowedModels });
    }

    const startTime = Date.now();
    const requestBody = JSON.stringify({
      model: model.modelName,
      messages: req.body.messages,
      temperature: req.body.temperature || 0.7,
      max_tokens: req.body.max_tokens || 2048,
      stream: req.body.stream || false
    });

    try {
      const response = await fetch(`${model.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`
        },
        body: requestBody
      });

      const data = await response.json();

      if (!response.ok) {
        logRequest({
          apiKey: req.apiKey, modelId: model.id,
          endpoint: '/chat/completions', method: 'POST',
          statusCode: response.status, success: false,
          duration: Date.now() - startTime,
          requestSize: Buffer.byteLength(requestBody),
          errorMessage: data.error?.message || 'API 返回错误'
        });
        return res.status(response.status).json(data);
      }

      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        endpoint: '/chat/completions', method: 'POST',
        statusCode: response.status, success: true,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        responseSize: Buffer.byteLength(JSON.stringify(data))
      });
      incrementQuota(req.apiKey);

      res.json(data);
    } catch (error) {
      console.error('Proxy error:', error);
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        endpoint: '/chat/completions', method: 'POST',
        statusCode: 500, success: false,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        errorMessage: error.message
      });
      res.status(500).json({ error: '代理请求失败', details: error.message });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: '代理请求失败', details: error.message });
  }
});

// Anthropic 兼容路由: POST /anthropic/v1/messages
router.post('/anthropic/v1/messages', async (req, res) => {
  try {
    const model = resolveModel(req);
    if (!model) {
      return res.status(404).json({ error: '没有匹配的模型配置，请检查 ANTHROPIC_MODEL 是否与模型配置的 name 一致' });
    }
    if (model.forbidden) {
      return res.status(403).json({ error: '无权访问此模型', allowedModels: model.allowedModels });
    }

    const openaiBody = anthropicToOpenAI(req.body, model.modelName);
    const startTime = Date.now();
    const requestBody = JSON.stringify(openaiBody);

    try {
      const response = await fetch(`${model.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`
        },
        body: requestBody
      });

      const data = await response.json();

      if (!response.ok) {
        logRequest({
          apiKey: req.apiKey, modelId: model.id,
          endpoint: '/anthropic/v1/messages', method: 'POST',
          statusCode: response.status, success: false,
          duration: Date.now() - startTime,
          requestSize: Buffer.byteLength(requestBody),
          errorMessage: data.error?.message || 'API 返回错误'
        });
        return res.status(response.status).json(openAIErrorToAnthropic(data));
      }

      const anthropicResponse = openAIToAnthropic(data, model.modelName);

      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        endpoint: '/anthropic/v1/messages', method: 'POST',
        statusCode: response.status, success: true,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        responseSize: Buffer.byteLength(JSON.stringify(anthropicResponse))
      });
      incrementQuota(req.apiKey);

      res.json(anthropicResponse);
    } catch (error) {
      console.error('Proxy error:', error);
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        endpoint: '/anthropic/v1/messages', method: 'POST',
        statusCode: 500, success: false,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        errorMessage: error.message
      });
      res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: '代理请求失败', details: error.message }
      });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: '代理请求失败', details: error.message }
    });
  }
});

// 通用代理端点
router.post('/*', async (req, res) => {
  try {
    const model = resolveModel(req);
    if (!model) {
      return res.status(404).json({ error: '没有可用的模型配置' });
    }
    if (model.forbidden) {
      return res.status(403).json({ error: '无权访问此模型', allowedModels: model.allowedModels });
    }

    const path = req.params[0];
    const startTime = Date.now();
    const requestBody = JSON.stringify(req.body);

    try {
      const response = await fetch(`${model.baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`
        },
        body: requestBody
      });

      const data = await response.json();

      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        endpoint: `/${path}`, method: 'POST',
        statusCode: response.ok ? response.status : 500, success: response.ok,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        responseSize: Buffer.byteLength(JSON.stringify(data)),
        errorMessage: !response.ok ? 'API 返回错误' : undefined
      });
      incrementQuota(req.apiKey);

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json(data);
    } catch (error) {
      console.error('Proxy error:', error);
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        endpoint: `/${path}`, method: 'POST',
        statusCode: 500, success: false,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        errorMessage: error.message
      });
      res.status(500).json({ error: '代理请求失败', details: error.message });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: '代理请求失败', details: error.message });
  }
});

module.exports = router;
