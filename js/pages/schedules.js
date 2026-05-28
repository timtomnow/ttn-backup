function renderSchedules() {
  const list = state.schedules.length
    ? state.schedules.map((s) => `
        <div class="list-item">
          <div class="meta">
            <div class="meta-title">${esc(s.name)}</div>
            <div class="meta-sub">${esc(s.cadence)} · starts ${esc(s.startDate)} ${esc(s.startTime)} · ${(s.appIds || []).length} app(s)</div>
          </div>
          <div class="actions">
            <button onclick="downloadScheduleIcs('${esc(s.id)}')">.ics</button>
            <button class="danger-action" onclick="deleteSchedule('${esc(s.id)}')">Delete</button>
          </div>
        </div>
      `).join('')
    : `<div class="empty">
         <div class="empty-icon">⏰</div>
         <h3>No schedules</h3>
         <p>Create one and import its .ics into your calendar.</p>
       </div>`;

  return `
    <div class="page-header">
      <div><h1>Schedules</h1><p>Reminder-based scheduled backups.</p></div>
      <button class="btn-primary" onclick="openScheduleModal()">+ New</button>
    </div>
    <div class="list">${list}</div>
    <p class="muted" style="text-align:center; margin-top:16px; font-size:12px">
      Calendar fires reminder → tap link → utility runs the backup. On iOS, one share-sheet tap to save.
    </p>
  `;
}

function openScheduleModal() {
  const appCheckboxes = APP_REGISTRY.map((a) => `
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; font-size:14px; color:var(--fg); margin-bottom:6px">
      <input type="checkbox" class="sched-app" value="${esc(a.appId)}" checked>
      ${esc(a.icon)} ${esc(a.name)}
    </label>
  `).join('');

  const today = new Date().toISOString().slice(0, 10);

  showModal('New schedule', `
    <div class="form-row">
      <label>Name</label>
      <input type="text" id="sched-name" placeholder="e.g. Weekly Sunday backup">
    </div>
    <div class="form-row">
      <label>Cadence</label>
      <select id="sched-cadence">
        <option value="daily">Daily</option>
        <option value="weekly" selected>Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
    </div>
    <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
      <div>
        <label>Start date</label>
        <input type="date" id="sched-date" value="${today}">
      </div>
      <div>
        <label>Time</label>
        <input type="time" id="sched-time" value="09:00">
      </div>
    </div>
    <div class="form-row">
      <label>Apps to include</label>
      ${appCheckboxes}
    </div>
  `, async () => {
    const name = document.getElementById('sched-name').value.trim();
    if (!name) { showToast('Name required.', 'error'); return false; }
    const cadence = document.getElementById('sched-cadence').value;
    const startDate = document.getElementById('sched-date').value;
    const startTime = document.getElementById('sched-time').value;
    const appIds = [...document.querySelectorAll('.sched-app:checked')].map((el) => el.value);
    if (!appIds.length) { showToast('Select at least one app.', 'error'); return false; }

    const schedule = { id: uuid(), name, cadence, startDate, startTime, appIds, createdAt: nowIso() };
    await dbAddSchedule(schedule);
    showToast('Schedule saved. Tap the .ics button to add it to your calendar.', 'success');
    await navigate('schedules');
    return true;
  }, 'Save');
}

async function downloadScheduleIcs(id) {
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return;
  downloadIcs(s);
}

async function deleteSchedule(id) {
  showConfirm('Delete schedule?', 'Existing calendar entries will continue to fire until you remove them from your calendar.', async () => {
    await dbDeleteSchedule(id);
    showToast('Schedule deleted.', 'success');
    await navigate('schedules');
  }, 'Delete');
}
