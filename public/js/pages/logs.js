// Logs viewer page
App.Pages.logs = async function (container) {
  container.innerHTML = `
    <div class="page-header"><h2>请求日志</h2></div>
    <div class="filters-bar" id="logs-filters">
      <div class="filter-group">
        <label>自定义model name</label>
        <select id="filter-apikey"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label>模型</label>
        <select id="filter-model"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label>状态</label>
        <select id="filter-success">
          <option value="">全部</option>
          <option value="true">成功</option>
          <option value="false">失败</option>
        </select>
      </div>
      <div class="filter-group">
        <label>每页条数</label>
        <select id="filter-limit">
          <option value="25">25</option>
          <option value="50" selected>50</option>
          <option value="100">100</option>
        </select>
      </div>
      <button class="btn btn-primary" id="apply-filters-btn">查询</button>
    </div>
    <div class="table-wrap" id="logs-table-wrap">
      <div class="loading">加载中...</div>
    </div>
    <div class="pagination" id="logs-pagination"></div>
  `;

  await populateLogFilters();
  document.getElementById('apply-filters-btn').onclick = () => renderLogs(0);
  renderLogs(0);
};

async function populateLogFilters() {
  // Load keys for filter dropdown
  try {
    const keys = await App.api.get('/api/keys');
    App.state.keysCache = keys;
    const sel = document.getElementById('filter-apikey');
    keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k.id;
      opt.textContent = k.name + ' (' + k.key.substring(0, 8) + '...)';
      sel.appendChild(opt);
    });
  } catch (e) { /* ignore */ }

  // Load models for filter dropdown
  try {
    const models = await App.api.get('/api/models');
    App.state.modelsCache = models;
    const sel = document.getElementById('filter-model');
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });
  } catch (e) { /* ignore */ }
}

async function renderLogs(offset) {
  const wrap = document.getElementById('logs-table-wrap');
  const pagination = document.getElementById('logs-pagination');
  wrap.innerHTML = '<div class="loading">加载中...</div>';

  const apiKeyId = document.getElementById('filter-apikey').value;
  const modelId = document.getElementById('filter-model').value;
  const success = document.getElementById('filter-success').value;
  const limit = document.getElementById('filter-limit').value;

  const params = new URLSearchParams();
  if (apiKeyId) params.set('apiKeyId', apiKeyId);
  if (modelId) params.set('modelId', modelId);
  if (success) params.set('success', success);
  params.set('limit', limit);
  params.set('offset', offset);

  try {
    const data = await App.api.get('/api/keys/logs?' + params.toString());

    if (!data.logs.length) {
      wrap.innerHTML = '<div class="empty-state"><p>没有找到日志记录</p></div>';
      pagination.innerHTML = '';
      return;
    }

    // Build lookup maps for display names
    const keyMap = {};
    App.state.keysCache.forEach(k => { keyMap[k.id] = k.name; });
    const modelMap = {};
    App.state.modelsCache.forEach(m => { modelMap[m.id] = m.name; });

    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>时间</th><th>自定义model name</th><th>模型(model别名)</th><th>path</th><th>方法</th><th>状态码</th><th>结果</th><th>耗时</th><th>请求大小</th><th>响应大小</th><th>错误</th>
        </tr></thead>
        <tbody>${data.logs.map(l => `
          <tr>
            <td style="white-space:nowrap">${App.util.formatDate(l.createdAt)}</td>
            <td>${App.util.escapeHtml(l.apiKeyName || keyMap[l.apiKeyId] || l.apiKeyId)}</td>
            <td>${App.util.escapeHtml(modelMap[l.modelId] || l.modelId)}</td>
            <td class="mono">${App.util.escapeHtml(l.endpoint)}</td>
            <td>${App.util.escapeHtml(l.method)}</td>
            <td>${l.statusCode}</td>
            <td>${l.success
              ? '<span class="badge badge-success">成功</span>'
              : '<span class="badge badge-danger">失败</span>'}</td>
            <td>${App.util.formatDuration(l.duration)}</td>
            <td>${App.util.formatBytes(l.requestSize)}</td>
            <td>${App.util.formatBytes(l.responseSize)}</td>
            <td>${l.errorMessage
              ? `<span class="badge badge-danger" title="${App.util.escapeHtml(l.errorMessage)}">有</span>`
              : '-'}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;

    // Pagination
    const total = data.total;
    const currentEnd = Math.min(offset + parseInt(limit), total);
    pagination.innerHTML = `
      <span>共 ${total} 条，显示 ${offset + 1} - ${currentEnd}</span>
      <div class="pagination-controls">
        <button class="btn btn-secondary btn-sm" id="prev-page-btn" ${offset === 0 ? 'disabled' : ''}>上一页</button>
        <button class="btn btn-secondary btn-sm" id="next-page-btn" ${currentEnd >= total ? 'disabled' : ''}>下一页</button>
      </div>
    `;

    document.getElementById('prev-page-btn').onclick = () => {
      renderLogs(Math.max(0, offset - parseInt(limit)));
    };
    document.getElementById('next-page-btn').onclick = () => {
      renderLogs(offset + parseInt(limit));
    };
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p>加载失败: ${App.util.escapeHtml(e.message)}</p></div>`;
    pagination.innerHTML = '';
  }
}
