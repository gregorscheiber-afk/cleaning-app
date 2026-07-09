const scrollEl    = document.getElementById('planer-scroll');
const fromInput   = document.getElementById('from-date');
const daysSelect  = document.getElementById('days-select');
const btnToday    = document.getElementById('btn-today');
const houseFilter = document.getElementById('house-filter');
const planBadge   = document.getElementById('plan-title-badge');
const badgeHeader = document.getElementById('plan-badge');

// Plan-Typ aus URL ermitteln
const urlParams  = new URLSearchParams(window.location.search);
const planType   = urlParams.get('plan') || 'wiwa';
const isMainstreet = planType === 'mainstreet';

const PLAN_LABELS = {
  wiwa:       'Plan WIWA',
  mainstreet: 'Plan MAINSTREET',
};

planBadge.textContent  = PLAN_LABELS[planType] || 'Belegungsplan';
badgeHeader.textContent = PLAN_LABELS[planType] || 'Belegungsplan';
document.title = `MYALPS · ${PLAN_LABELS[planType] || 'Belegungsplan'}`;

// Hausfilter nur für WIWA
if (!isMainstreet) houseFilter.style.display = 'block';

// Farben pro Haus
const COLORS = ['bk-0','bk-1','bk-2','bk-3','bk-4','bk-5','bk-6','bk-7'];

// Heute
const todayStr = new Date().toISOString().substring(0,10);
const startFrom = new Date(Date.now() - 3*86400000).toISOString().substring(0,10);
fromInput.value = startFrom;

function addDays(str, n) {
  return new Date(new Date(str).getTime() + n*86400000).toISOString().substring(0,10);
}

function getKW(dateStr) {
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay()+6)%7);
  const w = new Date(d.getFullYear(),0,4);
  return 'KW '+(1+Math.round(((d-w)/86400000-3+(w.getDay()+6)%7)/7));
}

function dayName(str) { return new Date(str).toLocaleDateString('de-DE',{weekday:'short'}); }
function dayNum(str)  { return new Date(str).getDate(); }
function isWeekend(str) { const d=new Date(str).getDay(); return d===0||d===6; }

