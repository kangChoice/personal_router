const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 生成 settings.json 内容（仅返回，不写入文件）
router.get('/generate', (req, res) => {
  const models = db.get('models').value();
  const apiKeys = db.get('apiKeys').value();

  if (!apiKeys.length) {
    return res.status(400).json({ error: '没有可用的 API Key 配置' });
  }

  const sharedKey = apiKeys.length > 0 ? apiKeys[0].key : 'sk-xxxxxxxx';
  const port = process.env.PORT || 9999;
  const modelNames = apiKeys.map(k => k.name);

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

// 写入 settings.json 到指定路径
router.post('/write', (req, res) => {
  const { filePath, settings } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: '文件路径不能为空' });
  }

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings 内容无效' });
  }

  // 展开 ~ 为用户主目录
  let resolvedPath = filePath;
  if (filePath.startsWith('~')) {
    resolvedPath = path.join(os.homedir(), filePath.slice(1).replace(/^[\\/]/, ''));
  }

  try {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, JSON.stringify(settings, null, 2), 'utf-8');
    res.json({ message: 'settings.json 已写入', path: resolvedPath });
  } catch (err) {
    res.status(500).json({ error: '文件写入失败', details: err.message });
  }
});

module.exports = router;
