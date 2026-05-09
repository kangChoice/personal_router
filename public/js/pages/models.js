// Models CRUD page
App.Pages.models = async function (container) {
  container.innerHTML = `
    <div class="page-header">
      <h2>远程模型管理</h2>
      <button class="btn btn-primary" id="add-model-btn">+ 添加模型</button>
    </div>
    <div class="table-wrap" id="models-table-wrap">
      <div class="loading">加载中...</div>
    </div>
  `;

  document.getElementById('add-model-btn').onclick = () => showModelForm();

  await renderModelTable();
};

async function renderModelTable() {
  const wrap = document.getElementById('models-table-wrap');
  try {
    const models = await App.api.get('/api/models');
    App.state.modelsCache = models;

    if (!models.length) {
      wrap.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <p>还没有添加任何模型配置</p>
        <p style="font-size:0.8rem;margin-top:8px">点击"添加模型"开始</p>
      </div>`;
      return;
    }

    wrap.innerHTML = `
      <table>
        <thead><tr>
          <th>model别名</th><th>Model Name(远程模型名称)</th><th>Base URL</th><th>描述</th><th>API Key</th><th>创建时间</th><th>操作</th>
        </tr></thead>
        <tbody>${models.map(m => `
          <tr>
            <td><strong>${App.util.escapeHtml(m.name)}</strong></td>
            <td class="mono">${App.util.escapeHtml(m.modelName)}</td>
            <td class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${App.util.escapeHtml(m.baseUrl)}">${App.util.escapeHtml(m.baseUrl)}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${App.util.escapeHtml(m.description || '-')}</td>
            <td>
              <span class="masked-key" data-full="${App.util.escapeHtml(m.apiKey)}" onclick="App.Pages._toggleKey(this)">${App.util.maskKey(m.apiKey)}</span>
            </td>
            <td>${App.util.formatDate(m.createdAt)}</td>
            <td>
              <div class="btn-group">
                <button class="btn btn-secondary btn-xs edit-model-btn" data-id="${m.id}">编辑</button>
                <button class="btn btn-danger btn-xs delete-model-btn" data-id="${m.id}">删除</button>
              </div>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;

    // Bind events
    wrap.querySelectorAll('.edit-model-btn').forEach(btn => {
      btn.onclick = () => {
        const model = models.find(m => m.id === btn.dataset.id);
        if (model) showModelForm(model);
      };
    });
    wrap.querySelectorAll('.delete-model-btn').forEach(btn => {
      btn.onclick = async () => {
        const ok = await App.util.showConfirm('删除模型', `确定删除模型「${btn.dataset.id}」吗？此操作不可撤销。`);
        if (!ok) return;
        try {
          await App.api.del('/api/models/' + btn.dataset.id);
          App.util.showToast('模型已删除', 'success');
          await renderModelTable();
        } catch (e) { App.util.showToast('删除失败: ' + e.message, 'error'); }
      };
    });
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p>加载失败: ${App.util.escapeHtml(e.message)}</p></div>`;
  }
}

App.Pages._toggleKey = function (el) {
  if (el._showing) {
    el.textContent = App.util.maskKey(el.dataset.full);
    el._showing = false;
  } else {
    el.textContent = el.dataset.full;
    el._showing = true;
  }
};

function showModelForm(existing) {
  const isEdit = !!existing;
  const title = isEdit ? '编辑模型配置' : '添加模型配置';
  const { overlay, close } = App.util.showModal(`
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>名称 *</label>
        <input type="text" id="form-name" placeholder="例如: OpenAI GPT-4" value="${App.util.escapeHtml(existing?.name || '')}">
      </div>
      <div class="form-group">
        <label>API 密钥 *</label>
        <input type="password" id="form-apikey" placeholder="${isEdit ? '留空则不修改' : 'sk-...'}" value="">
        ${isEdit ? '<div class="form-hint">留空则保持现有密钥不变</div>' : ''}
      </div>
      <div class="form-group">
        <label>请求地址 (Base URL) *</label>
        <input type="url" id="form-baseurl" placeholder="https://api.openai.com" value="${App.util.escapeHtml(existing?.baseUrl || '')}">
      </div>
      <div class="form-group">
        <label>模型名称 (Model Name)</label>
        <input type="text" id="form-modelname" placeholder="默认为名称" value="${App.util.escapeHtml(existing?.modelName || '')}">
        <div class="form-hint">发送给远程 API 的 model 参数</div>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea id="form-desc" placeholder="可选，用于备忘">${App.util.escapeHtml(existing?.description || '')}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary close-btn">取消</button>
      <button class="btn btn-primary save-btn">${isEdit ? '保存修改' : '添加'}</button>
    </div>
  `, { small: false });

  overlay.querySelector('.close-btn')?.addEventListener('click', close);
  overlay.querySelector('.save-btn').addEventListener('click', async () => {
    const name = overlay.querySelector('#form-name').value.trim();
    const apiKey = overlay.querySelector('#form-apikey').value.trim();
    const baseUrl = overlay.querySelector('#form-baseurl').value.trim();
    const modelName = overlay.querySelector('#form-modelname').value.trim();
    const description = overlay.querySelector('#form-desc').value.trim();

    if (!name) { App.util.showToast('请输入名称', 'error'); return; }
    if (!baseUrl) { App.util.showToast('请输入请求地址', 'error'); return; }
    if (!isEdit && !apiKey) { App.util.showToast('请输入 API 密钥', 'error'); return; }

    const body = { name, baseUrl, description };
    if (apiKey) body.apiKey = apiKey;
    if (modelName) body.modelName = modelName;

    try {
      if (isEdit) {
        await App.api.put('/api/models/' + existing.id, body);
        App.util.showToast('模型已更新', 'success');
      } else {
        await App.api.post('/api/models', body);
        App.util.showToast('模型已添加', 'success');
      }
      close();
      await renderModelTable();
    } catch (e) { App.util.showToast('操作失败: ' + e.message, 'error'); }
  });
}
