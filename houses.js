const listEl    = document.getElementById('list');
const nameInput = document.getElementById('cleanerName');
const toastEl   = document.getElementById('toast');

let selectedHouse   = null;
let activeFilter    = 'all'; // 'all' | 'muss_geputzt_werden' | 'sauber' | 'belegt'
let allApartments   = [];

// ── Labels ───────────────────────────────────────────────
function applyLabels() {
  document.getElementById('lbl-role').textContent     = t('roleClean');
  document.getElementById('lbl-admin').textContent    = t('roleAdmin');
  document.getElementById('lbl-yourname').textContent = t('yourName');
  nameInput.placeholder = t('namePlaceholder');
  document.documentElement.lang = localStorage.getItem('ma_lang') || 'de';
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function esc(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString(document.documentElement.lang, {
    day: '2-digit', month: '2-digit', year: '2-digit'
  });
}

function nightsBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 86400000);
}

// ── Buchungen rendern ────────────────────────────────────
function renderBookings(bookings) {
  if (!bookings || !bookings.length) return '';
  const rows = bookings.map(b => {
    const nights = nightsBetween(b.start, b.end);
    return `
      <div class="booking-row">
        <div class="booking-date-group">
          <span class="booking-date-label">${t('checkin')}</span>
          <span class="booking-date-value">${fmtDate(b.start)}</span>
        </div>
        <div class="booking-date-group">
          <span class="booking-date-label">${t('checkout2')}</span>
          <span class="booking-date-value">${fmtDate(b.end)}</span>
        </div>
        <span class="booking-nights">${t('night', nights)}</span>
      </div>`;
  }).join('');

  return `
    <div class="bookings-block">
      <div class="bookings-title">📅 ${t('upcomingBookings')}</div>
      ${rows}
    </div>`;
}

// ── Hausauswahl ──────────────────────────────────────────
async function showHouseScreen() {
  document.getElementById('house-overlay')?.remove();
  let houses = [];
  try { houses = await (await fetch('/api/houses')).json(); } catch {}

  const overlay = document.createElement('div');
  overlay.id = 'house-overlay';
  const cards = houses.length
    ? houses.map(h => {
        const n = h.needs_cleaning || 0;
        return `
        <button class="house-card" data-id="${h.id}" data-name="${esc(h.name)}">
          <div class="house-card-icon">🏠</div>
          <div class="house-card-body">
            <div class="house-card-name">${esc(h.name)}</div>
            ${h.address ? `<div class="house-card-address">${esc(h.address)}</div>` : ''}
            <div class="house-card-meta">
              <span class="house-pill all">${t('aptCount', h.total || 0)}</span>
              ${n > 0 ? `<span class="house-pill needs">${t('needsCleaning', n)}</span>` : ''}
            </div>
          </div>
          <div class="house-card-arrow">›</div>
        </button>`;
      }).join('')
    : `<div class="house-empty">${t('noHouses')}</div>`;

  overlay.innerHTML = `
    <div class="house-screen">
      <div class="house-screen-header">
        <div class="house-screen-title">${t('selectHouse')}</div>
        <div class="house-screen-hint">${t('selectHouseHint')}</div>
      </div>
      <div class="house-card-list">${cards}</div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('.house-card').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedHouse = { id: btn.dataset.id, name: btn.dataset.name };
      overlay.classList.add('fade-out');
      setTimeout(() => { overlay.remove(); showHouseHeader(); loadApartments(); }, 220);
    });
  });
}

function showHouseHeader() {
  document.getElementById('house-header')?.remove();
  const el = document.createElement('div');
  el.id = 'house-header';
  el.innerHTML = `
    <button class="btn-back" id="btn-back-houses">${t('backToHouses')}</button>
    <div class="current-house-label">🏠 <span>${esc(selectedHouse?.name || '')}</span></div>`;
  document.querySelector('main').insertBefore(el, document.querySelector('main').firstChild);
  document.getElementById('btn-back-houses').addEventListener('click', () => {
    document.getElementById('house-header')?.remove();
    document.getElementById('status-filter')?.remove();
    listEl.innerHTML = '';
    document.getElementById('lbl-section').textContent = '';
    showHouseScreen();
  });
  document.getElementById('lbl-section').textContent = t('sectionTodo');
}

// ── Status-Filter Tabs ───────────────────────────────────
function showFilterTabs() {
  document.getElementById('status-filter')?.remove();
  const tabs = [
    { key: 'all',                  label: t('statusAll') },
    { key: 'muss_geputzt_werden',  label: t('statusPutzen') },
    { key: 'sauber',               label: t('statusSauber') },
    { key: 'belegt',               label: t('statusBelegt') },
  ];
  const el = document.createElement('div');
  el.id = 'status-filter';
  el.className = 'status-tabs';
  el.innerHTML = tabs.map(tab => `
    <button class="status-tab ${activeFilter === tab.key ? 'active' : ''}" data-filter="${tab.key}">
      ${tab.label}
    </button>`).join('');

  // Vor der Apartment-Liste einfügen
  listEl.parentNode.insertBefore(el, listEl);

  el.querySelectorAll('.status-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      showFilterTabs(); // Tabs neu rendern (aktiver Tab)
      renderFiltered();
    });
  });
}

// ── Apartments laden & rendern ───────────────────────────
async function loadApartments() {
  if (!selectedHouse) return;
  try {
    const url = `/api/apartments?house_id=${selectedHouse.id}`;
    allApartments = await (await fetch(url)).json();
    showFilterTabs();
    renderFiltered();
  } catch {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${t('connError')}</p></div>`;
  }
}

