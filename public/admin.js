const toastEl = document.getElementById('toast');
let lastTs = null;
let allHouses = [];
let editingAptId = null;
let importRows = [];
let structureRows = [];

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
  document.getElementById('lbl-panel-import').textContent    = t('panelImport');
  document.getElementById('lbl-import-hint').textContent     = t('importHintNew') || t('importHint');
  document.getElementById('lbl-panel-import-structure').textContent = t('panelImportStructure');
  document.getElementById('lbl-import-structure-hint').textContent  = t('importStructureHint');
  document.getElementById('lbl-structure-btn').textContent          = t('importBtn');
  document.getElementById('btn-download-template').textContent      = t('importStructureBtn');
  document.getElementById('btn-structure-start').textContent        = t('importStructureStart');
  document.getElementById('lbl-import-btn').textContent      = t('importBtn');
  document.getElementById('btn-import-start').textContent    = t('importStart');
  document.getElementById('lbl-panel-add-house').textContent = t('panelAddHouse');
  document.getElementById('lbl-panel-add-apt').textContent   = t('panelAddApt');
  document.getElementById('th-name-h').textContent           = t('thName');
  document.getElementById('house-name').placeholder          = t('houseName');
  document.getElementById('apt-name').placeholder            = t('aptNamePlaceholder');
  document.getElementById('apt-pms').placeholder             = t('pmsCodePlaceholder');
  document.getElementById('btn-add-house').textContent       = t('btnAdd');
  document.getElementById('btn-add-apt').textContent         = t('btnAdd');
  document.getElementById('modal-lbl-name').textContent      = t('thName');
  document.getElementById('modal-lbl-pms').textContent       = t('pmsCode');
  document.getElementById('modal-lbl-house').textContent     = t('thHouse');
  document.getElementById('modal-cancel').textContent        = t('btnCancel');
  document.getElementById('modal-lbl-time').textContent      = t('checkoutTime');
  document.getElementById('modal-save').textContent          = t('btnSave');
  document.documentElement.lang = localStorage.getItem('ma_lang') || 'de';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString(document.documentElement.lang, {
    day: '2-digit', month: '2-digit', year: '2-digit'
  });
}

function fmtDateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(document.documentElement.lang, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function fmtAge(iso) {
  if (!iso) return '';
  const diff = Math.round((Date.now() - new Date(iso)) / 60000);
  return diff < 1 ? t('justNow') : diff < 60 ? t('minutesAgo', diff) : fmtDateTime(iso);
}

function nightsBetween(s, e) { return Math.round((new Date(e) - new Date(s)) / 86400000); }

function statusLabel(s) {
  return { belegt: t('statusBelegt'), muss_geputzt_werden: t('statusPutzen'), sauber: t('statusSauber') }[s] || s;
}

// ── Notizen-Panel ─────────────────────────────────────────
function renderNotesPanel(apt) {
  const notes = (apt.notes || []).map(n => `
    <div class="note-row">
      <span class="note-row-text">${esc(n.message)}</span>
      <button class="note-del-btn" data-del-note="${n.id}">✕</button>
    </div>`).join('');
  return `
    <div class="notes-panel" id="notes-panel-${apt.id}">
      <div class="notes-panel-title">${t('notesTitle')}</div>
      <div class="note-list">${notes || `<div style="font-size:.8rem;color:var(--ink-muted)">${t('noteEmpty')}</div>`}</div>
      <div class="note-add-row">
        <input class="note-input" id="note-input-${apt.id}" type="text" placeholder="${t('notePlaceholder')}" maxlength="120"/>
        <button class="note-add-btn" data-apt-id="${apt.id}">${t('noteAdd')}</button>
      </div>
    </div>`;
}

// ── Buchungen-Panel ───────────────────────────────────────
function parsePersons(persons) {
  if (!persons) return { adults: 0, children: 0, babies: 0 };
  const a = (persons.match(/(\d+)\s*Erw/i)  || [0,0])[1];
  const k = (persons.match(/(\d+)\s*Kind/i) || [0,0])[1];
  const b = (persons.match(/(\d+)\s*Baby/i) || [0,0])[1];
  return { adults: Number(a), children: Number(k), babies: Number(b) };
}

function renderAdminBookings(bookings) {
  if (!bookings?.length) return `<div style="font-size:.8rem;color:var(--ink-muted)">${t('noUpcoming')}</div>`;
  return bookings.map(b => {
    const p = parsePersons(b.persons);
    const isLM = b.highlighted_until && new Date() < new Date(b.highlighted_until);
    const isManual = b.source === 'manual';
    return `
    <div class="admin-booking-row${isLM ? ' last-minute' : ''}${isManual ? ' manual' : ''}" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;flex-wrap:wrap">
        ${isLM ? `<span class="last-minute-badge">${t('lastMinute')}</span>` : ''}
        ${isManual ? `<span class="manual-badge">${t('manualBadge')}</span>` : ''}
        ${isManual ? `<button class="btn-del-booking" data-del-booking="${b.id}">✕</button>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <div class="admin-booking-in">
          <span class="admin-booking-label">${t('checkin')}</span>
          <span class="admin-booking-date">${fmtDate(b.start)}</span>
        </div>
        <span class="admin-booking-arrow">→</span>
        <div class="admin-booking-out">
          <span class="admin-booking-label">${t('checkout2')}</span>
          <span class="admin-booking-date">${fmtDate(b.end)}</span>
        </div>
        ${b.guest_name ? `<span style="font-size:.75rem;color:var(--ink-soft)">👤 ${esc(b.guest_name)}</span>` : ''}
        <span class="admin-booking-nights">${t('night', nightsBetween(b.start, b.end))}</span>
      </div>
      <div class="persons-editor">
        <span class="persons-label">👥 ${t('personsEdit')}:</span>
        <div class="persons-field">
          <span class="persons-label">${t('adults')}</span>
          <input class="persons-input" type="number" min="0" max="20" value="${p.adults}" data-booking="${b.id}" data-field="adults"/>
        </div>
        <div class="persons-field">
          <span class="persons-label">${t('children')}</span>
          <input class="persons-input" type="number" min="0" max="20" value="${p.children}" data-booking="${b.id}" data-field="children"/>
        </div>
        <div class="persons-field">
          <span class="persons-label">${t('babies')}</span>
          <input class="persons-input" type="number" min="0" max="20" value="${p.babies}" data-booking="${b.id}" data-field="babies"/>
        </div>
        <button class="persons-save-btn" data-save-booking="${b.id}">✓</button>
      </div>
    </div>`;
  }).join('');
}

function attachNoteHandlers(apt) {
  const addBtn = document.querySelector(`[data-apt-id="${apt.id}"].note-add-btn`);
  const input  = document.getElementById(`note-input-${apt.id}`);
  if (!addBtn || !input) return;
  const doAdd = async () => {
    const msg = input.value.trim(); if (!msg) return;
    addBtn.disabled = true; addBtn.textContent = '…';
    try {
      await fetch(`/api/apartments/${apt.id}/notes`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ message: msg }),
      });
      input.value = ''; showToast(t('toastAdded')); loadApartments();
    } catch { showToast(t('toastError')); }
    finally { addBtn.textContent = t('noteAdd'); addBtn.disabled = false; }
  };
  addBtn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  document.querySelectorAll(`#notes-panel-${apt.id} [data-del-note]`).forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/notes/${btn.dataset.delNote}`, { method: 'DELETE' });
      showToast(t('toastDeleted')); loadApartments();
    });
  });
}

// ── Edit Modal ────────────────────────────────────────────
function openEditModal(apt) {
  editingAptId = apt.id;
  document.getElementById('modal-title').textContent    = t('editTitle');
  document.getElementById('modal-apt-name').value       = apt.name || '';
  document.getElementById('modal-apt-pms').value        = apt.pms_code || '';
  document.getElementById('modal-apt-pms').placeholder  = t('pmsCodePlaceholder');
  document.getElementById('modal-apt-name').placeholder = t('aptNamePlaceholder');
  document.getElementById('modal-apt-time').value       = apt.checkout_time || '09:30';
  document.getElementById('modal-error').textContent    = '';
  const sel = document.getElementById('modal-apt-house');
  sel.innerHTML = `<option value="">${t('houseSelect')}</option>` +
    allHouses.map(h => `<option value="${h.id}" ${h.id == apt.house_id ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
  const modal = document.getElementById('edit-modal');
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.remove('closing'));
}

function closeEditModal() {
  const modal = document.getElementById('edit-modal');
  modal.classList.add('closing');
  setTimeout(() => { modal.style.display = 'none'; modal.classList.remove('closing'); }, 200);
  editingAptId = null;
}

document.getElementById('modal-cancel').addEventListener('click', closeEditModal);
document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-modal')) closeEditModal();
});

document.getElementById('modal-save').addEventListener('click', async () => {
  if (!editingAptId) return;
  const name          = document.getElementById('modal-apt-name').value.trim();
  const pms_code      = document.getElementById('modal-apt-pms').value.trim();
  const checkout_time = document.getElementById('modal-apt-time').value || '09:30';
  const house_id      = document.getElementById('modal-apt-house').value;
  document.getElementById('modal-error').textContent = '';
  try {
    const res = await fetch(`/api/apartments/${editingAptId}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, pms_code: pms_code||null, checkout_time, house_id: house_id||null }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    showToast(t('toastSaved'));
    closeEditModal();
    loadApartments(); loadManageApts(); loadHouses();
  } catch(err) { document.getElementById('modal-error').textContent = err.message; }
});

