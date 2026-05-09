const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const readline = require('readline');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// ═══════════════════════════════════════════════════════════
// 日志 & 配额
// ═══════════════════════════════════════════════════════════

function chinaTimeISO() {
  const d = new Date();
  // 转为中国时区 (UTC+8)
  const offset = 8 * 60; // +8 小时
  const local = new Date(d.getTime() + offset * 60000);
  return local.toISOString().replace('Z', '+08:00');
}

function logRequest({ apiKey, modelId, localModelName, remoteModelName, upstreamUrl, endpoint, method, statusCode, success, duration, requestSize, responseSize, inputTokens, outputTokens, errorMessage }) {
  if (!apiKey) return;
  db.get('logs').push({
    id: uuidv4(),
    apiKeyId: apiKey.id,
    apiKeyName: apiKey.name,
    modelId,
    localModelName: localModelName || '',
    remoteModelName: remoteModelName || '',
    upstreamUrl: upstreamUrl || '',
    endpoint,
    method,
    statusCode,
    success,
    duration,
    requestSize,
    responseSize: responseSize || 0,
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    errorMessage,
    createdAt: chinaTimeISO()
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
      lastUsedAt: chinaTimeISO()
    })
    .write();
}

// ═══════════════════════════════════════════════════════════
// 模型解析
// ═══════════════════════════════════════════════════════════

function resolveModel(req) {
  const modelHint = req.body?.model;

  // 优先: 用 modelHint 匹配 apiKeys.name → 通过 key 的 models 列表找到上游模型
  if (modelHint) {
    const apiKey = db.get('apiKeys').find({ name: modelHint }).value();
    if (apiKey && apiKey.models && apiKey.models.length > 0) {
      const model = db.get('models').find({ id: apiKey.models[0] }).value();
      if (model) {
        if (req.apiKey?.models?.length > 0 && !req.apiKey.models.includes(model.id)) {
          return { forbidden: true, allowedModels: req.apiKey.models };
        }
        return model;
      }
    }
  }

  // 回退: 直接用 modelHint 匹配 models.name
  const model = modelHint
    ? db.get('models').find({ name: modelHint }).value()
    : db.get('models').first().value();

  if (!model) return null;

  if (req.apiKey?.models?.length > 0 && !req.apiKey.models.includes(model.id)) {
    return { forbidden: true, allowedModels: req.apiKey.models };
  }

  return model;
}

// ═══════════════════════════════════════════════════════════
// 协议转换: Anthropic → OpenAI (请求)
// ═══════════════════════════════════════════════════════════

const FINISH_REASON_TO_OPENAI = {
  'end_turn': 'stop',
  'max_tokens': 'length',
  'content_filter': 'content_filter',
  'tool_use': 'tool_calls'
};

function generateCallId() {
  return 'call_' + uuidv4().replace(/-/g, '').substring(0, 16);
}

function anthropicToOpenAI(body, modelName) {
  const openaiBody = {
    model: modelName || body.model,
    messages: [],
    max_tokens: body.max_tokens || 2048,
    stream: body.stream || false
  };

  if (body.temperature !== undefined) openaiBody.temperature = body.temperature;
  if (body.top_p !== undefined) openaiBody.top_p = body.top_p;
  if (body.stop_sequences) openaiBody.stop = body.stop_sequences;

  // tool_use id 映射表: anthropic_id → openai_id
  const toolIdMap = {};

  // 1. 扫描所有消息，为 tool_use 生成 OpenAI 格式的 ID
  if (body.messages) {
    for (const msg of body.messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && block.id) {
            if (!toolIdMap[block.id]) {
              toolIdMap[block.id] = generateCallId();
            }
          }
        }
      }
    }
  }

  // 2. system prompt
  if (body.system) {
    let systemContent;
    if (Array.isArray(body.system)) {
      systemContent = body.system
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');
    } else {
      systemContent = body.system;
    }
    if (systemContent) {
      openaiBody.messages.push({ role: 'system', content: systemContent });
    }
  }

  // 3. 转换 messages
  if (body.messages) {
    for (const msg of body.messages) {
      if (msg.role === 'user') {
        const userMsgs = convertUserMessage(msg, toolIdMap);
        openaiBody.messages.push(...userMsgs);
      } else if (msg.role === 'assistant') {
        openaiBody.messages.push(convertAssistantMessage(msg, toolIdMap));
      }
    }
  }

  // 4. tools 定义
  if (body.tools && body.tools.length > 0) {
    openaiBody.tools = body.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || {}
      }
    }));
  }

  // 5. tool_choice
  if (body.tool_choice) {
    openaiBody.tool_choice = convertToolChoice(body.tool_choice);
  }

  return { openaiBody, toolIdMap };
}

