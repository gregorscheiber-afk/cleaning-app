const db = require('../db');

function createInAppNotification(apartmentId, message) {
  db.prepare(
    `INSERT INTO notifications (apartment_id, message) VALUES (?, ?)`
  ).run(apartmentId, message);
}

async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Telegram nicht konfiguriert -> stiller no-op, In-App-Benachrichtigung reicht
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
  } catch (err) {
    console.error('Telegram-Benachrichtigung fehlgeschlagen:', err.message);
  }
}

async function notifyApartmentClean(apartment, cleanerName) {
  const message = `✅ ${apartment.name} wurde von ${cleanerName} als sauber bestätigt.`;
  createInAppNotification(apartment.id, message);
  await sendTelegramNotification(message);
}

module.exports = { notifyApartmentClean, createInAppNotification, sendTelegramNotification };
