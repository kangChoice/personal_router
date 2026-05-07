window.App = window.App || {};

App.Pages = {};
App.state = {
  modelsCache: [],
  keysCache: []
};

// ---- Routing ----
App.router = {
  currentPage: null,

  navigate(hash) {
    const tab = hash.replace('#', '') || 'models';
    this.activate(tab);
  },

  activate(tab) {
    if (this.currentPage === tab) return;
    this.currentPage = tab;

    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });

    const container = document.getElementById('main-content');
    container.innerHTML = '<div class="loading">加载中...</div>';

    const renderFn = App.Pages[tab];
    if (renderFn) {
      renderFn(container);
    } else {
      container.innerHTML = '<div class="empty-state">页面不存在</div>';
    }
  }
};

// ---- Utilities ----
App.util = {
  formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  },

  formatBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  },

  formatDuration(ms) {
    if (!ms) return '0ms';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  },

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  },

  maskKey(key) {
    if (!key || key.length <= 8) return '****';
    return key.substring(0, 8) + '...';
  },

  showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  showConfirm(title, message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal modal-sm">
          <div class="modal-header"><h3>${App.util.escapeHtml(title)}</h3></div>
          <div class="modal-body"><p>${App.util.escapeHtml(message)}</p></div>
          <div class="modal-footer">
            <button class="btn btn-secondary cancel-btn">取消</button>
            <button class="btn btn-danger confirm-btn">确认</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('.cancel-btn').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      overlay.querySelector('.confirm-btn').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
  },

  // Show modal with custom content, returns { close() }
  showModal(contentHtml, opts) {
    opts = opts || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const sizeClass = opts.wide ? 'modal-wide' : (opts.small ? 'modal-sm' : '');
    overlay.innerHTML = `<div class="modal ${sizeClass}">${contentHtml}</div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    return { overlay, close };
  }
};

// ---- Init ----
App.init = function () {
  window.addEventListener('hashchange', () => {
    App.router.navigate(location.hash);
  });

  // Check server health
  App.api.get('/api/health')
    .then(() => {
      document.getElementById('server-status').className = 'status-dot online';
      document.getElementById('server-status-text').textContent = '服务正常';
    })
    .catch(() => {
      document.getElementById('server-status').className = 'status-dot offline';
      document.getElementById('server-status-text').textContent = '服务离线';
    });

  // Preload caches
  App.api.get('/api/models').then(d => App.state.modelsCache = d).catch(() => {});
  App.api.get('/api/keys').then(d => App.state.keysCache = d).catch(() => {});

  App.router.navigate(location.hash || '#models');
};
