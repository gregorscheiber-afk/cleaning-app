const toastEl = document.getElementById('toast');
let lastTs = null;
let allHouses = [];

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

function applyLabels() {
  document.getElementById('lbl-role').textContent            = t('roleAdmin');
  document.getElementById('lbl-clean').textContent           = t('roleClean');
  document.getElementById('lbl-stat-putzen').textContent     = t('statTodo');
  document.getElementById('lbl-stat-sauber').textContent     = t('statClean');
  document.getElementById('lbl-stat-belegt').textContent     = t('statOccupied');
  document.getElementById('lbl-panel-notif').textContent     = t('panelNotif');
  document.getElementById('lbl-panel-houses').textContent    = t('panelHouses');
  document.getElementById('lbl-panel-apts').textContent      = t('panelApts');
  document.getElementById('lbl-panel-add-house').textContent = t('panelAddHouse');
  document.getElementById('lbl-panel-add-apt').textContent   = t('panelAddApt');
  document.getElementById('th-name').textContent             = t('thName');
  document.getElementById('th-name-h').textContent           = t('thName');
  document.getElementById('th-house').textContent            = t('thHouse');
  document.getElementById('th-status').textContent           = t('thStatus');
  document.getElementById('th-checkout').textContent         = t('thCheckout');
  document.getElementById('house-name').placeholder          = t('houseName');
  document.getElementById('house-address').placeholder       = t('houseAddress');
  document.getElementById('apt-name').placeholder            = t('aptNamePlaceholder');
  document.getElementById('apt-ical').placeholder            = t('icalPlaceholder');
  document.getElementById('btn-add-house').textContent       = t('btnAdd');
  document.getElementById('btn-add-apt').textContent         = t('btnAdd');
  document.documentElement.lang = localStorage.getItem('ma_lang') || 'de';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function fmt(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(document.documentElement.lang, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function fmtAge(iso) {
  if (!iso) return '';
  const diff = Math.round((Date.now() - new Date(iso)) / 60000);
  return diff < 1 ? t('justNow') : diff < 60 ? t('minutesAgo', diff) : fmt(iso);
}

function statusLabel(s) {
  return { belegt: t('statusBelegt'), muss_geputzt_werden: t('statusPutzen'), sauber: t('statusSauber') }[s] || s;
}

// ── Notizen-Panel HTML ────────────────────────────────────
function renderNotesPanel(apt) {
  const notes = (apt.notes || []).map(n => `
    <div class="note-row" data-note-id="${n.id}">
      <span class="note-row-text">${esc(n.message)}</span>
      <button class="note-del-btn" data-del-note="${n.id}" title="Löschen">✕</button>
    </div>`).join('');

  return `
    <div class="notes-panel" id="notes-panel-${apt.id}">
      <div class="notes-panel-title">${t('notesTitle')}</div>
      <div class="note-list" id="note-list-${apt.id}">
        ${notes || `<div style="font-size:.8rem;color:var(--ink-muted)">${t('noteEmpty')}</div>`}
      </div>
      <div class="note-add-row">
        <input class="note-input" id="note-input-${apt.id}" type="text"
               placeholder="${t('notePlaceholder')}" maxlength="120"/>
        <button class="note-add-btn" data-apt-id="${apt.id}">${t('noteAdd')}</button>
      </div>
    </div>`;
}

function attachNoteHandlers(apt) {
  // Hinzufügen
  const addBtn = document.querySelector(`[data-apt-id="${apt.id}"].note-add-btn`);
  const input  = document.getElementById(`note-input-${apt.id}`);
  if (!addBtn || !input) return;

  const doAdd = async () => {
    const msg = input.value.trim();
    if (!msg) return;
    addBtn.textContent = '…';
    addBtn.disabled = true;
    try {
      const res = await fetch(`/api/apartments/${apt.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error();
      input.value = '';
      showToast(t('toastAdded'));
      loadApartments(); // neu rendern
    } catch {
      showToast(t('toastError'));
    } finally {
      addBtn.textContent = t('noteAdd');
      addBtn.disabled = false;
    }
  };

  addBtn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

  // Löschen
  document.querySelectorAll(`#notes-panel-${apt.id} [data-del-note]`).forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/notes/${btn.dataset.delNote}`, { method: 'DELETE' });
      showToast(t('toastDeleted'));
      loadApartments();
    });
  });
}

// ── Häuser ───────────────────────────────────────────────
async function loadHouses() {
  const res = await fetch('/api/houses');
  allHouses = await res.json();

  const tbody = document.getElementById('houses-tbody');
  tbody.innerHTML = allHouses.map(h => `
    <tr>
      <td><div class="apt-name-cell">${esc(h.name)}</div></td>
      <td style="color:var(--ink-soft);font-size:.82rem">${esc(h.address || '–')}</td>
      <td style="font-size:.82rem">${h.total || 0}</td>
      <td><button class="btn-sync" data-del-house="${h.id}">${t('btnDelete')}</button></td>
    </tr>`).join('')
    || `<tr><td colspan="4" style="color:var(--ink-muted);padding:1.1rem">${t('noHousesAdmin')}</td></tr>`;

  tbody.querySelectorAll('[data-del-house]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/houses/${btn.dataset.delHouse}`, { method: 'DELETE' });
      showToast(t('toastDeleted'));
      loadHouses(); loadApartments();
    });
  });

  const houseOpts = `<option value="">${t('houseSelect')}</option>` +
    allHouses.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  document.getElementById('apt-house').innerHTML = houseOpts;

  const filterOpts = `<option value="">${t('allHouses')}</option>` +
    allHouses.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  document.getElementById('filter-house').innerHTML = filterOpts;
}