function convertUserMessage(msg, toolIdMap) {
  const results = [];
  let textParts = [];
  let imageParts = [];

  const contentArray = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];

  for (const block of contentArray) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'image' || block.type === 'image_url') {
      if (block.type === 'image' && block.source) {
        imageParts.push({
          type: 'image_url',
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
        });
      } else if (block.image_url) {
        imageParts.push({ type: 'image_url', image_url: block.image_url });
      }
    } else if (block.type === 'tool_result') {
      // 先输出累积的 text + image
      if (textParts.length > 0 || imageParts.length > 0) {
        results.push(buildUserContent(textParts, imageParts));
        textParts = [];
        imageParts = [];
      }
      // tool_result 转为独立的 tool 消息
      const openaiId = toolIdMap[block.tool_use_id] || block.tool_use_id;
      const toolContent = typeof block.content === 'string'
        ? block.content
        : (Array.isArray(block.content)
          ? block.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : String(block.content));
      results.push({ role: 'tool', tool_call_id: openaiId, content: toolContent });
    }
  }

  // 剩余 text + image
  if (textParts.length > 0 || imageParts.length > 0) {
    results.push(buildUserContent(textParts, imageParts));
  }

  // 如果没有内容，返回空文本消息
  if (results.length === 0) {
    results.push({ role: 'user', content: '' });
  }

  return results;
}

function buildUserContent(textParts, imageParts) {
  if (imageParts.length === 0) {
    return { role: 'user', content: textParts.join('\n') };
  }
  // 有图片 → 使用数组格式
  const content = [
    ...textParts.map(t => ({ type: 'text', text: t })),
    ...imageParts
  ];
  return { role: 'user', content };
}

function convertAssistantMessage(msg, toolIdMap) {
  const contentArray = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];

  let textContent = '';
  let toolCalls = [];

  for (const block of contentArray) {
    if (block.type === 'text') {
      textContent += (textContent ? '\n' : '') + block.text;
    } else if (block.type === 'tool_use') {
      const openaiId = toolIdMap[block.id] || block.id;
      toolCalls.push({
        id: openaiId,
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input)
        }
      });
    }
  }

  const result = { role: 'assistant' };
  if (textContent) result.content = textContent;
  else if (toolCalls.length === 0) result.content = '';
  if (toolCalls.length > 0) result.tool_calls = toolCalls;

  return result;
}

function convertToolChoice(toolChoice) {
  if (typeof toolChoice === 'string') {
    return toolChoice; // "auto", "none", "required"
  }
  if (!toolChoice || !toolChoice.type) return undefined;

  switch (toolChoice.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'tool':
      return {
        type: 'function',
        function: { name: toolChoice.name }
      };
    default:
      return 'auto';
  }
}

// ═══════════════════════════════════════════════════════════
// 协议转换: OpenAI → Anthropic (非流式响应)
// ═══════════════════════════════════════════════════════════

const FINISH_REASON_FROM_OPENAI = {
  'stop': 'end_turn',
  'length': 'max_tokens',
  'content_filter': 'content_filter',
  'tool_calls': 'tool_use'
};

