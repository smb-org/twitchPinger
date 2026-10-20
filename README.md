# twitchPinger

Twitch-Chat-Trigger mit Benachrichtigung: Zuschauer melden sich per Twitch an, wählen Channels und definieren Regeln, die bei passenden Chatnachrichten eine Benachrichtigung auslösen – per ntfy, Discord-Webhook oder Discord-DM. Gedacht für Fälle wie „in diesem Channel wird gerade `!play` gespammt, ein Rennen ist offen".

## Funktionen

- Anmeldung mit Twitch, nur per Einladung (der Admin erzeugt Einladungslinks).
- Channel-Auswahl; ein zentraler, anonymer Chat-Leser joint jeden Channel genau einmal, egal wie viele Nutzer ihn abonnieren.
- Regeln pro Nutzer: Schlüsselwort, Regex oder Builder, Filter nach Badges und Login-Namen.
- Häufungsschwelle: Auslösung erst, wenn eine Mindestzahl verschiedener Chatter innerhalb eines Zeitfensters passt; einzelne Spammer lösen nichts aus.
- Cooldown pro Channel.
- Ziele: ntfy, Discord-Webhook, Discord-DM (Verknüpfung per Discord-Login).
- Test-Button pro Regel.
- Übersicht mit Cooldown-Status je Channel.
- Selbst hostbar mit Docker Compose: App, eigener ntfy-Server und Cloudflare-Tunnel.

## Architektur

Ein Node-24-Prozess: Hono-API, `node:sqlite` als Speicher, anonymer Chat-Leser über `@twurple/chat`, Regex über `re2js` (lineare Laufzeit). Die Oberfläche ist eine Preact/Vite-SPA, die der Server ausliefert. Es gibt genau einen Leser für alle Nutzer; Regeln werden im Speicher gegen jede Nachricht geprüft, das Häufungsfenster liegt im Speicher und beginnt nach einem Neustart leer, laufende Cooldowns überstehen den Neustart.

```
src/api      HTTP-API, Twitch-/Discord-Login, Sessions, Konfiguration
src/reader   Chat-Leser (twurple, oder fake für Tests)
src/rules    Matcher, Builder, Häufung
src/deliver  Zustellung (ntfy, Discord), SSRF-Schutz
src/db       SQLite, Backups
web          Preact-SPA
```

## Selbst hosten

### Voraussetzungen

