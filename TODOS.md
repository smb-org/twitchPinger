# TODOS

## Zustellung

### Web Push (PWA) als drittes Benachrichtigungsziel

**What:** Web Push neben Discord und ntfy als Ziel anbieten.

**Why:** Push aufs Handy/Desktop ohne Extra-App (ntfy-App entfällt für Android/Desktop).

**Context:** In der Eng Review am 2026-10-19 aus v1 genommen (D9), um v1 schlank zu halten. Festlegungen aus dem Review: Service Worker + Manifest, VAPID-Schlüssel aus Env, `web-push` mit explizitem `{agent}` über den gemeinsamen SSRF-Sende-Helfer, Endpunkt-Host-Allowlist (FCM, Mozilla, Apple, Windows) plus IP-Prüfung, 404/410 löscht das Abo und markiert das Ziel als abgelaufen, iOS-Hinweis „nur als installierte App". Details: `docs/designs/marble-notification.md`.

**Effort:** M
**Priority:** P3
**Depends on:** v1 (Discord + ntfy) live
