const db = require('../db');

/**
 * API Key 认证中间件
 * 验证请求中的 Authorization 头或 x-api-key 头
 */
const authenticateApiKey = (req, res, next) => {
  // 从 header 获取 API key
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];

  let providedKey = null;

  // 支持两种格式：
  // 1. Authorization: Bearer sk-xxx
  // 2. x-api-key: sk-xxx
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7);
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  if (!providedKey) {
    return res.status(401).json({
      error: '缺少认证信息',
      message: '请在请求头中提供 Authorization: Bearer <your-api-key> 或 x-api-key: <your-api-key>'
    });
  }

  // 查找所有匹配的 API key（支持共享 key 场景：多个本地模型共用一个 key）
  const apiKeyRecords = db.get('apiKeys').filter({ key: providedKey }).value();

  if (!apiKeyRecords || apiKeyRecords.length === 0) {
    return res.status(401).json({
      error: '无效的 API Key'
    });
  }

  // 取第一条做状态检查
  const apiKeyRecord = apiKeyRecords[0];

  // 检查是否启用
  if (!apiKeyRecord.enabled) {
    return res.status(403).json({
      error: 'API Key 已禁用',
      keyId: apiKeyRecord.id
    });
  }

  // 检查是否过期
  if (apiKeyRecord.expiresAt) {
    const now = new Date();
    const expiresAt = new Date(apiKeyRecord.expiresAt);
    if (now > expiresAt) {
      return res.status(403).json({
        error: 'API Key 已过期',
        expiredAt: apiKeyRecord.expiresAt
      });
    }
  }

  // 检查配额
  if (apiKeyRecord.quota !== null && apiKeyRecord.usedQuota >= apiKeyRecord.quota) {
    return res.status(429).json({
      error: 'API Key 配额已用尽',
      usedQuota: apiKeyRecord.usedQuota,
      quota: apiKeyRecord.quota
    });
  }

  // 合并所有共享此 key 的记录的 models（去重）
  const allModels = [...new Set(apiKeyRecords.flatMap(k => k.models || []))];

  // 通过认证，将 key 信息附加到 request 对象
  req.apiKey = {
    id: apiKeyRecord.id,
    name: apiKeyRecord.name,
    models: allModels,
    rateLimit: apiKeyRecord.rateLimit,
    quota: apiKeyRecord.quota,
    usedQuota: apiKeyRecord.usedQuota
  };

  next();
};

/**
 * 检查用户是否有权访问指定模型
 * 使用方法：在路由中调用 requireModelAccess('modelId')
 */
const requireModelAccess = (modelIdParam = 'modelId') => {
  return (req, res, next) => {
    const modelId = req.params[modelIdParam];

    // 空 models 表示通用密钥，允许访问所有模型
    if (!req.apiKey.models || req.apiKey.models.length === 0) {
      return next();
    }

    // 检查模型 ID 是否在允许列表中
    if (req.apiKey.models.includes(modelId)) {
      return next();
    }

    return res.status(403).json({
      error: '无权访问此模型',
      allowedModels: req.apiKey.models
    });
  };
};

module.exports = {
  authenticateApiKey,
  requireModelAccess
};
