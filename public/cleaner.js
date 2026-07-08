const listEl    = document.getElementById('list');
const nameInput = document.getElementById('cleanerName');
const toastEl   = document.getElementById('toast');

let selectedHouse = null;

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
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(document.documentElement.lang, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
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
  const main = document.querySelector('main');
  main.insertBefore(el, main.firstChild);
  document.getElementById('btn-back-houses').addEventListener('click', () => {
    document.getElementById('house-header')?.remove();
    listEl.innerHTML = '';
    document.getElementById('lbl-section').textContent = '';
    showHouseScreen();
  });
  document.getElementById('lbl-section').textContent = t('sectionTodo');
}

// ── Apartments laden ─────────────────────────────────────
async function loadApartments() {
  if (!selectedHouse) return;
  try {
    const url = `/api/apartments?status=muss_geputzt_werden&house_id=${selectedHouse.id}`;
    render(await (await fetch(url)).json());
  } catch {
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${t('connError')}</p></div>`;
  }
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
      <div class="apt-card" style="flex-wrap:wrap">
        <div class="apt-card-left" style="flex:1;min-width:0">
          <div class="apt-name">${esc(apt.name)}</div>
          <div class="apt-meta">${t('checkout')}: <span>${fmtDate(apt.last_checkout)}</span></div>
          ${notes ? `<div class="apt-notes">${notes}</div>` : ''}
        </div>
        <button class="btn-confirm" data-id="${apt.id}" style="align-self:flex-start">${t('btnDone')}</button>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.btn-confirm').forEach(btn => {
    btn.addEventListener('click', () => confirmClean(btn));
  });
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

nameInput.value = localStorage.getItem('cleanerName') || '';
nameInput.addEventListener('input', () => localStorage.setItem('cleanerName', nameInput.value.trim()));

document.getElementById('btn-lang').addEventListener('click', () => {
  localStorage.removeItem('ma_lang');
  location.reload();
});

initLangScreen(() => {
  applyLabels();
  showHouseScreen();
  setInterval(() => { if (selectedHouse) loadApartments(); }, 20000);
});