function openAIToAnthropic(openaiResponse, modelName, toolIdMap) {
  const choice = openaiResponse.choices?.[0] || {};
  const message = choice.message || {};
  const content = [];

  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      let input;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = {};
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input
      });
    }
  }

  return {
    id: (openaiResponse.id || '').replace(/^chatcmpl/, 'msg'),
    type: 'message',
    role: 'assistant',
    model: modelName || openaiResponse.model,
    content,
    stop_reason: FINISH_REASON_FROM_OPENAI[choice.finish_reason] || choice.finish_reason || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

// ═══════════════════════════════════════════════════════════
// 流式转换: OpenAI SSE → Anthropic SSE
// ═══════════════════════════════════════════════════════════

async function streamOpenAIToAnthropic(upstreamRes, clientRes, modelName) {
  clientRes.setHeader('Content-Type', 'text/event-stream');
  clientRes.setHeader('Cache-Control', 'no-cache');
  clientRes.setHeader('Connection', 'keep-alive');
  clientRes.setHeader('X-Accel-Buffering', 'no');

  const messageId = 'msg_' + uuidv4().replace(/-/g, '').substring(0, 16);

  let messageStarted = false;
  let contentBlockIndex = 0;
  let currentBlockType = null; // 'text' | 'tool_use'
  let currentBlockIndex = -1;  // Anthropic content block index
  let toolCallStates = {};     // openai_index → { id, name, arguments, blockIndex }
  let activeToolCallIdx = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason = null;

  function writeSSE(event, data) {
    clientRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function closeCurrentBlock() {
    if (currentBlockType && currentBlockIndex >= 0) {
      writeSSE('content_block_stop', { type: 'content_block_stop', index: currentBlockIndex });
      currentBlockType = null;
      currentBlockIndex = -1;
    }
  }

  const rl = readline.createInterface({
    input: upstreamRes.body,
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta || {};

      // 消息开始
      if (!messageStarted) {
        writeSSE('message_start', {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: modelName,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
          }
        });
        messageStarted = true;
      }

      // 文本内容
      if (delta.content) {
        if (currentBlockType !== 'text') {
          closeCurrentBlock();
          currentBlockType = 'text';
          currentBlockIndex = contentBlockIndex++;
          writeSSE('content_block_start', {
            type: 'content_block_start',
            index: currentBlockIndex,
            content_block: { type: 'text', text: '' }
          });
        }
        writeSSE('content_block_delta', {
          type: 'content_block_delta',
          index: currentBlockIndex,
          delta: { type: 'text_delta', text: delta.content }
        });
      }

      // 工具调用
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallStates[tc.index]) {
            toolCallStates[tc.index] = {
              id: tc.id || generateCallId(),
              name: '',
              arguments: '',
              blockIndex: -1
            };
          }
          const state = toolCallStates[tc.index];
          if (tc.id) state.id = tc.id;
          if (tc.function?.name) state.name = tc.function.name;
          if (tc.function?.arguments) state.arguments += tc.function.arguments;

          if (activeToolCallIdx !== tc.index) {
            // 关闭之前的 tool_use 块
            if (activeToolCallIdx !== null && toolCallStates[activeToolCallIdx]) {
              closeCurrentBlock();
            }
            activeToolCallIdx = tc.index;

            if (state.blockIndex < 0) {
              state.blockIndex = contentBlockIndex++;
            }
            currentBlockType = 'tool_use';
            currentBlockIndex = state.blockIndex;

            writeSSE('content_block_start', {
              type: 'content_block_start',
              index: state.blockIndex,
              content_block: {
                type: 'tool_use',
                id: state.id,
                name: state.name,
                input: {}
              }
            });
          }

          if (tc.function?.arguments) {
            writeSSE('content_block_delta', {
              type: 'content_block_delta',
              index: state.blockIndex,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
            });
          }
        }
      }

      // 完成
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      if (chunk.usage) {
        if (chunk.usage.prompt_tokens) inputTokens = chunk.usage.prompt_tokens;
        if (chunk.usage.completion_tokens) outputTokens = chunk.usage.completion_tokens;
      }
    }

    // 流结束 — 关闭当前块
    closeCurrentBlock();

    if (messageStarted) {
      const stopReason = FINISH_REASON_FROM_OPENAI[finishReason] || finishReason || 'end_turn';

      writeSSE('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens || 0 }
      });

      writeSSE('message_stop', { type: 'message_stop' });
    }

    clientRes.end();
  } catch (err) {
    console.error('Stream conversion error:', err);
    if (!clientRes.writableEnded) {
      clientRes.end();
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 流式转发: OpenAI SSE → Client (直通)
// ═══════════════════════════════════════════════════════════

async function streamOpenAIPassthrough(upstreamRes, clientRes) {
  clientRes.setHeader('Content-Type', 'text/event-stream');
  clientRes.setHeader('Cache-Control', 'no-cache');
  clientRes.setHeader('Connection', 'keep-alive');
  clientRes.setHeader('X-Accel-Buffering', 'no');

  let inputTokens = 0;
  let outputTokens = 0;

  const rl = readline.createInterface({
    input: upstreamRes.body,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    clientRes.write(line + '\n');
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data && data !== '[DONE]') {
        try {
          const chunk = JSON.parse(data);
          if (chunk.usage) {
            if (chunk.usage.prompt_tokens) inputTokens = chunk.usage.prompt_tokens;
            if (chunk.usage.completion_tokens) outputTokens = chunk.usage.completion_tokens;
          }
        } catch {}
      }
    }
  }
  clientRes.end();
  return { inputTokens, outputTokens };
}

async function streamAnthropicPassthrough(upstreamRes, clientRes) {
  clientRes.setHeader('Content-Type', 'text/event-stream');
  clientRes.setHeader('Cache-Control', 'no-cache');
  clientRes.setHeader('Connection', 'keep-alive');
  clientRes.setHeader('X-Accel-Buffering', 'no');

  let inputTokens = 0;
  let outputTokens = 0;

  const rl = readline.createInterface({
    input: upstreamRes.body,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    clientRes.write(line + '\n');
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data) {
        try {
          const chunk = JSON.parse(data);
          // Anthropic SSE: message_start has message.usage.input_tokens
          if (chunk.message?.usage?.input_tokens) inputTokens = chunk.message.usage.input_tokens;
          // Anthropic SSE: message_delta has usage.output_tokens
          if (chunk.usage?.output_tokens) outputTokens = chunk.usage.output_tokens;
        } catch {}
      }
    }
  }
  clientRes.end();
  return { inputTokens, outputTokens };
}

