const listEl  = document.getElementById('arr-list');
const dateEl  = document.getElementById('arr-date');
const titleEl = document.getElementById('arr-title');
const countEl = document.getElementById('arr-count');

function esc(s) { if (s == null) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function todayVienna() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
}
function fmtDE(iso) {
  const d = new Date(iso);
  return isNaN(d) ? esc(iso) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function nights(a, b) {
  const n = Math.round((new Date(b) - new Date(a)) / 86400000);
  return n > 0 ? n : 1;
}

function serviceBadges(a) {
  const out = [];
  if (a.breakfast === 'ja')          out.push('🥐 Frühstück');
  if (a.interim_clean === 'ja')      out.push('🧹 Zwischenreinigung');
  const cot = parseInt(a.baby_cot);
  if (!isNaN(cot) && cot > 0)        out.push(`🛏️ Kinderbett${cot > 1 ? ' ×' + cot : ''}`);
  const chair = parseInt(a.high_chair);
  if (!isNaN(chair) && chair > 0)    out.push(`🪑 Hochstuhl${chair > 1 ? ' ×' + chair : ''}`);
  return out;
}

async function load() {
  const date = dateEl.value || todayVienna();
  listEl.innerHTML = '<div class="arr-empty">Wird geladen …</div>';
  let data;
  try {
    data = await (await fetch('/api/arrivals?date=' + encodeURIComponent(date))).json();
  } catch {
    listEl.innerHTML = '<div class="arr-empty">⚠️ Verbindungsfehler</div>';
    return;
  }

  const arr = data.arrivals || [];
  const isToday = date === todayVienna();
  titleEl.textContent = isToday ? 'Anreisen heute' : 'Anreisen am ' + fmtDE(date);
  countEl.textContent = arr.length ? `${arr.length} ${arr.length === 1 ? 'Anreise' : 'Anreisen'}` : '';

  if (!arr.length) {
    listEl.innerHTML = `<div class="arr-empty">Keine Anreisen an diesem Tag.</div>`;
    return;
  }

  // Nach Haus gruppieren (Reihenfolge wie geliefert)
  const houses = [];
  const map = new Map();
  arr.forEach(a => {
    const key = a.house_name || '–';
    if (!map.has(key)) { map.set(key, []); houses.push(key); }
    map.get(key).push(a);
  });

  listEl.innerHTML = houses.map(h => {
    const cards = map.get(h).map(a => {
      const badges = serviceBadges(a);
      return `
      <div class="arr-card">
        <div class="arr-card-top">
          <span class="arr-apt">${esc(a.apartment_name)}</span>
          <span class="arr-guest">${a.guest_name ? esc(a.guest_name) : 'Gast'}</span>
          <span class="arr-nights">${nights(a.start, a.end)} ${nights(a.start, a.end) === 1 ? 'Nacht' : 'Nächte'} · bis ${fmtDE(a.end)}</span>
        </div>
        <div class="arr-meta">
          ${a.persons ? `<span class="arr-badge">👥 ${esc(a.persons)}</span>` : ''}
          ${a.checkout_time ? `<span class="arr-badge">⏰ ab ${esc(a.checkout_time)} Uhr sauber</span>` : ''}
          ${badges.map(b => `<span class="arr-badge">${b}</span>`).join('')}
        </div>
      </div>`;
    }).join('');
    return `<div class="arr-house">🏠 ${esc(h)}</div>${cards}`;
  }).join('');
}

document.getElementById('arr-today').addEventListener('click', () => { dateEl.value = todayVienna(); load(); });
dateEl.addEventListener('change', load);

dateEl.value = todayVienna();
load();
setInterval(load, 5 * 60 * 1000); // alle 5 Min aktualisieren
