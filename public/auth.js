// ── PIN-Schutz für alle drei Zugänge ──────────────────────────────
// Jede Seite ruft: requirePin('admin'|'planer'|'cleaner', onSuccess)

const PIN_LABELS = {
  admin:   { de:'Admin', hr:'Admin', tr:'Admin', en:'Admin' },
  planer:  { de:'Belegungsplan', hr:'Plan zauzetosti', tr:'Doluluk planı', en:'Occupancy plan' },
  cleaner: { de:'Reinigung', hr:'Čišćenje', tr:'Temizlik', en:'Cleaning' },
};

function requirePin(role, onSuccess) {
  const key = `ma_auth_${role}`;
  const stored = sessionStorage.getItem(key);

  // Bereits authentifiziert?
  if (stored === 'ok') { onSuccess(); return; }

  // PIN-Screen anzeigen
  const lang = localStorage.getItem('ma_lang') || 'de';
  const roleLabel = PIN_LABELS[role]?.[lang] || role;

  const overlay = document.createElement('div');
  overlay.id = 'pin-overlay';
  overlay.innerHTML = `
    <div class="pin-box">
      <svg class="lang-logo" viewBox="0 0 60 48" fill="none">
        <path d="M0 45 L12 21 L20 32 L30 9 L40 32 L48 21 L60 45 Z" fill="#c8963a"/>
      </svg>
      <div class="lang-brand">MYALPS</div>
      <div class="lang-sub">Homes · Ötztal</div>
      <div class="pin-role">${roleLabel}</div>
      <div class="pin-input-wrap">
        <input class="pin-input" id="pin-input" type="password"
               inputmode="numeric" pattern="[0-9]*"
               placeholder="PIN eingeben" maxlength="10" autocomplete="off"/>
        <button class="pin-btn" id="pin-submit">→</button>
      </div>
      <div class="pin-error" id="pin-error"></div>
    </div>`;

  document.body.appendChild(overlay);

  const input  = document.getElementById('pin-input');
  const errEl  = document.getElementById('pin-error');

  input.focus();

  async function tryPin() {
    const pin = input.value.trim();
    if (!pin) return;
    errEl.textContent = '';
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, role }),
      });
      if (res.ok) {
        sessionStorage.setItem(key, 'ok');
        overlay.style.animation = 'fadeOut .25s ease forwards';
        setTimeout(() => { overlay.remove(); onSuccess(); }, 250);
      } else {
        errEl.textContent = '✕ Falscher PIN';
        input.value = '';
        input.focus();
        overlay.querySelector('.pin-box').style.animation = 'shake .3s ease';
        setTimeout(() => overlay.querySelector('.pin-box').style.animation = '', 300);
      }
    } catch {
      errEl.textContent = 'Verbindungsfehler';
    }
  }

  document.getElementById('pin-submit').addEventListener('click', tryPin);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryPin(); });
}
