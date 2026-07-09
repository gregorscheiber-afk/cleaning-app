const scrollEl   = document.getElementById('planer-scroll');
const fromInput  = document.getElementById('from-date');
const daysSelect = document.getElementById('days-select');
const btnToday   = document.getElementById('btn-today');

// Farben pro Haus
const HOUSE_COLORS = ['bk-color-0','bk-color-1','bk-color-2','bk-color-3','bk-color-4','bk-color-5'];

// Heute als Standard
const todayStr = new Date().toISOString().substring(0,10);
// 5 Tage zurück als Start
const defaultFrom = new Date(Date.now() - 5*86400000).toISOString().substring(0,10);
fromInput.value = defaultFrom;

function dateStr(d) {
  return new Date(d).toISOString().substring(0,10);
}

function addDays(str, n) {
  return dateStr(new Date(str).getTime() + n*86400000);
}

function getKW(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay()+6)%7);
  const w = new Date(d.getFullYear(),0,4);
  return 'KW ' + (1 + Math.round(((d-w)/86400000 - 3 + (w.getDay()+6)%7)/7));
}

function getDayName(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', { weekday: 'short' });
}

function getDayNum(dateStr) {
  return new Date(dateStr).getDate();
}

function getMonth(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function isWeekend(dateStr) {
  const d = new Date(dateStr).getDay();
  return d === 0 || d === 6;
}

async function loadPlan() {
  const from = fromInput.value || defaultFrom;
  const days = parseInt(daysSelect.value) || 30;

  scrollEl.innerHTML = '<div class="planer-empty">Wird geladen …</div>';

  try {
    const res  = await fetch(`/api/plan?from=${from}&days=${days}`);
    const data = await res.json();
    renderPlan(data, from, days);
  } catch(e) {
    scrollEl.innerHTML = `<div class="planer-empty">Fehler beim Laden: ${e.message}</div>`;
  }
}

function renderPlan(data, from, days) {
  const apartments = data.apartments || [];
  if (!apartments.length) {
    scrollEl.innerHTML = '<div class="planer-empty">Keine Apartments gefunden.</div>';
    return;
  }

  // Datumsliste aufbauen
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(addDays(from, i));

  // KW-Gruppen für Header
  const kwGroups = [];
  let lastKW = '';
  dates.forEach((d, i) => {
    const kw = getKW(d);
    if (kw !== lastKW) { kwGroups.push({ label: kw, start: i, count: 0 }); lastKW = kw; }
    kwGroups[kwGroups.length-1].count++;
  });

  // Häuser-Gruppen
  const houseMap = {};
  apartments.forEach(apt => {
    const hid = apt.house_id || 0;
    if (!houseMap[hid]) houseMap[hid] = { name: apt.house_name || '–', apts: [] };
    houseMap[hid].apts.push(apt);
  });

  const totalCols = 1 + days; // 1 für Apartment-Namen + N Tage
  const gridStyle = `grid-template-columns: 140px ${Array(days).fill('38px').join(' ')}`;

  let html = `<div class="planer-grid" style="${gridStyle}">`;

  // ── Header Zeile 1: KW ──
  html += `<div class="cell-header col-apt" style="position:sticky;top:0;z-index:11;border-bottom:1px solid var(--line)">
    ${getMonth(from)}
  </div>`;
  kwGroups.forEach(g => {
    html += `<div class="cell-header kw" style="grid-column:span ${g.count};position:sticky;top:0">${g.label}</div>`;
  });

  // ── Header Zeile 2: Wochentag ──
  html += `<div class="cell-header col-apt" style="position:sticky;top:28px;z-index:11"></div>`;
  dates.forEach(d => {
    const weekend = isWeekend(d) ? ' is-weekend' : '';
    const today   = d === todayStr ? ' is-today' : '';
    html += `<div class="cell-header day-name${weekend}${today}" style="position:sticky;top:28px">${getDayName(d)}</div>`;
  });

  // ── Header Zeile 3: Datum ──
  html += `<div class="cell-header col-apt" style="position:sticky;top:52px;z-index:11"></div>`;
  dates.forEach(d => {
    const weekend = isWeekend(d) ? ' is-weekend' : '';
    const today   = d === todayStr ? ' is-today' : '';
    html += `<div class="cell-header date-num${weekend}${today}" style="position:sticky;top:52px">${getDayNum(d)}</div>`;
  });

  // ── Haus + Apartment Zeilen ──
  let houseColorIdx = 0;
  const dateIndex = Object.fromEntries(dates.map((d,i) => [d,i]));

  Object.values(houseMap).forEach(house => {
    // Haus-Trennzeile
    html += `<div class="cell-house-label">🏠 ${esc(house.name)}</div>`;
    html += `<div class="cell-house-spacer" style="grid-column:span ${days}"></div>`;

    const colorClass = HOUSE_COLORS[houseColorIdx % HOUSE_COLORS.length];
    houseColorIdx++;

    house.apts.forEach(apt => {
      // Apartment-Namenszeile
      html += `
        <div class="cell-apt-name">
          <div>
            <span class="apt-status-dot dot-${apt.status}"></span>
            <span class="apt-code">${esc(apt.pms_code || apt.name)}</span>
          </div>
          <div style="font-size:.65rem;color:var(--ink-muted)">${esc(apt.name)}</div>
        </div>`;

      // Tages-Zellen für dieses Apartment
      // Erstmal alle Zellen als leer
      const cellMap = {}; // index → info
      const checkoutDays = new Set();
      const checkinDays  = new Set();

      apt.bookings.forEach(b => {
        const bStart = b.start.substring(0,10);
        const bEnd   = b.end.substring(0,10);
        checkoutDays.add(bEnd);
        checkinDays.add(bStart);
      });

      dates.forEach((d, i) => {
        const weekend  = isWeekend(d) ? ' is-weekend' : '';
        const isToday  = d === todayStr ? ' is-today' : '';
        const isCO     = checkoutDays.has(d) ? ' checkout-day' : '';
        html += `<div class="cell-day${weekend}${isToday}${isCO}" data-apt="${apt.id}" data-date="${d}" data-col="${i}"></div>`;
      });

      // Buchungsblöcke werden via JS positioniert (after render)
      // Wir encodieren die Buchungsdaten als data-Attribute auf der Zeile – nein,
      // wir bauen die Blöcke direkt als HTML mit absoluter Positionierung
    });
  });

  html += '</div>';
  scrollEl.innerHTML = html;

  // Buchungsblöcke einzeichnen
  let hi = 0;
  Object.values(houseMap).forEach(house => {
    const colorClass = HOUSE_COLORS[hi % HOUSE_COLORS.length];
    hi++;
    house.apts.forEach(apt => {
      apt.bookings.forEach(b => {
        const bStart = b.start.substring(0,10);
        const bEnd   = b.end.substring(0,10);

        // Startindex (geclippt auf sichtbaren Bereich)
        const startIdx = Math.max(0, dates.indexOf(bStart));
        // Endindex (Checkout-Tag ist Leerfeld, Block endet davor)
        const endIdx   = Math.min(days, dates.indexOf(bEnd) < 0 ? days : dates.indexOf(bEnd));

        if (startIdx >= days || endIdx <= 0 || startIdx >= endIdx) return;
        const spanCols = endIdx - startIdx;

        // Erste Zelle dieser Buchung suchen
        const firstCell = scrollEl.querySelector(
          `[data-apt="${apt.id}"][data-date="${dates[startIdx]}"]`
        );
        if (!firstCell) return;

        const block = document.createElement('div');
        block.className = `booking-block ${colorClass}`;
        // Breite = spanCols * 38px - Padding
        block.style.left   = '2px';
        block.style.width  = `calc(${spanCols} * 38px - 4px)`;
        block.title = `${b.guest_name || ''} · ${b.persons || ''} · ${bStart} → ${bEnd}`;

        block.innerHTML = `
          <span class="bk-guest">${esc(b.guest_name || '–')}</span>
          ${b.persons ? `<span class="bk-persons">${esc(b.persons)}</span>` : ''}`;

        firstCell.appendChild(block);
      });
    });
  });

  // Heute scrollen
  const todayCell = scrollEl.querySelector(`[data-date="${todayStr}"]`);
  if (todayCell) {
    setTimeout(() => {
      const offset = todayCell.offsetLeft - 160;
      scrollEl.scrollLeft = Math.max(0, offset);
    }, 50);
  }
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

// Events
fromInput.addEventListener('change', loadPlan);
daysSelect.addEventListener('change', loadPlan);
btnToday.addEventListener('click', () => {
  fromInput.value = new Date(Date.now() - 5*86400000).toISOString().substring(0,10);
  loadPlan();
});

// Start
initLangScreen(() => loadPlan());
