// Schedule + .ics generation. Stub for slice 1; full implementation lands in
// slice 3.
//
// `.ics` files we generate carry a URL field pointing at:
//   https://timtomnow.github.io/ttn-backup/?run=<scheduleId>
// On wake-up, the calendar shows a notification; tapping the URL deep-links
// to the utility which auto-runs that schedule's backup.

// Convert a schedule + cadence into a minimal valid VCALENDAR string.
// `cadence` is one of: 'daily' | 'weekly' | 'monthly'.
function buildIcs({ id, name, appIds, startDate, startTime, cadence }) {
  const uid = `ttn-backup-${id}@timtomnow.github.io`;
  const dt = startDate.replace(/-/g, '') + 'T' + startTime.replace(/:/g, '') + '00';
  const rrule = {
    daily: 'FREQ=DAILY',
    weekly: 'FREQ=WEEKLY',
    monthly: 'FREQ=MONTHLY',
  }[cadence] || 'FREQ=WEEKLY';
  const url = `https://timtomnow.github.io/ttn-backup/?run=${encodeURIComponent(id)}`;
  const summary = `ttn-backup: ${name}`;
  const description = `Run backup for: ${appIds.join(', ')}\\n\\nOpen: ${url}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ttn-backup//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${dt}`,
    `RRULE:${rrule}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary}`,
    'TRIGGER:-PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function downloadIcs(schedule) {
  const ics = buildIcs(schedule);
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ttn-backup-${schedule.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Check `?run=<id>` and auto-trigger if matched. Called from init().
async function handleRunParam() {
  const params = new URLSearchParams(location.search);
  const runId = params.get('run');
  if (!runId) return;
  const schedule = state.schedules.find((s) => s.id === runId);
  if (!schedule) {
    showToast('Schedule not found.', 'error');
    return;
  }
  showToast(`Running scheduled backup: ${schedule.name}`);
  try {
    const result = await runBackup(schedule.appIds);
    showToast(`Backup saved (${result.saved.method}).`, 'success');
  } catch (err) {
    showToast(`Backup failed: ${err.message}`, 'error');
  } finally {
    // Strip the query param so a refresh doesn't re-run.
    history.replaceState({}, '', location.pathname);
  }
}