// ═══════════════════════════════════════════════════════════
// 路由: POST /chat/completions (OpenAI 兼容)
// ═══════════════════════════════════════════════════════════

router.post('/chat/completions', async (req, res) => {
  const startTime = Date.now();
  let requestBody = '';

  try {
    const model = resolveModel(req);
    if (!model) {
      return res.status(404).json({ error: '没有匹配的模型配置，请检查请求 body.model 是否与模型配置的 name 一致' });
    }
    if (model.forbidden) {
      return res.status(403).json({ error: '无权访问此模型', allowedModels: model.allowedModels });
    }

    // 传递所有请求字段，仅覆盖 model
    const upstreamBody = { ...req.body, model: model.modelName };
    requestBody = JSON.stringify(upstreamBody);

    const upstreamRes = await fetch(`${model.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: requestBody
    });

    if (!upstreamRes.ok) {
      const errorData = await upstreamRes.json().catch(() => ({}));
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        localModelName: model.name, remoteModelName: model.modelName,
        upstreamUrl: `${model.baseUrl}/chat/completions`,
        endpoint: '/chat/completions', method: 'POST',
        statusCode: upstreamRes.status, success: false,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        errorMessage: errorData.error?.message || 'API 返回错误'
      });
      return res.status(upstreamRes.status).json(errorData);
    }

    // 流式响应
    if (req.body.stream) {
      const tokens = await streamOpenAIPassthrough(upstreamRes, res);
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        localModelName: model.name, remoteModelName: model.modelName,
        upstreamUrl: `${model.baseUrl}/chat/completions`,
        endpoint: '/chat/completions', method: 'POST',
        statusCode: 200, success: true,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens
      });
      incrementQuota(req.apiKey);
      return;
    }

    // 非流式响应
    const data = await upstreamRes.json();

    logRequest({
      apiKey: req.apiKey, modelId: model.id,
      localModelName: model.name, remoteModelName: model.modelName,
      upstreamUrl: `${model.baseUrl}/chat/completions`,
      endpoint: '/chat/completions', method: 'POST',
      statusCode: upstreamRes.status, success: true,
      duration: Date.now() - startTime,
      requestSize: Buffer.byteLength(requestBody),
      responseSize: Buffer.byteLength(JSON.stringify(data)),
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0
    });
    incrementQuota(req.apiKey);

    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    logRequest({
      apiKey: req.apiKey,
      modelId: req.body?.model || 'unknown',
      localModelName: '', remoteModelName: '',
      upstreamUrl: '',
      endpoint: '/chat/completions', method: 'POST',
      statusCode: 500, success: false,
      duration: Date.now() - startTime,
      requestSize: Buffer.byteLength(requestBody),
      errorMessage: error.message
    });
    if (!res.headersSent) {
      res.status(500).json({ error: '代理请求失败', details: error.message });
    }
  }
});

// ═══════════════════════════════════════════════════════════
// 路由: POST /anthropic/v1/messages (Anthropic 透传)
// ═══════════════════════════════════════════════════════════

router.post('/anthropic/v1/messages', async (req, res) => {
  const startTime = Date.now();
  let requestBody = '';

  try {
    const model = resolveModel(req);
    if (!model) {
      return res.status(404).json({
        type: 'error',
        error: { type: 'invalid_request_error', message: '没有匹配的模型配置，请检查 ANTHROPIC_MODEL 是否与模型配置的 name 一致' }
      });
    }
    if (model.forbidden) {
      return res.status(403).json({
        type: 'error',
        error: { type: 'permission_error', message: '无权访问此模型' }
      });
    }

    // 透传：仅覆写 model 字段，不做协议转换
    const upstreamBody = { ...req.body, model: model.modelName };
    requestBody = JSON.stringify(upstreamBody);

    const upstreamRes = await fetch(`${model.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: requestBody
    });

    if (!upstreamRes.ok) {
      const errorData = await upstreamRes.json().catch(() => ({}));
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        localModelName: model.name, remoteModelName: model.modelName,
        upstreamUrl: `${model.baseUrl}/v1/messages`,
        endpoint: '/anthropic/v1/messages', method: 'POST',
        statusCode: upstreamRes.status, success: false,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        errorMessage: errorData.error?.message || 'API 返回错误'
      });
      return res.status(upstreamRes.status).json({
        type: 'error',
        error: {
          type: errorData.error?.type || 'api_error',
          message: errorData.error?.message || 'API 返回错误'
        }
      });
    }

    // 流式透传
    if (req.body.stream) {
      const tokens = await streamAnthropicPassthrough(upstreamRes, res);
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        localModelName: model.name, remoteModelName: model.modelName,
        upstreamUrl: `${model.baseUrl}/v1/messages`,
        endpoint: '/anthropic/v1/messages', method: 'POST',
        statusCode: 200, success: true,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens
      });
      incrementQuota(req.apiKey);
      return;
    }

    // 非流式透传
    const data = await upstreamRes.json();

    logRequest({
      apiKey: req.apiKey, modelId: model.id,
      localModelName: model.name, remoteModelName: model.modelName,
      upstreamUrl: `${model.baseUrl}/v1/messages`,
      endpoint: '/anthropic/v1/messages', method: 'POST',
      statusCode: upstreamRes.status, success: true,
      duration: Date.now() - startTime,
      requestSize: Buffer.byteLength(requestBody),
      responseSize: Buffer.byteLength(JSON.stringify(data)),
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0
    });
    incrementQuota(req.apiKey);

    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    logRequest({
      apiKey: req.apiKey,
      modelId: req.body?.model || 'unknown',
      localModelName: '', remoteModelName: '',
      upstreamUrl: '',
      endpoint: '/anthropic/v1/messages', method: 'POST',
      statusCode: 500, success: false,
      duration: Date.now() - startTime,
      requestSize: Buffer.byteLength(requestBody),
      errorMessage: error.message
    });
    if (!res.headersSent) {
      res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: '代理请求失败', details: error.message }
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════
// 路由: POST /* (通用代理)
// ═══════════════════════════════════════════════════════════

