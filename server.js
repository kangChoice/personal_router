const express = require('express');
const cors = require('cors');
const db = require('./db');
const modelRoutes = require('./routes/models');
const proxyRoutes = require('./routes/proxy');
const apiKeyRoutes = require('./routes/apiKeys');
const { authenticateApiKey } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 9999;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API 路由
app.use('/api/models', modelRoutes);
app.use('/api/proxy', authenticateApiKey, proxyRoutes);
app.use('/api/keys', apiKeyRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Model Hub 服务已启动：http://localhost:${PORT}`);
});
