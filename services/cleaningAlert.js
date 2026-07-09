const { pool } = require('../db');

async function getUncleanBeforeCheckin() {
  const today = new Date().toISOString().substring(0, 10);
  const { rows } = await pool.query(`
    SELECT DISTINCT a.id, a.name, h.name as house_name
    FROM apartments a
    LEFT JOIN houses h ON h.id = a.house_id
    JOIN bookings b ON b.apartment_id = a.id
    WHERE LEFT(b.start, 10) = $1
    AND a.status != 'sauber'
    ORDER BY h.name, a.name
  `, [today]);
  return rows;
}

async function sendCleaningAlert() {
  try {
    const apartments = await getUncleanBeforeCheckin();
    if (!apartments.length) {
      console.log('15:50 Check: Alle Apartments mit heutiger Anreise sind sauber ✓');
      return;
    }

    const list = apartments.map(a =>
      `• ${a.house_name ? a.house_name + ' – ' : ''}${a.name}`
    ).join('\n');

    const message =
      `⚠️ REINIGUNGSALARM – 15:50 Uhr\n\n` +
      `Folgende Apartments haben heute Anreise und sind noch NICHT als sauber bestätigt:\n\n` +
      `${list}\n\n` +
      `Bitte sofort nachprüfen!`;

    console.log('Reinigungsalarm:', message);

    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
      console.log('Telegram-Alarm gesendet.');
    } else {
      console.warn('Telegram nicht konfiguriert – bitte TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID setzen.');
    }
  } catch(err) {
    console.error('Reinigungsalarm fehlgeschlagen:', err.message);
  }
}

module.exports = { getUncleanBeforeCheckin, sendCleaningAlert };