// ── Excel Import ──────────────────────────────────────────
const fileInput = document.getElementById('excel-file-input');
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  document.getElementById('import-filename').textContent = file.name;
  document.getElementById('import-result').innerHTML = '';
  importRows = [];
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      let headerRow = -1;
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (row && String(row[1] || '').trim().toLowerCase() === 'zimmer') { headerRow = i; break; }
      }
      if (headerRow === -1) {
        document.getElementById('import-preview').innerHTML = `<div style="color:var(--putzen);font-size:.82rem">${t('importNoRows')}</div>`;
        return;
      }
      importRows = [];
      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[1]) continue;
        importRows.push({
          zimmer:   String(row[1] || '').trim(),
          gast:     String(row[2] || '').trim(),
          personen: String(row[3] || '').trim(),
          anreise:  String(row[4] || '').trim(),
          abreise:  String(row[5] || '').trim(),
        });
      }
      if (!importRows.length) {
        document.getElementById('import-preview').innerHTML = `<div style="color:var(--putzen);font-size:.82rem">${t('importNoRows')}</div>`;
        document.getElementById('btn-import-start').style.display = 'none';
        return;
      }
      const cols = t('importCols');
      const previewRows = importRows.slice(0, 5).map(r => `
        <tr><td>${esc(r.zimmer)}</td><td>${esc(r.gast)}</td>
        <td style="color:var(--accent);font-weight:600">${esc(r.personen)}</td>
        <td>${esc(r.anreise)}</td><td>${esc(r.abreise)}</td></tr>`).join('');
      document.getElementById('import-preview').innerHTML = `
        <div class="section-label" style="margin-bottom:.5rem">${t('importPreview')} (${importRows.length})</div>
        <div class="import-preview"><table>
          <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${previewRows}</tbody>
        </table></div>`;
      document.getElementById('btn-import-start').style.display = 'block';
    } catch(err) {
      document.getElementById('import-preview').innerHTML = `<div style="color:var(--putzen);font-size:.82rem">Fehler: ${err.message}</div>`;
    }
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('btn-import-start').addEventListener('click', async () => {
  if (!importRows.length) return;
  const btn = document.getElementById('btn-import-start');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch('/api/import-bookings', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ rows: importRows }),
    });
    const data = await res.json();
    const resultEl = document.getElementById('import-result');
    const msg = t('importResult', data.created, data.updated, data.skipped);
    resultEl.className = `import-result ${data.skipped > 0 ? 'partial' : 'success'}`;
    resultEl.textContent = msg;
    if (data.created + data.updated > 0) { showToast(`${data.created + data.updated} ${t('importPersons')} importiert ✓`); loadApartments(); loadHouses(); }
  } catch(err) {
    document.getElementById('import-result').innerHTML = `<div style="color:var(--putzen);font-size:.82rem">${err.message}</div>`;
  } finally { btn.disabled = false; btn.textContent = t('importStart'); }
});

