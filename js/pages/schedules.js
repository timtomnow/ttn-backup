function renderSchedules() {
  const list = state.schedules.length
    ? state.schedules.map((s) => {
        const next = computeNextRun(s);
        const nextLabel = next ? fmtDateTime(next.toISOString()) : '—';
        const appNames = (s.appIds || []).map((id) => getApp(id)?.name || id).join(', ');
        return `
          <div class="card">
            <div class="card-row">
              <div style="min-width:0">
                <h3>${esc(s.name)}</h3>
                <p class="muted">${esc(s.cadence)} · ${esc(appNames)}</p>
                <p style="margin-top:6px"><span class="muted" style="font-size:12px">Next run:</span> <strong>${esc(nextLabel)}</strong></p>
              </div>
              <div class="actions" style="display:flex; flex-direction:column; gap:6px; align-items:flex-end">
                <button class="btn-primary" onclick="downloadScheduleIcs('${esc(s.id)}')">.ics</button>
                <button class="btn-secondary" onclick="openScheduleModal('${esc(s.id)}')">Edit</button>
                <button class="btn-danger" style="padding:6px 10px; font-size:13px" onclick="deleteSchedule('${esc(s.id)}')">Delete</button>
              </div>
            </div>
          </div>
        `;
      }).join('')
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
    ${list}
    <p class="muted" style="text-align:center; margin-top:16px; font-size:12px">
      Calendar fires reminder → tap link → utility runs the backup. On iOS, one share-sheet tap to save.
    </p>
  `;
}

// `existingId` is optional. When given, the modal is opened in edit mode and
// pre-filled with the existing schedule's values; save updates in place.
function openScheduleModal(existingId) {
  const existing = existingId ? state.schedules.find((s) => s.id === existingId) : null;
  const today = new Date().toISOString().slice(0, 10);

  const checkedIds = new Set(existing ? existing.appIds : APP_REGISTRY.map((a) => a.appId));
  const appCheckboxes = APP_REGISTRY.map((a) => `
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; font-size:14px; color:var(--fg); margin-bottom:6px">
      <input type="checkbox" class="sched-app" value="${esc(a.appId)}" ${checkedIds.has(a.appId) ? 'checked' : ''}>
      ${esc(a.icon)} ${esc(a.name)}
    </label>
  `).join('');

  showModal(existing ? 'Edit schedule' : 'New schedule', `
    <div class="form-row">
      <label>Name</label>
      <input type="text" id="sched-name" placeholder="e.g. Weekly Sunday backup" value="${esc(existing?.name || '')}">
    </div>
    <div class="form-row">
      <label>Cadence</label>
      <select id="sched-cadence">
        <option value="daily" ${existing?.cadence === 'daily' ? 'selected' : ''}>Daily</option>
        <option value="weekly" ${(!existing || existing.cadence === 'weekly') ? 'selected' : ''}>Weekly</option>
        <option value="monthly" ${existing?.cadence === 'monthly' ? 'selected' : ''}>Monthly</option>
      </select>
    </div>
    <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
      <div>
        <label>Start date</label>
        <input type="date" id="sched-date" value="${esc(existing?.startDate || today)}">
      </div>
      <div>
        <label>Time</label>
        <input type="time" id="sched-time" value="${esc(existing?.startTime || '09:00')}">
      </div>
    </div>
    <div class="form-row">
      <label>Apps to include</label>
      ${appCheckboxes}
    </div>
    ${existing ? `<p class="muted" style="font-size:12px">If you've already imported this schedule's .ics into a calendar, download and re-import the new .ics to update the calendar entry.</p>` : ''}
  `, async () => {
    const name = document.getElementById('sched-name').value.trim();
    if (!name) { showToast('Name required.', 'error'); return false; }
    const cadence = document.getElementById('sched-cadence').value;
    const startDate = document.getElementById('sched-date').value;
    const startTime = document.getElementById('sched-time').value;
    const appIds = [...document.querySelectorAll('.sched-app:checked')].map((el) => el.value);
    if (!appIds.length) { showToast('Select at least one app.', 'error'); return false; }

    const schedule = existing
      ? { ...existing, name, cadence, startDate, startTime, appIds, updatedAt: nowIso() }
      : { id: uuid(), name, cadence, startDate, startTime, appIds, createdAt: nowIso() };
    await dbAddSchedule(schedule);
    showToast(existing ? 'Schedule updated.' : 'Schedule saved. Tap the .ics button to add it to your calendar.', 'success');
    await navigate('schedules');
    return true;
  }, existing ? 'Save changes' : 'Save');
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