function esc(s) { if(!s) return ''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

async function loadHouses(data) {
  if (isMainstreet) return;
  const current = houseFilter.value;
  // Nur Häuser zeigen die tatsächlich Apartments in diesem Plan haben
  const aptHouseIds = new Set(
    (data.apartments || []).map(a => String(a.house_id)).filter(Boolean)
  );
  const relevantHouses = (data.houses || []).filter(h => aptHouseIds.has(String(h.id)));
  houseFilter.innerHTML = '<option value="">Alle Häuser</option>';
  relevantHouses.forEach(h => {
    const opt = document.createElement('option');
    opt.value = h.id; opt.textContent = h.name;
    if (String(h.id) === current) opt.selected = true;
    houseFilter.appendChild(opt);
  });
}

async function loadPlan() {
  const from    = fromInput.value || startFrom;
  const days    = parseInt(daysSelect.value) || 30;
  const houseId = houseFilter.value;

  scrollEl.innerHTML = '<div class="planer-empty">Wird geladen …</div>';

  try {
    let url = `/api/plan?from=${from}&days=${days}&plan=${planType}`;
    if (houseId && !isMainstreet) url += `&house_id=${houseId}`;
    const res  = await fetch(url);
    const data = await res.json();
    await loadHouses(data);
    renderPlan(data, from, days);
  } catch(e) {
    scrollEl.innerHTML = `<div class="planer-empty">Fehler: ${e.message}</div>`;
  }
}

function renderPlan(data, from, days) {
  const apartments = data.apartments || [];
  if (!apartments.length) {
    scrollEl.innerHTML = '<div class="planer-empty">Keine Apartments gefunden.</div>';
    return;
  }

  // Datumsliste
  const dates = Array.from({length: days}, (_, i) => addDays(from, i));

  // KW-Gruppen
  const kwGroups = [];
  dates.forEach((d, i) => {
    const kw = getKW(d);
    if (!kwGroups.length || kwGroups[kwGroups.length-1].label !== kw)
      kwGroups.push({label: kw, start: i, count: 0});
    kwGroups[kwGroups.length-1].count++;
  });

  // Häuser gruppieren
  const houseMap = new Map();
  apartments.forEach(apt => {
    const hid = apt.house_id || 0;
    if (!houseMap.has(hid)) houseMap.set(hid, {name: apt.house_name || '–', apts: []});
    houseMap.get(hid).apts.push(apt);
  });

  const COL_W = 36; // px pro Tag

  // HTML aufbauen
  let html = `<table class="planer-table">
  <colgroup>
    <col style="width:130px"/>
    ${dates.map(() => `<col style="width:${COL_W}px"/>`).join('')}
  </colgroup>
  <thead>
    <tr class="row-kw">
      <th class="th-name" rowspan="3" style="top:0;z-index:30;vertical-align:middle;text-align:left;font-size:.68rem">
        ${new Date(from).toLocaleDateString('de-DE',{month:'long',year:'numeric'})}
      </th>`;

  kwGroups.forEach(g => {
    html += `<th colspan="${g.count}" style="top:0">${g.label}</th>`;
  });

  html += `</tr><tr class="row-day">`;
  dates.forEach(d => {
    const cls = [isWeekend(d)?'is-weekend':'', d===todayStr?'is-today':''].filter(Boolean).join(' ');
    html += `<th class="${cls}">${dayName(d)}</th>`;
  });

  html += `</tr><tr class="row-date">`;
  dates.forEach(d => {
    const cls = [isWeekend(d)?'is-weekend':'', d===todayStr?'is-today':''].filter(Boolean).join(' ');
    html += `<th class="${cls}">${dayNum(d)}</th>`;
  });

  html += `</tr></thead><tbody>`;

  // Datum → Index Map
  const dateIdx = {};
  dates.forEach((d,i) => dateIdx[d] = i);

  let colorIdx = 0;

  houseMap.forEach((house) => {
    const color = COLORS[colorIdx++ % COLORS.length];

    // Haus-Trennzeile
    html += `<tr class="tr-house">
      <td class="td-name" style="background:var(--surface-3);color:var(--accent);font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;height:28px">
        🏠 ${esc(house.name)}
      </td>
      <td colspan="${days}" style="background:var(--surface-3);border-bottom:1px solid var(--line)"></td>
    </tr>`;

    house.apts.forEach(apt => {
      // Checkout-Tage bestimmen
      const checkoutDays = new Set(apt.bookings.map(b => b.end.substring(0,10)));

      html += `<tr class="tr-apt" data-apt="${apt.id}">
        <td class="td-name">
          <div class="td-name-inner">
            <div>
              <span class="status-dot dot-${apt.status}"></span>
              <span class="apt-code">${esc(apt.pms_code || apt.name)}</span>
            </div>
            <div class="apt-time-label">⏰ ${esc(apt.checkout_time||'09:30')} Uhr</div>
          </div>
        </td>`;

      dates.forEach(d => {
        const cls = [
          'td-day',
          isWeekend(d) ? 'is-weekend' : '',
          d === todayStr ? 'is-today' : '',
          checkoutDays.has(d) ? 'is-checkout' : '',
        ].filter(Boolean).join(' ');
        html += `<td class="${cls}" data-apt="${apt.id}" data-date="${d}"></td>`;
      });

      html += `</tr>`;
    });
  });

  html += `</tbody></table>`;
  scrollEl.innerHTML = html;

  // Buchungsblöcke einzeichnen
  let ci = 0;
  houseMap.forEach((house) => {
    const color = COLORS[ci++ % COLORS.length];
    house.apts.forEach(apt => {
      apt.bookings.forEach(b => {
        const bStart = b.start.substring(0,10);
        const bEnd   = b.end.substring(0,10);

        // Sichtbarer Startindex
        const si = dateIdx[bStart] !== undefined ? dateIdx[bStart] : dates.findIndex(d => d >= bStart);
        if (si < 0 || si >= days) return;

        // Sichtbarer Endindex (Checkout-Tag nicht mehr belegt)
        let ei = dateIdx[bEnd] !== undefined ? dateIdx[bEnd] : days;
        ei = Math.min(ei, days);

        const span = ei - si;
        if (span <= 0) return;

        const cell = scrollEl.querySelector(`[data-apt="${apt.id}"][data-date="${dates[si]}"]`);
        if (!cell) return;

        const block = document.createElement('div');
        block.className = `bk ${color}`;
        block.style.width = `${span * COL_W - 2}px`;
        block.title = `${b.guest_name||''} · ${b.persons||''} · ${bStart} → ${bEnd}`;
        block.innerHTML = `
          <span class="bk-guest">${esc(b.guest_name||'–')}</span>
          ${b.persons ? `<span class="bk-persons">${esc(b.persons)}</span>` : ''}`;
        cell.appendChild(block);

        // Checkout-Marker auf dem Abreise-Tag
        if (dateIdx[bEnd] !== undefined && dateIdx[bEnd] < days) {
          const coCell = scrollEl.querySelector(`[data-apt="${apt.id}"][data-date="${bEnd}"]`);
          if (coCell) {
            const marker = document.createElement('div');
            marker.className = 'co-marker';
            coCell.appendChild(marker);
          }
        }
      });
    });
  });

  // Zu Heute scrollen
  const todayCell = scrollEl.querySelector(`[data-date="${todayStr}"]`);
  if (todayCell) {
    setTimeout(() => {
      scrollEl.scrollLeft = Math.max(0, todayCell.offsetLeft - 150);
    }, 50);
  }
}

// Events
fromInput.addEventListener('change', loadPlan);
daysSelect.addEventListener('change', loadPlan);
houseFilter.addEventListener('change', loadPlan);
btnToday.addEventListener('click', () => {
  fromInput.value = new Date(Date.now()-3*86400000).toISOString().substring(0,10);
  loadPlan();
});

async function checkCleaningAlert() {
  const container = document.getElementById('cleaning-alert-container');
  if (!container) return;
  try {
    const res = await fetch(`/api/cleaning-alert?plan=${planType}`);
    const apts = await res.json();
    if (!apts.length) { container.innerHTML = ''; return; }

    const list = apts.map(a =>
      `${a.house_name ? '<strong>' + esc(a.house_name) + '</strong> – ' : ''}${esc(a.name)}`
    ).join(' &nbsp;·&nbsp; ');

    container.innerHTML = `
      <div class="cleaning-alert-banner">
        <div class="cleaning-alert-icon">⚠️</div>
        <div class="cleaning-alert-text">
          <div class="cleaning-alert-title">Reinigungsalarm – Anreise heute, noch nicht sauber!</div>
          <div class="cleaning-alert-list">${list}</div>
        </div>
      </div>`;
  } catch { /* still ignore errors */ }
}

// Start
initLangScreen(() => {
  loadPlan();
  checkCleaningAlert();
  setInterval(checkCleaningAlert, 5 * 60 * 1000); // alle 5 Min prüfen
});
