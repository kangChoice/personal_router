const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

// 初始化默认数据
db.defaults({
  models: [],
  apiKeys: [],
  logs: []
}).write();

module.exports = db;