function renderFiltered() {
  const filtered = activeFilter === 'all'
    ? allApartments
    : allApartments.filter(a => a.status === activeFilter);
  render(filtered);
}

function render(apartments) {
  if (!apartments.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${t('emptyTitle')}</div>
        <p>${t('emptyText').replace('\n', '<br>')}</p>
      </div>`;
    return;
  }

  listEl.innerHTML = apartments.map(apt => {
    const notes = (apt.notes || []).map(n => `
      <div class="apt-note">
        <span class="apt-note-icon">${t('noteHint')}</span>
        <span>${esc(n.message)}</span>
      </div>`).join('');

    const showConfirm = apt.status === 'muss_geputzt_werden';

    return `
      <div class="apt-card" style="flex-wrap:wrap;gap:.6rem">
        <div class="apt-card-top">
          <div class="apt-card-left" style="flex:1;min-width:0">
            <div class="apt-name">${esc(apt.name)}</div>
            <div style="margin-top:.3rem">
              <span class="badge ${apt.status}">${statusLabel(apt.status)}</span>
            </div>
          </div>
          ${showConfirm
            ? `<button class="btn-confirm" data-id="${apt.id}" style="align-self:flex-start">${t('btnDone')}</button>`
            : ''}
        </div>
        ${notes ? `<div class="apt-card-bottom"><div class="apt-notes">${notes}</div></div>` : ''}
        <div class="apt-card-bottom">${renderBookings(apt.upcoming_bookings)}</div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.btn-confirm').forEach(btn => {
    btn.addEventListener('click', () => confirmClean(btn));
  });
}

function statusLabel(s) {
  return {
    belegt:              t('statusBelegt'),
    muss_geputzt_werden: t('statusPutzen'),
    sauber:              t('statusSauber'),
  }[s] || s;
}

async function confirmClean(btn) {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); showToast(t('toastNameMissing')); return; }
  btn.disabled = true;
  btn.textContent = t('saving');
  try {
    const res = await fetch(`/api/apartments/${btn.dataset.id}/confirm-clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleaner_name: name }),
    });
    if (!res.ok) throw new Error();
    showToast(t('toastConfirmed'));
    loadApartments();
  } catch {
    btn.disabled = false;
    btn.textContent = t('btnDone');
    showToast(t('toastError'));
  }
}

// ── Init ─────────────────────────────────────────────────
nameInput.value = localStorage.getItem('cleanerName') || '';
nameInput.addEventListener('input', () => localStorage.setItem('cleanerName', nameInput.value.trim()));

document.getElementById('btn-lang').addEventListener('click', () => {
  localStorage.removeItem('ma_lang'); location.reload();
});

initLangScreen(() => {
  applyLabels();
  showHouseScreen();
  setInterval(() => { if (selectedHouse) loadApartments(); }, 20000);
});
