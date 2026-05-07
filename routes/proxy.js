const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const db = require('../db');
const { requireModelAccess } = require('../middleware/auth');

// 模型代理转发
router.post('/:modelId/chat/completions', requireModelAccess(), async (req, res) => {
  try {
    const model = db.get('models').find({ id: req.params.modelId }).value();
    if (!model) {
      return res.status(404).json({ error: '模型配置不存在' });
    }

    // 增加 API Key 使用配额并记录日志
    if (req.apiKey) {
      const startTime = Date.now();
      const keyRecord = db.get('apiKeys').find({ id: req.apiKey.id }).value();

      try {
        const response = await fetch(`${model.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${model.apiKey}`
          },
          body: JSON.stringify({
            model: model.modelName,
            messages: req.body.messages,
            temperature: req.body.temperature || 0.7,
            max_tokens: req.body.max_tokens || 2048,
            stream: req.body.stream || false
          })
        });

        const data = await response.json();

        if (!response.ok) {
          // 记录失败的请求
          db.get('logs').push({
            id: require('uuid').v4(),
            apiKeyId: req.apiKey.id,
            apiKeyName: req.apiKey.name,
            modelId: req.params.modelId,
            endpoint: '/chat/completions',
            method: 'POST',
            statusCode: response.status,
            success: false,
            duration: Date.now() - startTime,
            requestSize: Buffer.byteLength(JSON.stringify(req.body)),
            responseSize: 0,
            errorMessage: data.error?.message || 'API 返回错误',
            createdAt: new Date().toISOString()
          }).write();

          return res.status(response.status).json(data);
        }

        // 成功记录
        db.get('logs').push({
          id: require('uuid').v4(),
          apiKeyId: req.apiKey.id,
          apiKeyName: req.apiKey.name,
          modelId: req.params.modelId,
          endpoint: '/chat/completions',
          method: 'POST',
          statusCode: response.status,
          success: true,
          duration: Date.now() - startTime,
          requestSize: Buffer.byteLength(JSON.stringify(req.body)),
          responseSize: Buffer.byteLength(JSON.stringify(data)),
          createdAt: new Date().toISOString()
        }).write();

        // 更新配额
        db.get('apiKeys')
          .find({ id: req.apiKey.id })
          .assign({
            usedQuota: (keyRecord.usedQuota || 0) + 1,
            lastUsedAt: new Date().toISOString()
          })
          .write();

        res.json(data);
      } catch (error) {
        console.error('Proxy error:', error);

        // 记录异常
        db.get('logs').push({
          id: require('uuid').v4(),
          apiKeyId: req.apiKey.id,
          apiKeyName: req.apiKey.name,
          modelId: req.params.modelId,
          endpoint: '/chat/completions',
          method: 'POST',
          statusCode: 500,
          success: false,
          duration: Date.now() - startTime,
          requestSize: Buffer.byteLength(JSON.stringify(req.body)),
          responseSize: 0,
          errorMessage: error.message,
          createdAt: new Date().toISOString()
        }).write();

        res.status(500).json({ error: '代理请求失败', details: error.message });
      }
    } else {
      // 无认证模式（向后兼容）
      const response = await fetch(`${model.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`
        },
        body: JSON.stringify({
          model: model.modelName,
          messages: req.body.messages,
          temperature: req.body.temperature || 0.7,
          max_tokens: req.body.max_tokens || 2048,
          stream: req.body.stream || false
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json(data);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: '代理请求失败', details: error.message });
  }
});

// 通用代理端点（支持任意 API）
router.post('/:modelId/*', requireModelAccess(), async (req, res) => {
  try {
    const model = db.get('models').find({ id: req.params.modelId }).value();
    if (!model) {
      return res.status(404).json({ error: '模型配置不存在' });
    }

    const path = req.params[0];
    const startTime = Date.now();
    const keyRecord = req.apiKey ? db.get('apiKeys').find({ id: req.apiKey.id }).value() : null;

    try {
      const response = await fetch(`${model.baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`
        },
        body: JSON.stringify(req.body)
      });

      const data = await response.json();

      // 记录请求日志
      if (req.apiKey && keyRecord) {
        db.get('logs').push({
          id: require('uuid').v4(),
          apiKeyId: req.apiKey.id,
          apiKeyName: req.apiKey.name,
          modelId: req.params.modelId,
          endpoint: `/${path}`,
          method: 'POST',
          statusCode: response.ok ? response.status : 500,
          success: response.ok,
          duration: Date.now() - startTime,
          requestSize: Buffer.byteLength(JSON.stringify(req.body)),
          responseSize: Buffer.byteLength(JSON.stringify(data)),
          errorMessage: !response.ok ? 'API 返回错误' : undefined,
          createdAt: new Date().toISOString()
        }).write();

        // 更新配额
        db.get('apiKeys')
          .find({ id: req.apiKey.id })
          .assign({
            usedQuota: (keyRecord.usedQuota || 0) + 1,
            lastUsedAt: new Date().toISOString()
          })
          .write();
      }

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json(data);
    } catch (error) {
      console.error('Proxy error:', error);

      // 记录异常
      if (req.apiKey && keyRecord) {
        db.get('logs').push({
          id: require('uuid').v4(),
          apiKeyId: req.apiKey.id,
          apiKeyName: req.apiKey.name,
          modelId: req.params.modelId,
          endpoint: `/${path}`,
          method: 'POST',
          statusCode: 500,
          success: false,
          duration: Date.now() - startTime,
          requestSize: Buffer.byteLength(JSON.stringify(req.body)),
          responseSize: 0,
          errorMessage: error.message,
          createdAt: new Date().toISOString()
        }).write();
      }

      res.status(500).json({ error: '代理请求失败', details: error.message });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: '代理请求失败', details: error.message });
  }
});

module.exports = router;
