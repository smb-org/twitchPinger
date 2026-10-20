# ntfy-Server

Nur die App darf veröffentlichen; Abonnenten lesen unratbare Topics (`mn-` + 24 Zeichen).

- `server.yml`: `auth-default-access: deny-all`, ACL `marble` read-write und `everyone` read-only auf `mn-*`.
- `compose.yaml`: User `marble` und sein Token kommen aus `.env` (`NTFY_MARBLE_PASS_HASH`, `NTFY_APP_TOKEN`).

Einmalig einrichten:

1. Token erzeugen: `docker run --rm binwiederhier/ntfy token generate` (Format `tk_` + 29 Zeichen) -> `NTFY_APP_TOKEN`.
2. Passwort-Hash erzeugen: `docker run --rm -it binwiederhier/ntfy user hash` -> `NTFY_MARBLE_PASS_HASH` (in `.env` in einfache Anführungszeichen setzen, wegen der `$`).
3. Dieselbe Token für Admin-Alarme als `ADMIN_NTFY_TOKEN` eintragen; `ADMIN_NTFY_URL` zeigt auf ein `mn-…`-Topic.
4. `docker compose up -d ntfy`. Ein Neustart gleicht User, Token und ACL mit der Konfiguration ab.

Hinweis: Tokens gewähren aktuell vollen Account-Zugriff des Users `marble`; das Token nie weitergeben.