- Docker mit Compose-Plugin.
- Eine Twitch-App ([dev.twitch.tv/console](https://dev.twitch.tv/console)) mit der Redirect-URL `<PUBLIC_URL>/api/auth/callback`.
- Optional, für Discord-DMs: eine Discord-App mit Redirect-URL `<PUBLIC_URL>/api/discord/callback` und einem Bot-Token.
- Ein Cloudflare-Tunnel mit zwei öffentlichen Hostnamen:
  - `pinger.example.com` → `http://app:12080`
  - `ntfy.example.com` → `http://ntfy:80`

### Schritte

1. Repo klonen und `.env` anlegen:
   ```sh
   git clone https://github.com/smb-org/twitchPinger.git
   cd twitchPinger
   cp .env.example .env
   ```
2. Werte in `.env` eintragen (siehe [Konfiguration](#konfiguration)), u. a. `PUBLIC_URL=https://pinger.example.com` und `NTFY_BASE_URL=https://ntfy.example.com`.
3. ntfy einrichten: Token und Passwort-Hash erzeugen, wie in [ntfy/README.md](ntfy/README.md) beschrieben. In `ntfy/server.yml` muss `base-url` auf deinen eigenen ntfy-Host zeigen (`NTFY_BASE_URL` aus der `.env` überschreibt den Wert zur Laufzeit, die Datei sollte trotzdem stimmen).
4. Starten. Das App-Image baut GitHub Actions bei jedem Push auf `main` (`ghcr.io/smb-org/twitchpinger:latest`, Tags auch als `:sha-…` und `:x.y.z`):
   ```sh
   docker compose pull && docker compose up -d
   ```
   Wer selbst bauen will: `docker compose up -d --build`.
5. Mit dem Twitch-Account anmelden, dessen User-ID in `ADMIN_TWITCH_USER_ID` steht – dieser Account wird Admin. Danach Einladungslinks erzeugen und an weitere Nutzer verteilen.

Der App-Port ist nur an `127.0.0.1:12080` gebunden; der Zugriff von außen läuft ausschließlich über den Tunnel. Daten (SQLite, Backups) liegen im Volume `app-data`. Backups lassen sich zusätzlich nach Cloudflare R2 hochladen.

## Konfiguration

Alle Variablen stehen kommentiert in [.env.example](.env.example). Im Produktivbetrieb (`NODE_ENV=production`) prüft die App die Pflichtvariablen beim Start.

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `PUBLIC_URL` | ja | Öffentliche URL der App, z. B. `https://pinger.example.com` |
| `SESSION_SECRET` | ja | Schlüssel für Session-Cookies, zufällig, mindestens 32 Zeichen |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | ja | Zugangsdaten der Twitch-App |
| `ADMIN_TWITCH_USER_ID` | ja | Twitch-User-ID des Admins |
| `NTFY_BASE_URL` | ja | Öffentliche Basis-URL des ntfy-Servers |
| `NTFY_APP_TOKEN` | für ntfy | Publisher-Token (`ntfy token generate`) |
| `NTFY_PINGER_PASS_HASH` | für ntfy | bcrypt-Hash (`ntfy user hash`), in einfache Anführungszeichen setzen |
| `TUNNEL_TOKEN` | für Compose | Token des Cloudflare-Tunnels |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN` | nein | Alle drei setzen, um Discord-DM-Ziele freizuschalten |
| `ADMIN_NTFY_URL` / `ADMIN_NTFY_TOKEN` | nein | ntfy-Topic und Token für Admin-Alarme |
| `MAX_ACCOUNTS` / `MAX_CHANNELS_TOTAL` / `MAX_CHANNELS_PER_USER` | nein | Limits, Standard 100 / 50 / 10 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | nein | Backup-Upload nach Cloudflare R2 |
| `PORT` | nein | HTTP-Port der App, Standard `12080` |
| `DATA_DIR` | nein | Datenverzeichnis, Standard `/data` |
| `INSECURE_COOKIES` | nein | `1` = Cookies ohne `Secure`, nur lokal über http |
| `READER` | nein | `twurple` (Standard) oder `fake` (Tests) |

## Entwicklung

Voraussetzung: Node ≥ 24.

```sh
npm install
```

Lokal gegen echtes Twitch: Twitch-Redirect `http://localhost:12080/api/auth/callback` eintragen und eine `.env.local` anlegen (nicht committen) mit mindestens:

```
PUBLIC_URL=http://localhost:12080
INSECURE_COOKIES=1
SESSION_SECRET=<mindestens 32 Zeichen>
TWITCH_CLIENT_ID=…
TWITCH_CLIENT_SECRET=…
ADMIN_TWITCH_USER_ID=…
NTFY_BASE_URL=…
DATA_DIR=./data-local
```

```sh
npm run build:web && node --env-file=.env.local src/main.ts
```

Feste Ports: `12080` App, `12173` Vite-Dev (`npm run dev:web`, mit `npm run dev:api` für die API).

| Befehl | Zweck |
|---|---|
| `npm test` | Unit- und Integrationstests (`node --test`) |
| `npm run typecheck` | TypeScript-Prüfung für API und Web |
| `npm run e2e` | Playwright-E2E mit Fake-Leser und Twitch-Mock |

## Sicherheit und Datenschutz

- Der Chat wird anonym gelesen; es gibt kein Bot-Token und keine Rechte in fremden Channels.
- Gespeichert werden nur Regeltreffer (Regel, Channel, Anzahl, Zeitpunkt, Zustellergebnis) – kein Chattext und keine IDs fremder Chatter.
- ntfy-Topics sind unratbar (`tp-` + 24 Zeichen); nur die App darf veröffentlichen, Standardzugriff ist `deny-all`.
- Webhook-Ziele sind gegen SSRF geschützt (private und reservierte Adressbereiche werden blockiert).
- Das Twitch-Token wird nur beim Login für Identität und Follow-Liste benutzt und nicht gespeichert; beim Discord-Login wird nur die verknüpfte Discord-ID samt Name abgelegt.
- Registrierung nur per Einladung; Zahl der Konten, Channels und Regeln ist begrenzt.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
