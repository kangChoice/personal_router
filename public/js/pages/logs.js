// Logs viewer page
App.Pages.logs = async function (container) {
  container.innerHTML = `
    <div class="page-header">
      <h2>请求日志</h2>
      <button class="btn btn-danger" id="clear-logs-btn">清空日志</button>
    </div>
    <div class="filters-bar" id="logs-filters">
      <div class="filter-group">
        <label>开始日期</label>
        <input type="date" id="filter-start-date">
      </div>
      <div class="filter-group">
        <label>结束日期</label>
        <input type="date" id="filter-end-date">
      </div>
      <div class="filter-group">
        <label>本地模型</label>
        <select id="filter-api-key"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label>远程模型</label>
        <select id="filter-remote-model"><option value="">全部</option></select>
      </div>
      <div class="filter-group">
        <label>结果</label>
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
      <button class="btn btn-secondary" id="reset-filters-btn">重置</button>
    </div>
    <div class="table-wrap" id="logs-table-wrap">
      <div class="loading">加载中...</div>
    </div>
    <div class="pagination" id="logs-pagination"></div>
  `;

  document.getElementById('clear-logs-btn').onclick = clearLogs;
  document.getElementById('apply-filters-btn').onclick = () => renderLogs(0);
  document.getElementById('reset-filters-btn').onclick = resetFilters;

  await populateLogFilters();
  renderLogs(0);
};

async function clearLogs() {
  const ok = await App.util.showConfirm('清空日志', '确定要删除所有日志记录吗？此操作不可撤销。');
  if (!ok) return;
  try {
    const result = await App.api.del('/api/keys/logs');
    App.util.showToast(`已清空 ${result.deleted} 条日志`, 'success');
    renderLogs(0);
  } catch (e) {
    App.util.showToast('清空失败: ' + e.message, 'error');
  }
}

function resetFilters() {
  document.getElementById('filter-start-date').value = '';
  document.getElementById('filter-end-date').value = '';
  document.getElementById('filter-api-key').value = '';
  document.getElementById('filter-remote-model').value = '';
  document.getElementById('filter-success').value = '';
  document.getElementById('filter-limit').value = '50';
  renderLogs(0);
}

async function populateLogFilters() {
  // Load models for local model and remote model filter dropdowns
  try {
    const models = await App.api.get('/api/models');
    App.state.modelsCache = models;

    // API key names (本地模型标识)
    const localSel = document.getElementById('filter-api-key');
    const keys = await App.api.get('/api/keys');
    keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k.name;
      opt.textContent = k.name;
      localSel.appendChild(opt);
    });

    // Remote model names (model config modelName), deduplicated
    const remoteSel = document.getElementById('filter-remote-model');
    const seen = new Set();
    models.forEach(m => {
      if (!seen.has(m.modelName)) {
        seen.add(m.modelName);
        const opt = document.createElement('option');
        opt.value = m.modelName;
        opt.textContent = m.modelName;
        remoteSel.appendChild(opt);
      }
    });
  } catch (e) { /* ignore */ }
}

async function renderLogs(offset) {
  const wrap = document.getElementById('logs-table-wrap');
  const pagination = document.getElementById('logs-pagination');
  wrap.innerHTML = '<div class="loading">加载中...</div>';

  const startDate = document.getElementById('filter-start-date').value;
  const endDate = document.getElementById('filter-end-date').value;
  const apiKeyName = document.getElementById('filter-api-key').value;
  const remoteModelName = document.getElementById('filter-remote-model').value;
  const success = document.getElementById('filter-success').value;
  const limit = document.getElementById('filter-limit').value;

  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate + 'T00:00:00.000+08:00');
  if (endDate) params.set('endDate', endDate + 'T23:59:59.999+08:00');
  if (apiKeyName) params.set('apiKeyName', apiKeyName);
  if (remoteModelName) params.set('remoteModelName', remoteModelName);
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

    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>时间</th><th>本地模型</th><th>远程模型</th><th>上游地址</th><th>状态码</th><th>结果</th><th>输入Token</th><th>输出Token</th><th>耗时</th>
        </tr></thead>
        <tbody>${data.logs.map(l => `
          <tr>
            <td style="white-space:nowrap">${App.util.formatDate(l.createdAt)}</td>
            <td>${App.util.escapeHtml(l.apiKeyName || '-')}</td>
            <td class="mono">${App.util.escapeHtml(l.remoteModelName || '-')}</td>
            <td class="mono" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${App.util.escapeHtml(l.upstreamUrl || '')}">${App.util.escapeHtml(l.upstreamUrl || '-')}</td>
            <td>${l.statusCode}</td>
            <td>${l.success
              ? '<span class="badge badge-success">成功</span>'
              : '<span class="badge badge-danger">失败</span>'}</td>
            <td>${App.util.formatTokens(l.inputTokens)}</td>
            <td>${App.util.formatTokens(l.outputTokens)}</td>
            <td>${App.util.formatDuration(l.duration)}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;

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
