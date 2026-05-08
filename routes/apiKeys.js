const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// 清空所有日志
router.delete('/logs', (req, res) => {
  const logs = db.get('logs');
  const count = logs.size().value();
  logs.remove().write();
  res.json({ message: '日志已清空', deleted: count });
});

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
  const { localModelName, remoteModelName, success, startDate, endDate, limit = 100, offset = 0 } = req.query;

  // 取出所有日志为普通数组，用纯 JS 过滤，避免 lowdb/lodash 链式 filter 兼容问题
  let logs = db.get('logs').value();

  if (localModelName) {
    logs = logs.filter(l => l.localModelName === localModelName);
  }
  if (remoteModelName) {
    logs = logs.filter(l => l.remoteModelName === remoteModelName);
  }
  if (success !== undefined) {
    const isSuccess = success === 'true';
    logs = logs.filter(l => l.success === isSuccess);
  }
  if (startDate) {
    logs = logs.filter(l => l.createdAt >= startDate);
  }
  if (endDate) {
    logs = logs.filter(l => l.createdAt <= endDate);
  }

  // 按时间倒序
  logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = logs.length;

  const paged = logs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

  res.json({
    total,
    limit: parseInt(limit),
    offset: parseInt(offset),
    logs: paged
  });
});

// 查询当前共享密钥信息
router.get('/current-key', (req, res) => {
  const allKeys = db.get('apiKeys').value();
  if (allKeys.length === 0) {
    return res.json({ exists: false, message: '暂无本地模型，创建第一个时将自动生成共享密钥' });
  }
  const sharedKey = allKeys[0].key;
  res.json({
    exists: true,
    sharedKey,
    totalModels: allKeys.length,
    modelNames: allKeys.map(k => k.name)
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

  // 密钥名称不能重复（作为本地模型标识）
  const existingName = db.get('apiKeys').find({ name }).value();
  if (existingName) {
    return res.status(409).json({ error: `密钥名称 "${name}" 已存在，请使用不同的名称` });
  }

  const modelsList = models || [];
  if (!Array.isArray(modelsList)) {
    return res.status(400).json({ error: 'models 必须是数组' });
  }
  if (modelsList.length > 1) {
    return res.status(400).json({ error: '每个密钥只能关联一个模型' });
  }

  // 共享密钥：所有本地模型使用同一个 key
  const existingKeys = db.get('apiKeys').value();
  const sharedKey = existingKeys.length > 0 ? existingKeys[0].key : `sk-${uuidv4()}`;

  const newKey = {
    id: uuidv4(),
    key: sharedKey,
    name,
    description: description || '',
    models: modelsList,
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

  // 名称唯一性检查
  if (name !== undefined && name !== apiKey.name) {
    const conflict = db.get('apiKeys').find({ name }).value();
    if (conflict) {
      return res.status(409).json({ error: `密钥名称 "${name}" 已存在，请使用不同的名称` });
    }
  }

  if (models !== undefined) {
    if (!Array.isArray(models)) {
      return res.status(400).json({ error: 'models 必须是数组' });
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
