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
app.use(express.json({ limit: '200mb' }));
app.use(express.static('public'));

// API 路由
app.use('/api/models', modelRoutes);
app.use('/api/proxy', authenticateApiKey, proxyRoutes);
app.use('/api/keys', apiKeyRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 启动时自动同步：所有本地模型共享同一个 key
const allKeys = db.get('apiKeys').value();
if (allKeys.length > 1) {
  const firstKey = allKeys[0].key;
  const needSync = allKeys.some(k => k.key !== firstKey);
  if (needSync) {
    allKeys.forEach(k => {
      if (k.key !== firstKey) {
        db.get('apiKeys').find({ id: k.id }).assign({ key: firstKey, updatedAt: new Date().toISOString() }).write();
      }
    });
    console.log(`已同步 ${allKeys.length} 个本地模型使用共享密钥`);
  }
}

const server = app.listen(PORT, () => {
  console.log(`Model Hub 服务已启动：http://localhost:${PORT}`);
});

// 热重载兼容：收到退出信号时关闭 server，释放端口
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => {
    console.log(`收到 ${signal}，正在关闭服务...`);
    server.close(() => {
      console.log('服务已关闭');
      process.exit(0);
    });
  });
});
