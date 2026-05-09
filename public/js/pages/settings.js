App.Pages.settings = async function (container) {
  const savedPath = localStorage.getItem('claude-settings-path') || '';
  const winDefaultPath = '~\\.claude\\settings.json';
  const macDefaultPath = '~/.claude/settings.json';

  container.innerHTML = `
    <div class="page-header">
      <h2>配置更新</h2>
      <span class="page-subtitle">一键根据当前配置自定义模型更新 Claude Code 的 settings.json</span>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">本机配置文件路径</label>
          <div class="settings-path-row">
            <input type="text" class="form-input" id="settings-path"
              placeholder="${App.util.escapeHtml(macDefaultPath)}"
              value="${App.util.escapeHtml(savedPath)}">
            <button class="btn btn-secondary" id="reset-path-win-btn">Win默认</button>
            <button class="btn btn-secondary" id="reset-path-mac-btn">Mac默认</button>
          </div>
          <span class="form-hint">Claude Code 的 settings.json 文件路径，Windows 下为 ~\\.claude\\settings.json，macOS/Linux 下为 ~/.claude/settings.json</span>
        </div>
        <div class="form-group">
          <button class="btn btn-primary" id="generate-btn">生成 settings.json</button>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top: 16px;">
      <div class="card-header">
        <h3>关于</h3>
      </div>
      <div class="card-body">
        <p class="text-secondary">生成的 settings.json 将配置 Claude Code 使用 Model Hub 作为代理，包含：</p>
        <ul class="text-secondary" style="padding-left: 20px; margin-top: 8px; line-height: 2;">
          <li>ANTHROPIC_AUTH_TOKEN — 共享 API Key</li>
          <li>ANTHROPIC_BASE_URL — 代理地址</li>
          <li>ANTHROPIC_MODEL / ANTHROPIC_SMALL_FAST_MODEL 等 6 个模型槽位</li>
        </ul>
      </div>
    </div>
  `;

  const pathInput = document.getElementById('settings-path');

  pathInput.addEventListener('change', () => {
    localStorage.setItem('claude-settings-path', pathInput.value.trim());
  });

  document.getElementById('reset-path-win-btn').addEventListener('click', () => {
    pathInput.value = winDefaultPath;
    localStorage.setItem('claude-settings-path', winDefaultPath);
  });

  document.getElementById('reset-path-mac-btn').addEventListener('click', () => {
    pathInput.value = macDefaultPath;
    localStorage.setItem('claude-settings-path', macDefaultPath);
  });

  document.getElementById('generate-btn').addEventListener('click', async () => {
    const filePath = pathInput.value.trim() || macDefaultPath;
    localStorage.setItem('claude-settings-path', filePath);

    const btn = document.getElementById('generate-btn');
    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
      const { error, settings } = await App.api.get('/api/settings/generate');
      if (error) {
        App.util.showToast(error, 'error');
        return;
      }

      const jsonStr = JSON.stringify(settings, null, 2);
      const escapedJson = App.util.escapeHtml(jsonStr);

      const { close } = App.util.showModal(`
        <div class="modal-header">
          <h3>生成的 settings.json</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <pre class="settings-preview"><code>${escapedJson}</code></pre>
          <div class="settings-path-info">
            <span class="form-label">目标路径：</span>
            <code>${App.util.escapeHtml(filePath)}</code>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="copy-btn">复制</button>
          <button class="btn btn-primary" id="overwrite-btn">覆盖本地文件</button>
          <button class="btn btn-secondary close-btn">关闭</button>
        </div>
      `, { wide: true });

      document.getElementById('copy-btn').addEventListener('click', async () => {
        await App.util.copyToClipboard(jsonStr);
        App.util.showToast('已复制到剪贴板', 'success');
      });

      document.querySelector('.close-btn').addEventListener('click', close);

      document.getElementById('overwrite-btn').addEventListener('click', async () => {
        const confirmed = await App.util.showConfirm(
          '覆盖确认',
          `确认要将 settings.json 写入以下路径吗？此操作将覆盖已有文件。<br><br><span style="display:inline-block;background:var(--bg);border:1px solid var(--danger);color:var(--danger);padding:6px 12px;border-radius:4px;font-family:monospace;word-break:break-all;">${App.util.escapeHtml(filePath)}</span>`
        );
        if (!confirmed) return;

        try {
          const result = await App.api.post('/api/settings/write', { filePath, settings });
          if (result.error) {
            App.util.showToast('写入失败: ' + result.error, 'error');
          } else {
            App.util.showToast('已写入: ' + (result.path || filePath), 'success');
            close();
          }
        } catch (e) {
          App.util.showToast('请求失败: ' + e.message, 'error');
        }
      });
    } catch (e) {
      App.util.showToast('生成失败: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '生成 settings.json';
    }
  });
};