router.post('/*', async (req, res) => {
  const startTime = Date.now();
  let requestBody = '';

  try {
    const model = resolveModel(req);
    if (!model) {
      return res.status(404).json({ error: '没有可用的模型配置' });
    }
    if (model.forbidden) {
      return res.status(403).json({ error: '无权访问此模型', allowedModels: model.allowedModels });
    }

    const path = req.params[0];

    // 构建上游请求体 — 保持原有字段但覆写 model
    let upstreamBody;
    if (typeof req.body === 'object' && req.body !== null) {
      upstreamBody = { ...req.body, model: model.modelName };
    } else {
      upstreamBody = req.body;
    }
    requestBody = JSON.stringify(upstreamBody);

    const upstreamRes = await fetch(`${model.baseUrl}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: requestBody
    });

    if (!upstreamRes.ok) {
      const errorData = await upstreamRes.json().catch(() => ({}));
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        localModelName: model.name, remoteModelName: model.modelName,
        upstreamUrl: `${model.baseUrl}/${path}`,
        endpoint: `/${path}`, method: 'POST',
        statusCode: upstreamRes.status, success: false,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        errorMessage: errorData.error?.message || 'API 返回错误'
      });
      return res.status(upstreamRes.status).json(errorData);
    }

    // 流式透传
    if (typeof req.body === 'object' && req.body !== null && req.body.stream) {
      const tokens = await streamOpenAIPassthrough(upstreamRes, res);
      logRequest({
        apiKey: req.apiKey, modelId: model.id,
        localModelName: model.name, remoteModelName: model.modelName,
        upstreamUrl: `${model.baseUrl}/${path}`,
        endpoint: `/${path}`, method: 'POST',
        statusCode: 200, success: true,
        duration: Date.now() - startTime,
        requestSize: Buffer.byteLength(requestBody),
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens
      });
      incrementQuota(req.apiKey);
      return;
    }

    const data = await upstreamRes.json();

    logRequest({
      apiKey: req.apiKey, modelId: model.id,
      localModelName: model.name, remoteModelName: model.modelName,
      upstreamUrl: `${model.baseUrl}/${path}`,
      endpoint: `/${path}`, method: 'POST',
      statusCode: upstreamRes.status, success: true,
      duration: Date.now() - startTime,
      requestSize: Buffer.byteLength(requestBody),
      responseSize: Buffer.byteLength(JSON.stringify(data)),
      inputTokens: data.usage?.prompt_tokens || data.usage?.input_tokens || 0,
      outputTokens: data.usage?.completion_tokens || data.usage?.output_tokens || 0
    });
    incrementQuota(req.apiKey);

    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    logRequest({
      apiKey: req.apiKey,
      modelId: req.body?.model || 'unknown',
      localModelName: '', remoteModelName: '',
      upstreamUrl: '',
      endpoint: `/${req.params?.[0] || 'unknown'}`, method: 'POST',
      statusCode: 500, success: false,
      duration: Date.now() - startTime,
      requestSize: Buffer.byteLength(requestBody),
      errorMessage: error.message
    });
    if (!res.headersSent) {
      res.status(500).json({ error: '代理请求失败', details: error.message });
    }
  }
});

module.exports = router;
