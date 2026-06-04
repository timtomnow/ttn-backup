// UI infrastructure: navigation, modals, toasts.

const PAGES = {
  dashboard: () => renderDashboard(),
  apps:      () => renderApps(),
  history:   () => renderHistory(),
  schedules: () => renderSchedules(),
  settings:  () => renderSettings(),
  help:      () => renderHelp(),
};

async function navigate(page, params = {}) {
  state.page = page;
  state.params = params;
  await loadState();
  const main = document.getElementById('main');
  const renderer = PAGES[page] || PAGES.dashboard;
  main.innerHTML = renderer();
  // Update bottom nav active state. The Help page has no nav button of its own;
  // it lives under Settings, so keep Settings highlighted while it's open.
  const activePage = page === 'help' ? 'settings' : page;
  document.querySelectorAll('.bottom-nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === activePage);
  });
  // Scroll to top on every nav.
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}

// Modal: bodyHtml is injected; onSave returns true to close. saveLabel
// defaults to 'Save'. If onSave is null, only a Close button is shown.
function showModal(title, bodyHtml, onSave, saveLabel) {
  const modal = document.getElementById('modal');
  const overlay = document.getElementById('modal-overlay');
  const actions = onSave
    ? `<div class="modal-actions">
         <button class="btn-secondary" onclick="hideModal()">Cancel</button>
         <button class="btn-primary" id="modal-save-btn">${esc(saveLabel || 'Save')}</button>
       </div>`
    : `<div class="modal-actions">
         <button class="btn-primary" onclick="hideModal()">Close</button>
       </div>`;
  modal.innerHTML = `
    <h2 class="modal-title">${esc(title)}</h2>
    <div class="modal-body">${bodyHtml}</div>
    ${actions}
  `;
  overlay.classList.add('open');
  if (onSave) {
    document.getElementById('modal-save-btn').onclick = async () => {
      try {
        const ok = await onSave();
        if (ok) hideModal();
      } catch (err) {
        showToast(err.message || 'Save failed.', 'error');
      }
    };
  }
  overlay.onclick = (ev) => { if (ev.target === overlay) hideModal(); };
}

function showConfirm(title, message, onConfirm, confirmLabel) {
  showModal(
    title,
    `<p>${esc(message)}</p>`,
    async () => { await onConfirm(); return true; },
    confirmLabel || 'Confirm',
  );
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal').innerHTML = '';
}

function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.18s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, 3200);
}

// Convenience: top-bar "Backup all" handler.
async function runBackupAll() {
  const btn = document.getElementById('topbar-action');
  if (btn) { btn.disabled = true; btn.textContent = 'Backing up…'; }
  try {
    const appIds = APP_REGISTRY.map((a) => a.appId);
    const result = await runBackup(appIds);
    const okCount = (result.bundle.appIds || []).length;
    if (result.errors.length) {
      // Partial success — surface a modal listing what failed.
      const rows = result.errors.map((e) => `
        <li><strong>${esc(getApp(e.appId)?.name || e.appId)}:</strong> ${esc(e.error)}</li>
      `).join('');
      showModal('Backup saved with errors', `
        <p>${okCount} app(s) saved via ${esc(result.saved.method)}. ${result.errors.length} skipped:</p>
        <ul style="margin-top:8px; padding-left:20px; line-height:1.6; color:var(--fg-muted); font-size:13px">${rows}</ul>
        <p class="muted" style="font-size:12px; margin-top:12px">Likely cause: the app's TTNBackupAdapter isn't loaded, or its path in APP_REGISTRY is wrong.</p>
      `, null);
    } else {
      showToast(`Bundle saved (${result.saved.method}).`, 'success');
    }
    if (state.page === 'dashboard' || state.page === 'history') {
      await navigate(state.page, state.params);
    }
  } catch (err) {
    showToast(err.message || 'Backup failed.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Backup all'; }
  }
}

// Install prompt — captured globally so the dashboard can offer an Install
// button on supported browsers (Chrome / Edge desktop + Android).
let _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // Re-render the dashboard if it's already on screen so the button appears.
  if (state.page === 'dashboard') navigate('dashboard');
});

async function triggerInstall() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  try { await _deferredInstallPrompt.userChoice; } catch {}
  _deferredInstallPrompt = null;
  if (state.page === 'dashboard') navigate('dashboard');
}

function canPromptInstall() { return !!_deferredInstallPrompt; }

// Init.
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await navigate('dashboard');
  // Handle deep-link runs (from .ics reminders).
  await handleRunParam();
});