// ── Struktur-Import ──────────────────────────────────────
document.getElementById('btn-download-template').addEventListener('click', () => {
  const cols = t('importStructureCols');
  const ws = XLSX.utils.aoa_to_sheet([
    cols,
    ['Jordans Lodge', 'Alpenrose', '', 'LODG1'],
    ['Jordans Lodge', 'Enzian',    '', 'LODG2'],
    ['MYALPS Mühlhof','Studio',   '', 'Studi'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Struktur');
  XLSX.writeFile(wb, 'myalps_struktur_vorlage.xlsx');
});

document.getElementById('structure-file-input').addEventListener('change', () => {
  const file = document.getElementById('structure-file-input').files[0];
  if (!file) return;
  document.getElementById('structure-filename').textContent = file.name;
  document.getElementById('structure-result').innerHTML = '';
  structureRows = [];
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(e.target.result, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      let headerRow = 0;
      for (let i = 0; i < data.length; i++) {
        const first = String(data[i]?.[0] || '').toLowerCase();
        if (first === 'haus' || first === 'house') { headerRow = i; break; }
      }
      structureRows = [];
      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0]) continue;
        structureRows.push({ haus: String(row[0]||'').trim(), apartment: String(row[1]||'').trim(), ical_url: String(row[2]||'').trim(), pms_code: String(row[3]||'').trim() });
      }
      if (!structureRows.length) {
        document.getElementById('structure-preview').innerHTML = `<div style="color:var(--putzen);font-size:.82rem">${t('importNoRows')}</div>`;
        return;
      }
      const cols = t('importStructureCols');
      const previewRows = structureRows.slice(0,6).map(r => `
        <tr><td>${esc(r.haus)}</td><td>${esc(r.apartment)}</td>
        <td style="color:var(--ink-soft);font-size:.75rem">${r.ical_url?'✓':'–'}</td>
        <td style="color:var(--accent)">${esc(r.pms_code)||'–'}</td></tr>`).join('');
      document.getElementById('structure-preview').innerHTML = `
        <div class="section-label" style="margin-bottom:.5rem">${t('importPreview')} (${structureRows.length})</div>
        <div class="import-preview"><table>
          <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${previewRows}</tbody>
        </table></div>`;
      document.getElementById('btn-structure-start').style.display = 'block';
    } catch(err) {
      document.getElementById('structure-preview').innerHTML = `<div style="color:var(--putzen);font-size:.82rem">Fehler: ${err.message}</div>`;
    }
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('btn-structure-start').addEventListener('click', async () => {
  if (!structureRows.length) return;
  const btn = document.getElementById('btn-structure-start');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch('/api/import-structure', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ rows: structureRows }),
    });
    const data = await res.json();
    const resultEl = document.getElementById('structure-result');
    resultEl.className = 'import-result success';
    resultEl.textContent = t('importStructureResult', data.housesCreated, data.housesExisting, data.aptsCreated, data.aptsExisting);
    showToast(`${data.housesCreated + data.aptsCreated} neue Einträge angelegt ✓`);
    loadHouses(); loadApartments();
  } catch(err) {
    document.getElementById('structure-result').textContent = err.message;
  } finally { btn.disabled = false; btn.textContent = t('importStructureStart'); }
});

// ── Apartments Verwaltung (Bearbeiten/Löschen) ───────────
async function loadManageApts() { /* Apartments-verwalten Panel entfernt */ }

// ── Verwaltung Toggle ────────────────────────────────────
function initVerwaltungToggle() {
  const btn      = document.getElementById('btn-verwaltung-toggle');
  const panels   = document.getElementById('verwaltung-panels');
  const chevron  = document.getElementById('verwaltung-chevron');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const open = panels.style.display === 'none';
    panels.style.display = open ? 'block' : 'none';
    chevron.style.transform = open ? 'rotate(180deg)' : '';
    btn.style.borderColor = open ? 'var(--accent)' : 'var(--line)';
    btn.style.color = open ? 'var(--accent)' : 'var(--ink-soft)';
  });
}

// ── Häuser ────────────────────────────────────────────────
async function loadHouses() {
  allHouses = (await (await fetch('/api/houses')).json());
  document.getElementById('houses-tbody').innerHTML = allHouses.map(h => `
    <tr>
      <td><div style="font-size:1rem;font-weight:700;color:var(--ink)">${esc(h.name)}</div></td>
      <td style="font-size:.85rem;color:var(--ink-soft)">${h.total||0}</td>
      <td><button class="btn-sync" data-del-house="${h.id}">${t('btnDelete')}</button></td>
    </tr>`).join('')
    || `<tr><td colspan="3" style="color:var(--ink-muted);padding:1.1rem">${t('noHousesAdmin')}</td></tr>`;

  document.querySelectorAll('[data-del-house]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/houses/${btn.dataset.delHouse}`, { method: 'DELETE' });
      showToast(t('toastDeleted')); loadHouses(); loadApartments();
    });
  });

  document.getElementById('apt-house').innerHTML =
    `<option value="">${t('houseSelect')}</option>` +
    allHouses.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');

}

