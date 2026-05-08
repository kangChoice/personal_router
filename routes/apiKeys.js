const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// 获取所有 API Key（不返回完整 key，只显示前缀）
router.get('/', (req, res) => {
  const apiKeys = db.get('apiKeys').value();
  // 隐藏完整的 key，只显示前缀用于识别
  const sanitized = apiKeys.map(key => ({
    ...key,
    key: key.key.substring(0, 8) + '...' // 只显示前 8 个字符
  }));
  res.json(sanitized);
});

// 日志查询端点（必须在 /:id 之前，否则 "logs" 会被当作 :id）
router.get('/logs', (req, res) => {
  const { apiKeyId, modelId, success, limit = 100, offset = 0 } = req.query;

  let query = {};
  if (apiKeyId) query.apiKeyId = apiKeyId;
  if (modelId) query.modelId = modelId;
  if (success !== undefined) query.success = success === 'true';

  const logs = db.get('logs')
    .filter(query)
    .orderBy('createdAt', 'desc')
    .slice(parseInt(offset), parseInt(offset) + parseInt(limit))
    .value();

  res.json({
    total: db.get('logs').filter(query).size().value(),
    limit: parseInt(limit),
    offset: parseInt(offset),
    logs
  });
});

// 获取单个 API Key 详情（需要完整 key ID）
router.get('/:id', (req, res) => {
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) {
    return res.status(404).json({ error: 'API Key 不存在' });
  }
  // 不返回完整 key
  const { key, ...safeData } = apiKey;
  res.json({
    ...safeData,
    key: key.substring(0, 8) + '...'
  });
});

// 创建新的 API Key
router.post('/', (req, res) => {
  const { name, description, models, rateLimit, quota, expiresAt } = req.body;

  if (!name) {
    return res.status(400).json({ error: '名称为必填项' });
  }
  if (!models || !Array.isArray(models) || models.length === 0) {
    return res.status(400).json({ error: '必须关联至少一个模型' });
  }
  if (models.length > 1) {
    return res.status(400).json({ error: '每个密钥只能关联一个模型' });
  }

  const newKey = {
    id: uuidv4(),
    key: `sk-${uuidv4()}`,
    name,
    description: description || '',
    models,
    rateLimit: rateLimit || null,
    quota: quota || null,
    usedQuota: 0,
    expiresAt: expiresAt || null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastUsedAt: null
  };

  db.get('apiKeys').push(newKey).write();

  // 返回完整 key（仅此一次）
  res.status(201).json(newKey);
});

// 更新 API Key
router.put('/:id', (req, res) => {
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) {
    return res.status(404).json({ error: 'API Key 不存在' });
  }

  const { name, description, models, rateLimit, quota, expiresAt, enabled } = req.body;

  if (models !== undefined) {
    if (!Array.isArray(models) || models.length === 0) {
      return res.status(400).json({ error: '必须关联至少一个模型' });
    }
    if (models.length > 1) {
      return res.status(400).json({ error: '每个密钥只能关联一个模型' });
    }
  }

  const updatedKey = {
    ...apiKey,
    name: name !== undefined ? name : apiKey.name,
    description: description !== undefined ? description : apiKey.description,
    models: models !== undefined ? models : apiKey.models,
    rateLimit: rateLimit !== undefined ? rateLimit : apiKey.rateLimit,
    quota: quota !== undefined ? quota : apiKey.quota,
    expiresAt: expiresAt !== undefined ? expiresAt : apiKey.expiresAt,
    enabled: enabled !== undefined ? enabled : apiKey.enabled,
    updatedAt: new Date().toISOString()
  };

  db.get('apiKeys').find({ id: req.params.id }).assign(updatedKey).write();

  // 不返回完整 key
  const { key, ...safeData } = updatedKey;
  res.json({
    ...safeData,
    key: key.substring(0, 8) + '...'
  });
});

// 重置所有限制（配额、速率、过期时间）
router.post('/:id/reset-quota', (req, res) => {
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) {
    return res.status(404).json({ error: 'API Key 不存在' });
  }

  const updatedKey = {
    ...apiKey,
    usedQuota: 0,
    quota: null,
    rateLimit: null,
    expiresAt: null,
    updatedAt: new Date().toISOString()
  };

  db.get('apiKeys').find({ id: req.params.id }).assign(updatedKey).write();
  res.json({ message: '所有限制已清空', usedQuota: 0, quota: null, rateLimit: null, expiresAt: null });
});

// 删除 API Key
router.delete('/:id', (req, res) => {
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) {
    return res.status(404).json({ error: 'API Key 不存在' });
  }

  db.get('apiKeys').remove({ id: req.params.id }).write();
  res.json({ message: '删除成功' });
});

// =====================

// 获取 API Key 的使用统计
router.get('/:id/stats', (req, res) => {
  const apiKey = db.get('apiKeys').find({ id: req.params.id }).value();
  if (!apiKey) {
    return res.status(404).json({ error: 'API Key 不存在' });
  }

  const keyLogs = db.get('logs').filter({ apiKeyId: req.params.id }).value();

  const stats = {
    totalRequests: keyLogs.length,
    successfulRequests: keyLogs.filter(l => l.success).length,
    failedRequests: keyLogs.filter(l => !l.success).length,
    totalRequestSize: keyLogs.reduce((sum, l) => sum + (l.requestSize || 0), 0),
    totalResponseSize: keyLogs.reduce((sum, l) => sum + (l.responseSize || 0), 0),
    avgDuration: keyLogs.length > 0
      ? Math.round(keyLogs.reduce((sum, l) => sum + (l.duration || 0), 0) / keyLogs.length)
      : 0,
    quotaUsed: apiKey.usedQuota || 0,
    quotaLimit: apiKey.quota || null,
    usagePercentage: apiKey.quota
      ? Math.round((apiKey.usedQuota / apiKey.quota) * 100)
      : null
  };

  res.json(stats);
});

module.exports = router;
