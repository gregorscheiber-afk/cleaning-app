const scrollEl    = document.getElementById('planer-scroll');
const fromInput   = document.getElementById('from-date');
const daysSelect  = document.getElementById('days-select');
const btnToday    = document.getElementById('btn-today');
const houseFilter = document.getElementById('house-filter');
const badgeHeader = document.getElementById('plan-badge');

// Plan-Typ aus URL ermitteln
const urlParams  = new URLSearchParams(window.location.search);
const planType   = urlParams.get('plan') || 'wiwa';
const isMainstreet = planType === 'mainstreet';

const PLAN_LABELS = {
  wiwa:       'Plan WIWA',
  mainstreet: 'Plan MAINSTREET',
};

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
    // Haus-Trennzeile mit Heute-Highlight pro Zelle
    const houseCells = dates.map(d => {
      const isT = d === todayStr;
      return `<td style="background:${isT ? 'rgba(200,150,58,.18)' : 'var(--surface-3)'};border-bottom:1px solid var(--line);${isT ? 'border-left:1px solid rgba(200,150,58,.4);border-right:1px solid rgba(200,150,58,.4);' : ''}height:28px"></td>`;
    }).join('');
    html += `<tr class="tr-house">
      <td class="td-name" style="background:var(--surface-3);color:var(--accent);font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;height:28px">
        🏠 ${esc(house.name)}
      </td>
      ${houseCells}
    </tr>`;

    house.apts.forEach(apt => {
      // Notizen für dieses Apartment merken
      const aptNotes = apt.notes || [];
      // Checkout-Tage bestimmen
      const checkoutDays = new Set(apt.bookings.map(b => b.end.substring(0,10)));

      html += `<tr class="tr-apt" data-apt="${apt.id}">
        <td class="td-name">
          <div class="td-name-inner">
            <div>
              <span class="status-dot dot-${apt.status}"></span>
              <span class="apt-code">${esc(apt.pms_code || apt.name)}</span>
              ${(apt.jose_notes || []).length ? `<span class="bk-note-icon" data-jose-apt="${apt.id}" style="display:inline-flex;margin-left:.35rem;vertical-align:middle">📝</span>` : ''}
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
      const aptNotes = apt.notes || [];
      // Bereits gezeichnete Balken dieser Zeile (für Überlappungs-Stapelung)
      const placed = [];
      // Notiz gilt nur für die nächste kommende Buchung (erste Buchung ab heute)
      const todayISO = new Date().toISOString().substring(0,10);
      const nextBooking = apt.bookings
        .filter(b => b.start.substring(0,10) >= todayISO)
        .sort((a,b) => a.start.localeCompare(b.start))[0];
      const nextBookingId = nextBooking ? nextBooking.id : null;

      apt.bookings.forEach(b => {
        const bStart = b.start.substring(0,10);
        const bEnd   = b.end.substring(0,10);
        const isNextBooking = nextBookingId && b.id === nextBookingId;

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

        // Mitte-zu-Mitte Positionierung:
        // Block startet in der Mitte des Anreisetages, endet in der Mitte des
        // Abreisetages. WICHTIG: echte Zellbreiten messen – der Browser kann
        // die Tabelle strecken, dann stimmt die feste Spaltenbreite COL_W
        // nicht mehr und Balken würden zu kurz gezeichnet.
        const rowEl = cell.parentElement;
        const startsBeforeView = bStart < dates[0];
        const endsAfterView   = ei >= days;
        const endCell = endsAfterView
          ? rowEl.querySelector(`[data-date="${dates[days-1]}"]`)
          : rowEl.querySelector(`[data-date="${dates[ei]}"]`);
        const leftOffset = startsBeforeView ? 0 : Math.round(cell.offsetWidth / 2);
        const endX = endCell
          ? (endCell.offsetLeft - cell.offsetLeft) +
            (endsAfterView ? endCell.offsetWidth : Math.round(endCell.offsetWidth / 2))
          : span * COL_W;
        const blockWidth = endX - leftOffset - 2;

        const block = document.createElement('div');
        block.className = `bk ${color}`;
        block.style.left  = `${leftOffset + 1}px`;
        block.style.width = `${Math.max(blockWidth, 10)}px`;

        // Überlappende Buchungen (z. B. zwei Gäste im selben Apartment)
        // übereinander stapeln statt verdecken
        const absStart = cell.offsetLeft + leftOffset;
        const absEnd   = absStart + blockWidth;
        const overlapping = placed.filter(p => p.absStart < absEnd && absStart < p.absEnd);
        if (overlapping.length) {
          overlapping.forEach(p => p.el.classList.add('bk-upper'));
          block.classList.add('bk-lower');
        }
        placed.push({ absStart, absEnd, el: block });
        const fmtDE = iso => { const [y,m,d] = iso.split('-'); return `${d}.${m}.${y}`; };
        block.title = `${b.guest_name||''} · ${b.persons||''} · ${fmtDE(bStart)} → ${fmtDE(bEnd)}`;
        const showNote = isNextBooking && aptNotes.length > 0;
        const noteText = aptNotes.map(n => '• ' + n).join('\n');
        block.innerHTML = `
          <span class="bk-guest">${esc(b.guest_name||'–')}</span>
          ${b.persons ? `<span class="bk-persons">${esc(b.persons)}</span>` : ''}
          ${showNote ? `<span class="bk-note-icon">ℹ</span>` : ''}`;
        cell.appendChild(block);

        // Tooltip per JS an den Body hängen (damit er nicht abgeschnitten wird)
        // Funktioniert per Hover (Desktop) UND per Tippen (Handy)
        if (showNote) {
          const icon = block.querySelector('.bk-note-icon');

          const showTip = () => {
            if (icon._tip) return;
            const tip = document.createElement('div');
            tip.className = 'note-tooltip-float';
            tip.textContent = noteText;
            document.body.appendChild(tip);
            const r = icon.getBoundingClientRect();
            let left = r.left + r.width/2;
            // Am Bildschirmrand nicht abschneiden
            const tipW = Math.min(260, window.innerWidth - 20);
            if (left - tipW/2 < 10) left = tipW/2 + 10;
            if (left + tipW/2 > window.innerWidth - 10) left = window.innerWidth - tipW/2 - 10;
            tip.style.left = left + 'px';
            tip.style.top  = (r.top - 8) + 'px';
            icon._tip = tip;
          };
          const hideTip = () => {
            if (icon._tip) { icon._tip.remove(); icon._tip = null; }
          };

          // Desktop
          icon.addEventListener('mouseenter', showTip);
          icon.addEventListener('mouseleave', hideTip);

          // Handy: Antippen öffnet/schließt
          icon.addEventListener('click', (e) => {
            e.stopPropagation();
            if (icon._tip) { hideTip(); } else {
              // andere offene Tooltips schließen
              document.querySelectorAll('.note-tooltip-float').forEach(t => t.remove());
              document.querySelectorAll('.bk-note-icon').forEach(i => i._tip = null);
              showTip();
            }
          });
        }
      });
    });
  });

  // José-Notizen: 📝 beim Apartment-Namen, Tooltip per Hover/Antippen
  apartments.forEach(apt => {
    if (!(apt.jose_notes || []).length) return;
    const icon = scrollEl.querySelector(`[data-jose-apt="${apt.id}"]`);
    if (!icon) return;
    const noteText = apt.jose_notes.map(n => '• ' + n).join('\n');

    const showTip = () => {
      if (icon._tip) return;
      const tip = document.createElement('div');
      tip.className = 'note-tooltip-float';
      tip.textContent = noteText;
      document.body.appendChild(tip);
      const r = icon.getBoundingClientRect();
      let left = r.left + r.width / 2;
      const tipW = Math.min(260, window.innerWidth - 20);
      if (left - tipW / 2 < 10) left = tipW / 2 + 10;
      if (left + tipW / 2 > window.innerWidth - 10) left = window.innerWidth - tipW / 2 - 10;
      tip.style.left = left + 'px';
      tip.style.top  = (r.top - 8) + 'px';
      icon._tip = tip;
    };
    const hideTip = () => { if (icon._tip) { icon._tip.remove(); icon._tip = null; } };

    icon.addEventListener('mouseenter', showTip);
    icon.addEventListener('mouseleave', hideTip);
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      if (icon._tip) { hideTip(); } else {
        document.querySelectorAll('.note-tooltip-float').forEach(t => t.remove());
        document.querySelectorAll('.bk-note-icon').forEach(i => i._tip = null);
        showTip();
      }
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
  checkImportWarning();
  setInterval(() => { checkCleaningAlert(); checkImportWarning(); }, 5 * 60 * 1000); // alle 5 Min prüfen
});

// Tippen außerhalb eines Info-Zeichens schließt offene Notiz-Tooltips (Handy)
document.addEventListener('click', (e) => {
  if (!e.target.classList || !e.target.classList.contains('bk-note-icon')) {
    document.querySelectorAll('.note-tooltip-float').forEach(t => t.remove());
    document.querySelectorAll('.bk-note-icon').forEach(i => i._tip = null);
  }
});