// ── Apartments – Kachel-Ansicht ──────────────────────────
let selectedHouseAdmin = null;
let allAptsCache = [];

async function loadApartments() {
  allAptsCache = await (await fetch('/api/apartments')).json();

  // Stats berechnen
  const c = { muss_geputzt_werden:0, sauber:0, belegt:0 };
  allAptsCache.forEach(a => { if(c[a.status]!==undefined) c[a.status]++; });
  document.getElementById('stat-putzen').textContent = c.muss_geputzt_werden;
  document.getElementById('stat-sauber').textContent = c.sauber;
  document.getElementById('stat-belegt').textContent = c.belegt;

  if (selectedHouseAdmin) {
    renderHouseApts(selectedHouseAdmin);
  } else {
    renderHouseTiles();
  }
}

function renderHouseTiles() {
  const container = document.getElementById('apt-houses-container');

  // Häuser gruppieren
  const houseMap = new Map();
  allHouses.forEach(h => houseMap.set(h.id, { ...h, apts: [] }));
  allAptsCache.forEach(apt => {
    const hid = apt.house_id || 0;
    if (!houseMap.has(hid)) houseMap.set(hid, { id: hid, name: '–', apts: [] });
    houseMap.get(hid).apts.push(apt);
  });
  // Leere Häuser entfernen
  for (const [hid, h] of houseMap) { if (!h.apts.length) houseMap.delete(hid); }

  let html = '<div class="house-grid">';
  houseMap.forEach((house) => {
    const putzen  = house.apts.filter(a => a.status === 'muss_geputzt_werden').length;
    const sauber  = house.apts.filter(a => a.status === 'sauber').length;
    const belegt  = house.apts.filter(a => a.status === 'belegt').length;
    const stats = [
      putzen ? `<span class="house-tile-stat putzen">⚠ ${putzen} ${t('statusPutzen')}</span>` : '',
      sauber ? `<span class="house-tile-stat sauber">✓ ${sauber} ${t('statusSauber')}</span>` : '',
      belegt ? `<span class="house-tile-stat belegt">● ${belegt} ${t('statusBelegt')}</span>` : '',
    ].filter(Boolean).join('');

    html += `
      <div class="house-tile" data-house-tile="${house.id}">
        <div class="house-tile-name">${esc(house.name)}</div>
        <div class="house-tile-count">${house.apts.length} Apartment${house.apts.length !== 1 ? 's' : ''}</div>
        <div class="house-tile-stats">${stats}</div>
        <span class="house-tile-arrow">→</span>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('[data-house-tile]').forEach(tile => {
    tile.addEventListener('click', () => {
      selectedHouseAdmin = parseInt(tile.dataset.houseTile);
      renderHouseApts(selectedHouseAdmin);
    });
  });
}

function renderHouseApts(houseId) {
  const container = document.getElementById('apt-houses-container');
  const house = allHouses.find(h => h.id === houseId) || { name: '–' };
  const apts  = allAptsCache.filter(a => a.house_id === houseId);

  let html = `
    <div class="apt-back-bar">
      <button class="btn-back-house" id="btn-back-to-houses">← ${t('panelHouses')}</button>
      <span class="apt-back-house-name">${esc(house.name)}</span>
    </div>`;

  if (!apts.length) {
    html += `<div style="padding:1.25rem;color:var(--ink-muted);font-size:.85rem">${t('noApts')}</div>`;
  } else {
    html += `<table class="apt-table" style="margin:0"><tbody>`;
    apts.forEach(apt => { html += renderAptRow(apt); });
    html += `</tbody></table>`;
  }

  container.innerHTML = html;

  document.getElementById('btn-back-to-houses').addEventListener('click', () => {
    selectedHouseAdmin = null;
    renderHouseTiles();
  });

  apts.forEach(apt => attachNoteHandlers(apt));

  container.querySelectorAll('[data-del-booking]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/bookings/${btn.dataset.delBooking}`, { method: 'DELETE' });
      showToast(t('toastDeleted')); loadApartments();
    });
  });

  container.querySelectorAll('[data-save-booking]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveBooking;
      const adults   = container.querySelector(`[data-booking="${id}"][data-field="adults"]`)?.value   || 0;
      const children = container.querySelector(`[data-booking="${id}"][data-field="children"]`)?.value || 0;
      const babies   = container.querySelector(`[data-booking="${id}"][data-field="babies"]`)?.value   || 0;
      btn.disabled = true; btn.textContent = '…';
      try {
        await fetch(`/api/bookings/${id}/persons`, {
          method: 'PUT', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ adults: Number(adults), children: Number(children), babies: Number(babies) }),
        });
        showToast(t('toastSaved')); loadApartments();
      } catch { showToast(t('toastError')); btn.disabled = false; btn.textContent = '✓'; }
    });
  });

  container.querySelectorAll('[data-apt-time]').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.aptTime;
      input.style.borderColor = 'var(--accent)';
      try {
        await fetch(`/api/apartments/${id}`, {
          method: 'PUT', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ checkout_time: input.value || '09:30' }),
        });
        showToast('⏰ Reinigungszeit gespeichert');
        setTimeout(() => input.style.borderColor = '', 1500);
        loadManageApts();
      } catch { input.style.borderColor = 'var(--putzen)'; }
    });
  });
}

