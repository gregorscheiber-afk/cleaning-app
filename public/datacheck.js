// ── Daten-Warnung der Import-Selbstkontrolle ──────────────────────
// Nach jedem Excel-Import vergleicht der Server Datei und Datenbank
// (GET /api/import-check). Diese Datei zeigt das Ergebnis als Warnbanner
// an – auf jeder Seite, die ein <div id="data-warning-container"> hat
// (Admin und Planer; die Putztrupp-Ansicht bewusst nicht).

async function checkImportWarning() {
  const container = document.getElementById('data-warning-container');
  if (!container) return;
  try {
    const res = await fetch('/api/import-check');
    const c = await res.json();
    if (!c || c.ok !== false) { container.innerHTML = ''; return; }

    const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
    const fmt = iso => { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}.${p[1]}.` : esc(iso); };
    const bk  = b => `${esc(b.apt)}: ${fmt(b.start)}–${fmt(b.end)}${b.gast ? ' (' + esc(b.gast) + ')' : ''}`;

    const lines = [];
    if (c.missing_total) {
      lines.push(`<strong>${c.missing_total} Buchung(en) aus der Excel fehlen in der App:</strong> ` +
        c.missing.map(bk).join(' · ') + (c.missing_total > c.missing.length ? ' …' : ''));
    }
    if (c.stale_total) {
      lines.push(`<strong>${c.stale_total} veraltete Buchung(en) in der App (stehen nicht mehr in der Excel):</strong> ` +
        c.stale.map(bk).join(' · ') + (c.stale_total > c.stale.length ? ' …' : ''));
    }
    if (c.unknown_codes && c.unknown_codes.length) {
      lines.push(`<strong>Unbekannte Zimmer-Codes in der Excel:</strong> ` +
        c.unknown_codes.map(esc).join(', ') +
        ' – fehlt dieses Apartment (PMS-Code) in der App?');
    }
    if (c.invalid_rows) {
      lines.push(`<strong>${c.invalid_rows} unlesbare Zeile(n)</strong> in der Excel übersprungen`);
    }
    if (c.apartments_not_in_file && c.apartments_not_in_file.length) {
      lines.push(`<strong>Apartments mit Buchungen in der App, aber ohne Zeilen in der Excel:</strong> ` +
        c.apartments_not_in_file.map(esc).join(', ') + ' (alles storniert – oder unvollständige Liste?)');
    }

    const when = c.checked_at
      ? new Date(c.checked_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '';

    container.innerHTML = `
      <div class="cleaning-alert-banner data-warning">
        <div class="cleaning-alert-icon">🚨</div>
        <div class="cleaning-alert-text">
          <div class="cleaning-alert-title">Daten-Warnung – der letzte Excel-Import stimmt nicht mit der App überein!</div>
          <div class="cleaning-alert-list">${lines.join('<br>')}<br><span style="opacity:.65">Zuletzt geprüft: ${when} Uhr</span></div>
        </div>
      </div>`;
  } catch { /* Warnung darf die Seite nie blockieren */ }
}