// ── Apartments ───────────────────────────────────────────
async function loadApartments() {
  const houseId = document.getElementById('filter-house').value;
  const url = '/api/apartments' + (houseId ? `?house_id=${houseId}` : '');
  const apts = await (await fetch(url)).json();

  // Stats immer über alle
  const all = await (await fetch('/api/apartments')).json();
  const c = { muss_geputzt_werden: 0, sauber: 0, belegt: 0 };
  all.forEach(a => { if (c[a.status] !== undefined) c[a.status]++; });
  document.getElementById('stat-putzen').textContent = c.muss_geputzt_werden;
  document.getElementById('stat-sauber').textContent  = c.sauber;
  document.getElementById('stat-belegt').textContent  = c.belegt;

  const houseMap = Object.fromEntries(allHouses.map(h => [h.id, h.name]));
  const tbody = document.getElementById('apt-tbody');

  if (!apts.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--ink-muted);padding:1.1rem">${t('noApts')}</td></tr>`;
    return;
  }

  tbody.innerHTML = apts.map(apt => `
    <tr>
      <td colspan="5" style="padding:0">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:.75rem 1.1rem;width:30%">
              <div class="apt-name-cell">${esc(apt.name)}</div>
              ${apt.last_sync_error ? `<div class="sync-error">⚠ ${esc(apt.last_sync_error)}</div>` : ''}
            </td>
            <td style="padding:.75rem .5rem;width:20%;font-size:.82rem;color:var(--ink-soft)">${esc(houseMap[apt.house_id] || '–')}</td>
            <td style="padding:.75rem .5rem;width:20%"><span class="badge ${apt.status}">${statusLabel(apt.status)}</span></td>
            <td style="padding:.75rem .5rem;width:18%;font-size:.82rem">${fmt(apt.last_checkout)}</td>
            <td style="padding:.75rem 1.1rem .75rem .5rem;white-space:nowrap">
              <button class="btn-sync" data-sync="${apt.id}">${t('btnSync')}</button>
              <button class="btn-sync" data-del="${apt.id}" style="color:var(--putzen);margin-left:4px">${t('btnDelete')}</button>
            </td>
          </tr>
          <tr>
            <td colspan="5" style="padding:0">${renderNotesPanel(apt)}</td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  // Event-Handler
  tbody.querySelectorAll('[data-sync]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = '…';
      await fetch(`/api/apartments/${btn.dataset.sync}/sync`, { method: 'POST' });
      loadApartments();
    });
  });

  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/apartments/${btn.dataset.del}`, { method: 'DELETE' });
      showToast(t('toastDeleted'));
      loadApartments(); loadHouses();
    });
  });

  apts.forEach(apt => attachNoteHandlers(apt));
}

// ── Benachrichtigungen ───────────────────────────────────
async function loadNotifications() {
  const url = lastTs ? `/api/notifications?since=${encodeURIComponent(lastTs)}` : '/api/notifications';
  const items = await (await fetch(url)).json();
  if (items.length > 0) {
    if (lastTs) { showToast(items[0].message); loadApartments(); loadHouses(); }
    lastTs = items[0].created_at;
  }
  if (!lastTs) lastTs = new Date().toISOString();
  const all = await (await fetch('/api/notifications')).json();
  document.getElementById('notifications').innerHTML = all.slice(0, 12).map(n => `
    <div class="notif-item">
      <div class="notif-dot"></div>
      <div class="notif-text">${esc(n.message)}</div>
      <div class="notif-time">${fmtAge(n.created_at)}</div>
    </div>`).join('')
    || `<div style="padding:1.1rem;color:var(--ink-muted);font-size:.85rem">${t('noNotifs')}</div>`;
}

// ── Formulare ────────────────────────────────────────────
document.getElementById('add-house-form').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('house-form-error').textContent = '';
  const name    = document.getElementById('house-name').value.trim();
  const address = document.getElementById('house-address').value.trim();
  try {
    const res = await fetch('/api/houses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address: address || null }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    e.target.reset(); showToast(t('toastAdded')); loadHouses();
  } catch (err) { document.getElementById('house-form-error').textContent = err.message; }
});

document.getElementById('add-apt-form').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('apt-form-error').textContent = '';
  const name     = document.getElementById('apt-name').value.trim();
  const ical_url = document.getElementById('apt-ical').value.trim();
  const house_id = document.getElementById('apt-house').value;
  try {
    const res = await fetch('/api/apartments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ical_url: ical_url || null, house_id: house_id || null }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    e.target.reset(); showToast(t('toastAdded')); loadApartments(); loadHouses();
  } catch (err) { document.getElementById('apt-form-error').textContent = err.message; }
});

document.getElementById('filter-house').addEventListener('change', loadApartments);

document.getElementById('btn-lang').addEventListener('click', () => {
  localStorage.removeItem('ma_lang'); location.reload();
});

// ── Start ────────────────────────────────────────────────
initLangScreen(async () => {
  applyLabels();
  await loadHouses();
  loadApartments();
  loadNotifications();
  setInterval(loadApartments,    30000);
  setInterval(loadNotifications,  8000);
});
