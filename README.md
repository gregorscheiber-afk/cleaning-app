# MYALPS Reinigungs-App

App zur Koordination von Apartment-Reinigungen. Die Buchungsdaten (Anreise,
Abreise, Gast, Personenzahl) kommen ausschließlich über den Excel-Import –
manuell in der Admin-Ansicht oder automatisch über make.com.

## Die drei Ansichten

- **Putztrupp** (`/`): Sprachauswahl (DE/HR/TR/EN), dann Hausauswahl. Zeigt pro
  Apartment Status, Reinigungszeit, Notizen und die nächsten Buchungen.
  Ein Tap auf "✓ Sauber" bestätigt die Reinigung. Ohne Login.
- **Planer** (`/planer.html`): Belegungsplan-Übersicht (Pläne "wiwa" und
  "mainstreet"), inkl. Warnung, wenn heute eine Anreise auf ein noch nicht
  gereinigtes Apartment trifft. Ohne Login.
- **Admin** (`/admin.html`): Häuser/Apartments verwalten, Notizen, Excel-Import,
  Benachrichtigungen, Reinigungs-Statistik. **PIN-geschützt** – der Admin-PIN
  wird zusätzlich serverseitig geprüft (HttpOnly-Cookie, 30 Tage gültig);
  alle schreibenden API-Endpunkte verlangen dieses Cookie.
- `/qrcodes.html`: QR-Codes zu den Ansichten zum Ausdrucken.

## Statusberechnung

Läuft beim Start und alle 5 Minuten (Zeitzone Europe/Vienna):

- **Muss geputzt werden** – Abreise vorbei und noch nicht als sauber
  bestätigt. Hat Vorrang, auch wenn am selben Tag ein neuer Gast anreist.
- **Belegt** – laufende Buchung (am Anreisetag erst ab 16:00 Uhr)
- **Sauber** – sonst

Die pro Apartment angezeigte Reinigungszeit (`checkout_time`, Standard 09:30)
ist die Info für den Putztrupp; intern wechselt der Status schon früh morgens.

## Setup

```bash
npm install
cp .env.example .env   # DATABASE_URL und PIN_ADMIN eintragen!
npm start
```

Benötigt PostgreSQL (`DATABASE_URL`), z. B. das Postgres-Addon auf Railway.
Tabellen werden beim ersten Start automatisch angelegt.

Wichtige Umgebungsvariablen (siehe `.env.example`): `PIN_ADMIN` (Pflicht,
sonst gilt ein unsicherer Standard-PIN), `PIN_PLANER`/`PIN_CLEANER` (derzeit
ungenutzt, Ansichten sind bewusst offen), `AUTO_IMPORT_TOKEN` (für make.com).

## Excel-Import

Zwei Wege:

1. **Manuell im Admin**: Datei hochladen (Parsing im Browser, SheetJS).
2. **Automatisch via make.com**: Excel-Datei als `multipart/form-data`
   (Feld `file`) an `POST /api/auto-import`, Header
   `Authorization: Bearer <AUTO_IMPORT_TOKEN>`. Antwort kommt sofort,
   der Import läuft im Hintergrund. Zeitpunkt des letzten Auto-Imports:
   `GET /api/last-import` (Admin).

Erkannte Formate:
- **Format A**: Kopfzeile mit "Zimmer" in Spalte B; Spalten Gast, Personen,
  Anreise (TT.MM.JJJJ), Abreise
- **Format B (PMS)**: Kopfzeile mit "Zi-Nr."; Aufenthalt kombiniert, z. B.
  `16.06. - 18.06.2026 (2)`

Zuordnung über den **PMS-Code** des Apartments. Jeder Import ersetzt alle
Nicht-manuellen Buchungen der betroffenen Apartments (Stornos verschwinden
automatisch); manuell angelegte Buchungen (`source='manual'`) bleiben.
Neue frühere Anreisen werden im Planer bis 19:00 Uhr hervorgehoben.

Zusätzlich gibt es `POST /api/import-structure` (Admin), um Häuser &
Apartments aus einer Excel-Liste anzulegen.

## Telegram-Benachrichtigung (optional)

1. Bei [@BotFather](https://t.me/BotFather) einen Bot anlegen, Token kopieren
2. Dem Bot einmal eine Nachricht schreiben
3. Chat-ID ermitteln: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` in `.env` eintragen, neu starten

## Projektstruktur

```
cleaning-app/
├── server.js              Express-App, Status-Cron
├── db.js                  PostgreSQL-Schema & Verbindung
├── routes/
│   ├── auth.js            PIN-Prüfung, setzt Admin-Cookie
│   ├── houses.js          CRUD Häuser (schreibend: Admin)
│   ├── apartments.js      CRUD Apartments (schreibend: Admin)
│   ├── cleanings.js       Reinigung bestätigen (offen), Historie/Stats (Admin)
│   ├── notes.js           Notizen (Admin)
│   ├── import.js          Excel-Import manuell (Admin) & auto (Token)
│   ├── bookings.js        Manuelle Buchungen, Personenzahl (Admin)
│   └── plan.js            Belegungsplan & Reinigungs-Warnung (offen)
├── services/
│   ├── auth.js            Cookie-Session & requireAdmin-Middleware
│   ├── icalSync.js        Statusberechnung (Name historisch – kein iCal mehr)
│   ├── cleaningAlert.js   "Anreise heute, aber nicht sauber"-Warnung
│   └── notify.js          In-App- & optionale Telegram-Benachrichtigung
└── public/
    ├── index.html / cleaner.js    Putztrupp (offen)
    ├── planer.html / planer.js    Belegungsplan (offen)
    ├── admin.html / admin.js      Admin (PIN + Cookie)
    ├── auth.js                    PIN-Bildschirm
    ├── qrcodes.html               QR-Codes zum Ausdrucken
    └── i18n.js / style.css        Übersetzungen & Styles
```
