const { pool } = require('../db');

async function notifyApartmentClean(apartment, cleanerName) {
  const housePart = apartment.house_name ? ` - ${apartment.house_name}` : '';
  const message = `✅ ${apartment.name}${housePart} wurde gereinigt.`;
  await pool.query(
    `INSERT INTO notifications (apartment_id, message) VALUES ($1, $2)`,
    [apartment.id, message]
  );
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) {
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    }).catch(err => console.error('Telegram-Fehler:', err.message));
  }
}

module.exports = { notifyApartmentClean };
