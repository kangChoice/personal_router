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
