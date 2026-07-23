const listEl  = document.getElementById('list');
const toastEl = document.getElementById('toast');

// Optionaler Plan-Filter aus der Adresse (/?plan=wiwa oder /?plan=mainstreet):
// zeigt in der Hausauswahl nur die Häuser des jeweiligen Reinigungsplans
const cleanerPlan = new URLSearchParams(window.location.search).get('plan');

let selectedHouse = null;
let activeFilter  = 'all';
let allApartments = [];

function applyLabels() {
  document.getElementById('lbl-role').textContent  = t('roleClean');
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

function statusLabel(s) {
  return {
    belegt:              t('statusBelegt'),
    muss_geputzt_werden: t('statusPutzen'),
    sauber:              t('statusSauber'),
  }[s] || s;
}

function renderBookings(bookings) {
  if (!bookings?.length) return '';
  const rows = bookings.map(b => {
    const isLM = b.highlighted_until && new Date() < new Date(b.highlighted_until);
    return `
    <div class="booking-row${isLM ? ' last-minute' : ''}">
      ${isLM ? `<div style="grid-column:1/-1;margin-bottom:.2rem"><span class="last-minute-badge">${t('lastMinute')}</span></div>` : ''}
      <div class="booking-date-group">
        <span class="booking-date-label">${t('checkin')}</span>
        <span class="booking-date-value">${fmtDate(b.start)}</span>
      </div>
      <div class="booking-date-group">
        <span class="booking-date-label">${t('checkout2')}</span>
        <span class="booking-date-value">${fmtDate(b.end)}</span>
      </div>
      <span class="booking-nights">${t('night', nightsBetween(b.start, b.end))}</span>
      ${b.persons   ? `<div class="booking-persons">👥 ${esc(b.persons)}</div>` : ''}
      ${b.guest_name ? `<div style="font-size:.72rem;color:var(--ink-soft);grid-column:1/-1">👤 ${esc(b.guest_name)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="bookings-block"><div class="bookings-title">📅 ${t('upcomingBookings')}</div>${rows}</div>`;
}

// ── Hausauswahl ──────────────────────────────────────────
async function showHouseScreen() {
  document.getElementById('house-overlay')?.remove();
  let houses = [];
  try {
    const url = '/api/houses' + (cleanerPlan ? `?plan=${encodeURIComponent(cleanerPlan)}` : '');
    houses = await (await fetch(url)).json();
  } catch {}

  const overlay = document.createElement('div');
  overlay.id = 'house-overlay';
  const cards = houses.length
    ? houses.map(h => `
        <button class="house-card" data-id="${h.id}" data-name="${esc(h.name)}">
          <div class="house-card-icon">🏠</div>
          <div class="house-card-body">
            <div class="house-card-name">${esc(h.name)}</div>
            ${h.address ? `<div class="house-card-address">${esc(h.address)}</div>` : ''}
            <div class="house-card-meta">
              <span class="house-pill all">${t('aptCount', h.total || 0)}</span>
              ${h.needs_cleaning > 0 ? `<span class="house-pill needs">${t('needsCleaning', h.needs_cleaning)}</span>` : ''}
            </div>
          </div>
          <div class="house-card-arrow">›</div>
        </button>`).join('')
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

function showFilterTabs() {
  document.getElementById('status-filter')?.remove();
  const tabs = [
    { key: 'all',                 label: t('statusAll') },
    { key: 'muss_geputzt_werden', label: t('statusPutzen') },
    { key: 'sauber',              label: t('statusSauber') },
    { key: 'belegt',              label: t('statusBelegt') },
  ];
  const el = document.createElement('div');
  el.id = 'status-filter';
  el.className = 'status-tabs';
  el.innerHTML = tabs.map(tab => `
    <button class="status-tab ${activeFilter === tab.key ? 'active' : ''}" data-filter="${tab.key}">
      ${tab.label}
    </button>`).join('');
  listEl.parentNode.insertBefore(el, listEl);
  el.querySelectorAll('.status-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      showFilterTabs();
      renderFiltered();
    });
  });
}

async function loadApartments() {
  if (!selectedHouse) return;
  try {
    allApartments = await (await fetch(`/api/apartments?house_id=${selectedHouse.id}`)).json();
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

    return `
      <div class="apt-card" style="flex-wrap:wrap;gap:.6rem">
        <div class="apt-card-top">
          <div class="apt-card-left" style="flex:1;min-width:0">
            <div class="apt-name">${esc(apt.name)}</div>
            <div style="margin-top:.3rem">
              <span class="badge ${apt.status}">${statusLabel(apt.status)}</span>
            </div>
            ${apt.checkout_time ? `<div style="font-size:.72rem;color:var(--ink-soft);margin-top:.3rem">⏰ ${t('cleanFrom')}: <strong style="color:var(--ink)">${esc(apt.checkout_time)} Uhr</strong></div>` : ''}
          </div>
          ${apt.status === 'muss_geputzt_werden'
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

function openConfirmSheet(aptId, aptName, apt) {
  // Bestehenden Overlay entfernen
  document.getElementById('confirm-overlay')?.remove();

  // Checkliste aufbauen
  const items = [];

  // 1. Immer: sauber gereinigt
  items.push({
    id: 'clean',
    label: t('confirmCleanLabel'),
    sub: t('confirmCleanSub'),
    icon: '🧹',
  });

  // 2. Personenanzahl – aus nächster Buchung
  const nextBooking = apt.upcoming_bookings?.[0];
  if (nextBooking?.persons) {
    items.push({
      id: 'persons',
      label: t('confirmPersonsLabel', nextBooking.persons),
      sub: `${t('checkin')}: ${fmtDate(nextBooking.start)}`,
      icon: '👥',
    });
  }

  // 3. Jede Admin-Notiz als eigene Checkbox
  (apt.notes || []).forEach((n, i) => {
    items.push({
      id: `note_${n.id}`,
      label: t('confirmNotePrefix') + n.message,
      sub: '',
      icon: '📋',
    });
  });

  const checkedState = {};
  items.forEach(item => checkedState[item.id] = false);

  const overlay = document.createElement('div');
  overlay.id = 'confirm-overlay';

  function renderSheet() {
    const allChecked = Object.values(checkedState).every(Boolean);
    overlay.innerHTML = `
      <div class="confirm-sheet">
        <div class="confirm-sheet-title">${t('confirmTitle')}</div>
        <div class="confirm-sheet-apt">${esc(aptName)}</div>
        <div class="confirm-checklist">
          ${items.map(item => `
            <div class="confirm-item${checkedState[item.id] ? ' checked' : ''}" data-item="${item.id}">
              <div class="confirm-checkbox">${checkedState[item.id] ? '✓' : ''}</div>
              <div>
                <div class="confirm-item-text">${esc(item.icon)} ${esc(item.label)}</div>
                ${item.sub ? `<div class="confirm-item-sub">${esc(item.sub)}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <button class="btn-confirm-all" id="btn-confirm-all" ${allChecked ? '' : 'disabled'}>
          ${t('confirmBtn')}
        </button>
        <button class="btn-confirm-cancel" id="btn-confirm-cancel">${t('confirmCancel')}</button>
      </div>`;

    // Checkbox-Klick
    overlay.querySelectorAll('.confirm-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.item;
        checkedState[id] = !checkedState[id];
        renderSheet();
      });
    });

    // Bestätigen
    document.getElementById('btn-confirm-all')?.addEventListener('click', async () => {
      if (!Object.values(checkedState).every(Boolean)) return;
      document.getElementById('btn-confirm-all').disabled = true;
      document.getElementById('btn-confirm-all').textContent = t('saving');
      try {
        const res = await fetch(`/api/apartments/${aptId}/confirm-clean`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleaner_name: '–' }),
        });
        if (!res.ok) throw new Error();
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 220);
        showToast(t('toastConfirmed'));
        loadApartments();
      } catch {
        showToast(t('toastError'));
        document.getElementById('btn-confirm-all').disabled = false;
        document.getElementById('btn-confirm-all').textContent = t('confirmBtn');
      }
    });

    // Abbrechen
    document.getElementById('btn-confirm-cancel')?.addEventListener('click', () => {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 220);
    });
  }

  renderSheet();
  document.body.appendChild(overlay);

  // Tap außerhalb schließt Sheet
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 220);
    }
  });
}

async function confirmClean(btn) {
  // Apartment-Daten aus der aktuellen Liste holen
  const aptId = btn.dataset.id;
  const apt = allApartments.find(a => String(a.id) === String(aptId));
  const aptName = apt?.name || aptId;
  openConfirmSheet(aptId, aptName, apt || {});
}

document.getElementById('btn-lang').addEventListener('click', () => {
  localStorage.removeItem('ma_lang'); location.reload();
});

initLangScreen(() => {
  applyLabels();
  showHouseScreen();
  setInterval(() => { if (selectedHouse) loadApartments(); }, 20000);
});
