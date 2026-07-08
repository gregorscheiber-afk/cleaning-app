# Reinigungs-App

Grundgerüst für die Bestätigung von Apartment-Reinigungen mit automatischem
Belegungsabgleich über iCal.

## Funktionsweise

- **Putzfrau-Ansicht** (`/`): zeigt nur Apartments mit Status *"muss geputzt werden"*.
  Ein Tap auf "Fertig – sauber" bestätigt die Reinigung.
- **Admin-Ansicht** (`/admin.html`): Übersicht aller Apartments mit Status,
  Live-Benachrichtigungen bei neuen Bestätigungen, und ein Formular zum
  Anlegen neuer Apartments (inkl. iCal-URL).
- **iCal-Sync**: läuft beim Start einmal und danach automatisch alle 15 Minuten
  (konfigurierbar über `SYNC_CRON` in `.env`). Holt die Buchungen jeder
  hinterlegten iCal-URL und berechnet daraus den Status:
  - **Belegt** – aktuell läuft eine Buchung
  - **Muss geputzt werden** – Checkout ist vorbei, noch nicht als sauber bestätigt
  - **Sauber** – frei und nach dem letzten Checkout bestätigt geputzt

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Dann im Browser öffnen:
- Putzfrau-Ansicht: http://localhost:3000/
- Admin-Ansicht: http://localhost:3000/admin.html

Die Datenbank (`data.db`, SQLite) wird beim ersten Start automatisch angelegt –
kein separater Datenbankserver nötig.

## iCal-URL eines Apartments hinterlegen

Jede Buchungsplattform (Airbnb, Booking.com, Smoobu, Hostaway, eigenes PMS, …)
bietet pro Unit eine iCal-Export-URL an (meist unter "Kalenderexport" oder
"Verfügbarkeit synchronisieren"). Diese URL trägst du beim Anlegen des
Apartments in der Admin-Ansicht ein. Mehrere Plattformen pro Apartment lassen
sich aktuell noch nicht kombinieren – das wäre der nächste Ausbauschritt
(siehe unten).

## Admin-Benachrichtigung per Telegram (optional)

Die App zeigt Bestätigungen bereits direkt in der Admin-Ansicht (Polling alle
8 Sekunden) an. Wer zusätzlich eine Push-Nachricht aufs Handy möchte:

1. Bei [@BotFather](https://t.me/BotFather) einen Bot anlegen, Token kopieren
2. Dem Bot einmal eine Nachricht schreiben
3. Chat-ID ermitteln: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` in `.env` eintragen, Server neu starten

## Mögliche nächste Schritte

- Login/Rollen (aktuell sind beide Ansichten offen ohne Auth)
- Mehrere iCal-Quellen pro Apartment (z. B. Airbnb + Booking.com gleichzeitig)
- Foto-Upload als Nachweis bei der Reinigungsbestätigung
- Push-Benachrichtigungen direkt im Browser (Web Push) statt Polling
- Deployment-Anleitung (z. B. Docker, Fly.io, Render)

## Projektstruktur

```
cleaning-app/
├── server.js              Express-App, Cron-Scheduler
├── db.js                  SQLite-Schema & Verbindung
├── routes/
│   ├── apartments.js      CRUD für Apartments, manueller Sync
│   └── cleanings.js       Reinigung bestätigen, Benachrichtigungen, Historie
├── services/
│   ├── icalSync.js        iCal laden, Buchungen abgleichen, Status berechnen
│   └── notify.js          In-App- & optionale Telegram-Benachrichtigung
└── public/
    ├── index.html / cleaner.js   Putzfrau-Ansicht
    └── admin.html / admin.js     Admin-Ansicht
```
