const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// 获取所有模型配置
router.get('/', (req, res) => {
  const models = db.get('models').value();
  res.json(models);
});

// 获取单个模型配置
router.get('/:id', (req, res) => {
  const model = db.get('models').find({ id: req.params.id }).value();
  if (!model) {
    return res.status(404).json({ error: '模型配置不存在' });
  }
  res.json(model);
});

// 新增模型配置
router.post('/', (req, res) => {
  const { name, apiKey, baseUrl, modelName, description } = req.body;

  if (!name || !apiKey || !baseUrl) {
    return res.status(400).json({ error: '名称、密钥和 URL 为必填项' });
  }

  // 模型名称不能重复
  const existing = db.get('models').find({ name }).value();
  if (existing) {
    return res.status(409).json({ error: `模型名称 "${name}" 已存在，请使用不同的名称` });
  }

  const newModel = {
    id: uuidv4(),
    name,
    apiKey,
    baseUrl,
    modelName: modelName || name,
    description: description || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.get('models').push(newModel).write();
  res.status(201).json(newModel);
});

// 更新模型配置
router.put('/:id', (req, res) => {
  const model = db.get('models').find({ id: req.params.id }).value();
  if (!model) {
    return res.status(404).json({ error: '模型配置不存在' });
  }

  const { name, apiKey, baseUrl, modelName, description } = req.body;

  // 如果修改了名称，检查是否与已有模型冲突
  if (name !== undefined && name !== model.name) {
    const conflict = db.get('models').find({ name }).value();
    if (conflict) {
      return res.status(409).json({ error: `模型名称 "${name}" 已存在，请使用不同的名称` });
    }
  }

  const updatedModel = {
    ...model,
    name: name !== undefined ? name : model.name,
    apiKey: apiKey !== undefined ? apiKey : model.apiKey,
    baseUrl: baseUrl !== undefined ? baseUrl : model.baseUrl,
    modelName: modelName !== undefined ? modelName : model.modelName,
    description: description !== undefined ? description : model.description,
    updatedAt: new Date().toISOString()
  };

  db.get('models').find({ id: req.params.id }).assign(updatedModel).write();
  res.json(updatedModel);
});

// 根据当前模型配置生成 settings.json (Claude Code 格式) 到项目根目录
router.post('/generate-settings', (req, res) => {
  const models = db.get('models').value();
  const apiKeys = db.get('apiKeys').value();

  if (!apiKeys.length) {
    return res.status(400).json({ error: '没有可用的 API Key 配置' });
  }

  const sharedKey = apiKeys.length > 0 ? apiKeys[0].key : 'sk-xxxxxxxx';
  const port = process.env.PORT || 9999;
  const modelNames = apiKeys.map(k => k.name);

  // 6 个模型槽位：不足则循环重复，超出则取前 6 个
  const modelSlots = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL'
  ];

  const filledModels = {};
  modelSlots.forEach((slot, i) => {
    filledModels[slot] = modelNames[i % modelNames.length];
  });

  const settings = {
    env: {
      ANTHROPIC_AUTH_TOKEN: sharedKey,
      ANTHROPIC_BASE_URL: `http://localhost:${port}/api/proxy/anthropic`,
      ...filledModels
    },
    theme: 'dark'
  };

  res.json({ settings });
});

// 删除模型配置
router.delete('/:id', (req, res) => {
  const model = db.get('models').find({ id: req.params.id }).value();
  if (!model) {
    return res.status(404).json({ error: '模型配置不存在' });
  }

  db.get('models').remove({ id: req.params.id }).write();
  res.json({ message: '删除成功' });
});

module.exports = router;
