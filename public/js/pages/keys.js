// API Keys CRUD page
App.Pages.keys = async function (container) {
  container.innerHTML = `
    <div class="page-header">
      <h2>API 密钥管理</h2>
      <div class="btn-group">
        <button class="btn btn-secondary" id="shared-key-btn">查询共享密钥</button>
        <button class="btn btn-primary" id="add-key-btn">+ 生成密钥</button>
      </div>
    </div>
    <div id="keys-stats-panel"></div>
    <div class="table-wrap" id="keys-table-wrap">
      <div class="loading">加载中...</div>
    </div>
  `;

  document.getElementById('add-key-btn').onclick = () => showKeyForm();
  document.getElementById('shared-key-btn').onclick = () => showSharedKeyInfo();

  await renderKeyTable();
};

async function showSharedKeyInfo() {
  const panel = document.getElementById('keys-stats-panel');
  panel.innerHTML = '<div class="loading">查询中...</div>';
  try {
    const info = await App.api.get('/api/keys/current-key');
    if (!info.exists) {
      panel.innerHTML = `<div class="empty-state"><p>${info.message}</p></div>`;
      return;
    }
    panel.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-size:1rem;">共享密钥信息</h3>
          <button class="btn btn-secondary btn-sm" id="close-shared-key-btn">关闭</button>
        </div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">共享密钥</div>
            <div class="stat-value mono" style="font-size:0.8rem;word-break:break-all;">${App.util.escapeHtml(info.sharedKey)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">本地模型总数</div>
            <div class="stat-value">${info.totalModels}</div>
          </div>
        </div>
        <div style="margin-top:16px;">
          <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px;">已注册的本地模型：</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${info.modelNames.map(n => `<span class="badge badge-info">${App.util.escapeHtml(n)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
    document.getElementById('close-shared-key-btn').onclick = () => { panel.innerHTML = ''; };
  } catch (e) {
    panel.innerHTML = `<div class="empty-state"><p>查询失败: ${App.util.escapeHtml(e.message)}</p></div>`;
  }
}

async function renderKeyTable() {
  const wrap = document.getElementById('keys-table-wrap');
  try {
    const keys = await App.api.get('/api/keys');
    App.state.keysCache = keys;

    if (!keys.length) {
      wrap.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        <p>还没有生成任何 API 密钥</p>
      </div>`;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>名称</th><th>密钥</th><th>可访问模型</th><th>配额</th><th>状态</th><th>最后使用</th><th>操作</th>
        </tr></thead>
        <tbody>${keys.map(k => {
          const quotaStr = k.quota ? `${k.usedQuota || 0} / ${k.quota}` : '无限制';
          const modelId = k.models?.[0];
          const modelDisplay = modelId
            ? (App.state.modelsCache?.find(m => m.id === modelId)?.name || modelId)
            : '-';
          return `
          <tr>
            <td><strong>${App.util.escapeHtml(k.name)}</strong></td>
            <td class="mono">${App.util.escapeHtml(k.key)}</td>
            <td>${modelDisplay}</td>
            <td>${quotaStr}</td>
            <td>${k.enabled !== false
              ? '<span class="badge badge-success">启用</span>'
              : '<span class="badge badge-danger">禁用</span>'}
            </td>
            <td>${App.util.formatDate(k.lastUsedAt)}</td>
            <td>
              <div class="btn-group">
                <button class="btn btn-secondary btn-xs stats-key-btn" data-id="${k.id}">统计</button>
                <button class="btn btn-secondary btn-xs edit-key-btn" data-id="${k.id}">编辑</button>
                <button class="btn btn-secondary btn-xs reset-key-btn" data-id="${k.id}" title="重置配额">重置</button>
                <button class="btn btn-danger btn-xs delete-key-btn" data-id="${k.id}">删除</button>
              </div>
            </td>
          </tr>
        `}).join('')}</tbody>
      </table>
    `;

    wrap.querySelectorAll('.edit-key-btn').forEach(btn => {
      btn.onclick = () => {
        const key = keys.find(k => k.id === btn.dataset.id);
        if (key) showKeyForm(key);
      };
    });
    wrap.querySelectorAll('.delete-key-btn').forEach(btn => {
      btn.onclick = async () => {
        const ok = await App.util.showConfirm('删除密钥', `确定删除密钥「${btn.dataset.id}」吗？此操作不可撤销，使用此密钥的客户端将立即无法访问。`);
        if (!ok) return;
        try {
          await App.api.del('/api/keys/' + btn.dataset.id);
          App.util.showToast('密钥已删除', 'success');
          await renderKeyTable();
        } catch (e) { App.util.showToast('删除失败: ' + e.message, 'error'); }
      };
    });
    wrap.querySelectorAll('.reset-key-btn').forEach(btn => {
      btn.onclick = async () => {
        const ok = await App.util.showConfirm('重置配额', '确定将此密钥的已使用配额清零吗？');
        if (!ok) return;
        try {
          await App.api.post('/api/keys/' + btn.dataset.id + '/reset-quota');
          App.util.showToast('配额已重置', 'success');
          await renderKeyTable();
        } catch (e) { App.util.showToast('重置失败: ' + e.message, 'error'); }
      };
    });
    wrap.querySelectorAll('.stats-key-btn').forEach(btn => {
      btn.onclick = () => showKeyStats(btn.dataset.id);
    });
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p>加载失败: ${App.util.escapeHtml(e.message)}</p></div>`;
  }
}

async function showKeyStats(keyId) {
  const panel = document.getElementById('keys-stats-panel');
  panel.innerHTML = '<div class="loading">加载统计中...</div>';
  try {
    const keyRecord = App.state.keysCache.find(k => k.id === keyId) || {};
    const stats = await App.api.get('/api/keys/' + keyId + '/stats');

    let quotaClass = 'success';
    if (stats.usagePercentage !== null) {
      if (stats.usagePercentage > 80) quotaClass = 'danger';
      else if (stats.usagePercentage > 60) quotaClass = 'warning';
    }

    panel.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-size:1rem;">密钥统计：${App.util.escapeHtml(keyRecord.name || keyId)}</h3>
          <button class="btn btn-secondary btn-sm" id="close-stats-btn">关闭</button>
        </div>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总请求数</div>
            <div class="stat-value">${stats.totalRequests}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">成功</div>
            <div class="stat-value" style="color:var(--success)">${stats.successfulRequests}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">失败</div>
            <div class="stat-value" style="color:var(--danger)">${stats.failedRequests}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">平均耗时</div>
            <div class="stat-value">${App.util.formatDuration(stats.avgDuration)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">请求流量</div>
            <div class="stat-value">${App.util.formatBytes(stats.totalRequestSize)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">响应流量</div>
            <div class="stat-value">${App.util.formatBytes(stats.totalResponseSize)}</div>
          </div>
        </div>
        ${stats.quotaLimit ? `
          <div style="margin-top:16px;">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px;">
              <span>配额使用</span><span>${stats.quotaUsed} / ${stats.quotaLimit} (${stats.usagePercentage}%)</span>
            </div>
            <div class="progress-bar"><div class="progress-fill ${quotaClass}" style="width:${Math.min(stats.usagePercentage || 0, 100)}%"></div></div>
          </div>
        ` : ''}
      </div>
    `;
    document.getElementById('close-stats-btn').onclick = () => { panel.innerHTML = ''; };
  } catch (e) {
    panel.innerHTML = `<div class="empty-state"><p>加载统计失败: ${App.util.escapeHtml(e.message)}</p></div>`;
  }
}

async function showKeyForm(existing) {
  const isEdit = !!existing;
  const title = isEdit ? '编辑 API 密钥' : '生成 API 密钥';

  // Need models list for the selector
  let models = App.state.modelsCache;
  if (!models.length) {
    try { models = await App.api.get('/api/models'); App.state.modelsCache = models; } catch (e) { /* ignore */ }
  }

  const modelOpts = models.map(m => {
    const sel = (existing?.models?.[0] === m.id) || (!existing && models.indexOf(m) === 0) ? 'selected' : '';
    return `<option value="${m.id}" ${sel}>${App.util.escapeHtml(m.name)} (${App.util.escapeHtml(m.modelName)})</option>`;
  }).join('');

  const { overlay, close } = App.util.showModal(`
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>名称 *</label>
        <input type="text" id="form-key-name" placeholder="例如: 我的个人密钥" value="${App.util.escapeHtml(existing?.name || '')}">
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea id="form-key-desc" placeholder="可选">${App.util.escapeHtml(existing?.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label>允许访问的模型</label>
        <select id="form-key-models" style="min-height:36px;">
          ${modelOpts}
        </select>
        <div class="form-hint">每个密钥只能关联一个模型</div>
      </div>
      <div class="form-group">
        <label>速率限制 (次/分钟)</label>
        <input type="number" id="form-key-rate" placeholder="留空则不限制" value="${existing?.rateLimit || ''}">
      </div>
      <div class="form-group">
        <label>总配额 (次)</label>
        <input type="number" id="form-key-quota" placeholder="留空则不限制" value="${existing?.quota || ''}">
      </div>
      <div class="form-group">
        <label>过期时间</label>
        <input type="datetime-local" id="form-key-expires" value="${existing?.expiresAt ? existing.expiresAt.replace('Z', '') : ''}">
      </div>
      ${isEdit ? `
        <div class="form-group">
          <label>启用</label>
          <label class="toggle">
            <input type="checkbox" id="form-key-enabled" ${existing?.enabled !== false ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary close-btn">取消</button>
      <button class="btn btn-primary save-btn">${isEdit ? '保存修改' : '生成'}</button>
    </div>
  `, { small: false });

  overlay.querySelector('.close-btn')?.addEventListener('click', close);
  overlay.querySelector('.save-btn').addEventListener('click', async () => {
    const name = overlay.querySelector('#form-key-name').value.trim();
    const description = overlay.querySelector('#form-key-desc').value.trim();
    const modelsSelect = overlay.querySelector('#form-key-models');
    const models = modelsSelect.value ? [modelsSelect.value] : [];
    const rateLimit = overlay.querySelector('#form-key-rate').value;
    const quota = overlay.querySelector('#form-key-quota').value;
    const expiresAt = overlay.querySelector('#form-key-expires').value;
    const enabledCheckbox = overlay.querySelector('#form-key-enabled');

    if (!name) { App.util.showToast('请输入密钥名称', 'error'); return; }

    const body = { name, description, models };
    if (rateLimit) body.rateLimit = parseInt(rateLimit);
    if (quota) body.quota = parseInt(quota);
    if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();

    try {
      if (isEdit) {
        if (enabledCheckbox) body.enabled = enabledCheckbox.checked;
        await App.api.put('/api/keys/' + existing.id, body);
        App.util.showToast('密钥已更新', 'success');
        close();
        await renderKeyTable();
      } else {
        const newKey = await App.api.post('/api/keys', body);
        close();
        // Show the full key reveal modal
        showKeyReveal(newKey);
        await renderKeyTable();
      }
    } catch (e) { App.util.showToast('操作失败: ' + e.message, 'error'); }
  });
}

function showKeyReveal(keyData) {
  const { overlay } = App.util.showModal(`
    <div class="modal-header">
      <h3>密钥已生成</h3>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <p>密钥「${App.util.escapeHtml(keyData.name)}」已创建。</p>
      <div class="key-reveal">
        <p class="key-warning">请立即复制此密钥！关闭此窗口后将无法再次查看完整密钥。</p>
        <div class="key-text" id="full-key-text">${App.util.escapeHtml(keyData.key)}</div>
        <button class="btn btn-primary" id="copy-full-key-btn">复制到剪贴板</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary close-btn">我已复制，关闭</button>
    </div>
  `, { small: false });

  overlay.querySelector('#copy-full-key-btn').onclick = async () => {
    await App.util.copyToClipboard(keyData.key);
    App.util.showToast('已复制到剪贴板', 'success');
  };
  overlay.querySelector('.close-btn')?.addEventListener('click', () => overlay.remove());
}