function renderAptRow(apt) {
  return `
    <tr>
      <td colspan="5" style="padding:0">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:0 1.1rem .75rem;width:28%;border-top:3px solid var(--accent)">
              <div style="text-align:center;padding:.55rem 0 .3rem">
                <div style="font-size:1.15rem;font-weight:700;color:var(--accent);letter-spacing:-.01em">${esc(apt.name)}</div>
              </div>
              <div style="display:flex;align-items:center;justify-content:center;gap:.4rem;margin-top:.25rem">
                <span style="font-size:.68rem;color:var(--ink-muted)">⏰ ${t('cleanFrom')}:</span>
                <input type="time" step="300" class="apt-time-inline" data-apt-time="${apt.id}"
                  value="${esc(apt.checkout_time||'09:30')}"
                  style="background:var(--surface-3);border:1px solid var(--line);border-radius:6px;color:var(--ink);padding:.2rem .4rem;font-size:.8rem;font-weight:600;outline:none;cursor:pointer;width:80px"/>
              </div>
            </td>
            <td style="padding:.75rem .5rem;width:18%"><span class="badge ${apt.status}">${statusLabel(apt.status)}</span></td>
            <td style="padding:.75rem .5rem;width:18%;font-size:.82rem">${fmtDateTime(apt.last_checkout)}</td>
            <td style="padding:.75rem 1.1rem"></td>
          </tr>
          <tr><td colspan="5" style="padding:0">${renderNotesPanel(apt)}</td></tr>
          <tr>
            <td colspan="5" style="padding:0">
              <div class="admin-bookings-panel">
                <div class="admin-bookings-title">📅 ${t('upcomingBookings')}</div>
                ${renderAdminBookings(apt.upcoming_bookings)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// ── Benachrichtigungen ────────────────────────────────────
async function loadNotifications() {
  const url = lastTs ? `/api/notifications?since=${encodeURIComponent(lastTs)}` : '/api/notifications';
  const items = await (await fetch(url)).json();
  if (items.length > 0) {
    if (lastTs) { loadApartments(); loadHouses(); }
    lastTs = items[0].created_at;
  }
  if (!lastTs) lastTs = new Date().toISOString();
  const all = await (await fetch('/api/notifications')).json();
  document.getElementById('notifications').innerHTML = all.slice(0,12).map(n => `
    <div class="notif-item">
      <div class="notif-dot"></div>
      <div class="notif-text">${esc(n.message)}</div>
      <div class="notif-time">${fmtAge(n.created_at)}</div>
    </div>`).join('')
    || `<div style="padding:1.1rem;color:var(--ink-muted);font-size:.85rem">${t('noNotifs')}</div>`;
}

// ── Formulare ─────────────────────────────────────────────
document.getElementById('add-house-form').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('house-form-error').textContent = '';
  const name = document.getElementById('house-name').value.trim();
  try {
    const res = await fetch('/api/houses', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      let msg = `Fehler ${res.status}`;
      try { const d = await res.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }
    e.target.reset(); showToast(t('toastAdded')); loadHouses();
  } catch(err) { document.getElementById('house-form-error').textContent = err.message; }
});

document.getElementById('add-apt-form').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('apt-form-error').textContent = '';
  const name     = document.getElementById('apt-name').value.trim();
  const pms_code = document.getElementById('apt-pms').value.trim();
  const house_id = document.getElementById('apt-house').value;
  try {
    const res = await fetch('/api/apartments', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, pms_code: pms_code||null, house_id: house_id||null }),
    });
    if (!res.ok) {
      let msg = `Fehler ${res.status}`;
      try { const d = await res.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }
    e.target.reset(); showToast(t('toastAdded')); loadApartments(); loadManageApts(); loadHouses();
  } catch(err) { document.getElementById('apt-form-error').textContent = err.message; }
});


document.getElementById('btn-lang').addEventListener('click', () => {
  localStorage.removeItem('ma_lang'); location.reload();
});

// Plan-Dropdown
const planMenuBtn  = document.getElementById('btn-plan-menu');
const planDropdown = document.getElementById('plan-dropdown');
if (planMenuBtn) {
  planMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    planDropdown.style.display = planDropdown.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { if(planDropdown) planDropdown.style.display = 'none'; });
}

// ── Reinigungslog ────────────────────────────────────────
async function loadCleaningLog() {
  const body = document.getElementById('cleaning-log-body');
  if (!body) return;
  try {
    const { total, slots, recent } = await (await fetch('/api/cleanings/stats')).json();

    if (!total) {
      body.innerHTML = `<div style="color:var(--ink-muted);font-size:.82rem">Noch keine Reinigungen bestätigt.</div>`;
      return;
    }

    // Balkendiagramm
    const maxCount = Math.max(...slots.map(s => s.count), 1);
    const bars = slots.map(s => {
      const pct = total > 0 ? Math.round(s.count / total * 100) : 0;
      const barW = Math.round(s.count / maxCount * 100);
      return `
        <div style="display:grid;grid-template-columns:90px 1fr 38px;align-items:center;gap:.6rem;margin-bottom:.55rem">
          <div style="font-size:.72rem;color:var(--ink-soft);text-align:right">${s.label}</div>
          <div style="height:22px;background:var(--surface-3);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${barW}%;background:var(--accent);border-radius:4px;transition:width .4s ease;display:flex;align-items:center;padding:0 .4rem">
              ${s.count > 0 ? `<span style="font-size:.65rem;font-weight:700;color:#111;white-space:nowrap">${s.count}×</span>` : ''}
            </div>
          </div>
          <div style="font-size:.72rem;font-weight:700;color:var(--ink-soft)">${pct}%</div>
        </div>`;
    }).join('');

    // Letzte Reinigungen
    const recentRows = recent.slice(0,8).map(r => {
      const d = new Date(r.confirmed_at);
      const dateStr = d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' });
      const timeStr = d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' });
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--line)">
          <div>
            <span style="font-size:.82rem;font-weight:600;color:var(--ink)">${esc(r.apt_name)}</span>
            ${r.house_name ? `<span style="font-size:.72rem;color:var(--ink-muted)"> · ${esc(r.house_name)}</span>` : ''}
          </div>
          <div style="font-size:.72rem;color:var(--ink-soft);white-space:nowrap">${dateStr} ${timeStr}</div>
        </div>`;
    }).join('');

    body.innerHTML = `
      <div style="font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:.8rem">
        Zeitverteilung · ${total} Reinigungen gesamt
      </div>
      ${bars}
      <div style="font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);margin:1.1rem 0 .6rem">
        Letzte Reinigungen
      </div>
      ${recentRows}`;
  } catch(e) {
    document.getElementById('cleaning-log-body').innerHTML =
      `<div style="color:var(--putzen);font-size:.82rem">Fehler beim Laden.</div>`;
  }
}

// ── Start ─────────────────────────────────────────────────
initLangScreen(async () => {
  applyLabels();
  await loadHouses();
  loadApartments();
  loadNotifications();
  setInterval(() => {
    // Nicht neu laden wenn gerade jemand in einem Eingabefeld schreibt
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!isTyping) loadApartments();
  }, 30000);
  setInterval(loadNotifications,  8000);
  loadCleaningLog();
  initVerwaltungToggle();
});
