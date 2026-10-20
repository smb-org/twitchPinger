---
# gstack: design-md-format=spec
name: marbleNotification
description: Ruhige Leitwarte am Abend. Still, solange nichts passiert; Bernstein, wenn ein Rennen offen ist.
colors:
  background: "#141a24"
  surface: "#1b2230"
  line: "#2a3342"
  text: "#e8ebf0"
  text-muted: "#9aa4b2"
  accent: "#f2a93b"
  on-accent: "#141a24"
  primary: "#e8ebf0"
  on-primary: "#141a24"
  success: "#5fbf8a"
  error: "#ef6b5e"
  warning: "#f2a93b"
typography:
  display:
    fontFamily: General Sans
    fontWeight: 600
    fontSize: 1.75rem
    letterSpacing: -0.01em
  body:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 1rem
    lineHeight: 1.5
  label:
    fontFamily: Atkinson Hyperlegible Next
    fontWeight: 500
    fontSize: 0.875rem
    letterSpacing: 0.01em
  mono:
    fontFamily: JetBrains Mono
    fontFeature: tnum
rounded:
  sm: 4px
  md: 6px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "#ffffff"
  input:
    borderColor: "{colors.line}"
    rounded: "{rounded.md}"
  nav-link:
    textColor: "{colors.text-muted}"
  nav-link-active:
    textColor: "{colors.text}"
    backgroundColor: "{colors.surface}"
---

# marbleNotification

## Overview

**Creative North Star:** Eine ruhige Leitwarte am Abend. Wer marbleNotification öffnet, soll sofort spüren: „Ich verpasse nichts mehr."
**Product context:** Einladungsbasiertes Werkzeug für bis zu 100 Twitch-Viewer. Regeln erkennen Chat-Auslöser (z. B. `!play`) in bis zu 50 Channels und melden per ntfy/Discord. Genutzt abends am PC neben dem Stream, kurz am Handy.
**Mode per surface:** Alle Seiten sind Operate (Übersicht, Regel-Editor, Channels, Ziele, Einladungen, Admin). Die Einladungsseite ist ein kurzer Persuade-Moment, bleibt aber im selben System.
**Reference:** Mockups unter `~/.gstack/projects/marbleNotification/designs/` (rule-builder-20261020/v1.jpg, design-system-20261020/a.jpg).
**Key characteristics:**
- Monochrom und still, bis etwas passiert.
- Bernstein ist ein Signal, keine Dekoration.
- Daten (Namen, Zeiten, Chat, Regex) in Mono, alles andere in einer lesbaren Grotesk.
- Nichts springt: feste Statuszeile, feste Panels, Meldungen als Toast.

## Colors

**Strategy:** Restrained. Neutrals aus dem Tintenblau, genau ein Akzent.
**Light or dark:** Dunkel, weil man abends neben dem Stream am Bildschirm sitzt. Kein heller Modus in v1.
`accent` bedeutet ausschließlich „es passiert gerade etwas": Treffer in der Vorschau, ausgelöste Regel (Glut), Statuszeile „verbinde neu". Primäre Aktionen nutzen `primary` (hell auf Neutral), nie Bernstein. `warning` teilt den Farbton mit `accent` und wird immer mit Text oder Symbol kombiniert. Alle Text-Kombinationen erreichen auf `background` und `surface` mindestens 4,5:1 (text 14,6, muted 6,9, accent 8,7, error 5,8, success 7,7). Status nie nur über Farbe: Punkt + Wort, Treffer = Farbe + Unterstreichung.

## Typography

- **Display:** General Sans 600, nur für Seitentitel (H1). Quelle: Fontshare, selbst gehostet.
- **Body/UI:** Atkinson Hyperlegible Next 400/500/700, gewählt für Lesbarkeit und unterscheidbare Zeichen (Il1, O0). Google-Fonts-Familie, selbst gehostet (OFL).
- **Mono:** JetBrains Mono 400/500 mit `tnum` für Chatzeilen, Benutzernamen, Channel-Logins, Zeiten, Zähler und Regex. Selbst gehostet (OFL).
- Skala: H1 1.75rem, H2 1.25rem, Body 1rem, Label 0.875rem, Mono-Daten 0.9375rem. Body nie unter 16 px.
- Keine Anfrage an Google oder Fontshare zur Laufzeit; Dateien liegen im SPA-Build, `font-display: swap`.

## Layout

- Ab 768 px: Navigationsleiste links (240 px), oben feste Statuszeile (40 px), Arbeitsfläche mit max. 1440 px.
- Regel-Editor: Formular links, Vorschau rechts (je 50 %), beide mit fester Höhe und eigenem Scrollen.
- Übersicht: Regeltabelle links, „Letzte Pings" rechts (360 px).
- Unter 768 px: Navigation als untere Leiste (4 Einträge, 44 px), Statuszeile bleibt oben, Regel-Editor mit Tabs „Regel | Vorschau (n)".
- Listenzeilen 40 px hoch, Abstände im 4-px-Raster; Aktionen stehen über wachsenden Listen.

## Elevation & Depth

Keine Schatten. Tiefe entsteht nur über Flächen (`background` → `surface`) und 1-px-Linien (`line`). Kein Glow, kein Halo, keine Verläufe.

## Shapes

Radius 6 px (`md`) nur an Eingaben und Buttons, 4 px (`sm`) an Chips/Bausteinen, `full` nur für Statuspunkte. Tabellen, Panels und Listen haben keine Rundung und keine Karten-Rahmen.

## Components

- **Button primär:** `primary`-Fläche, `on-primary`-Text; hover heller; focus-visible 2 px Ring in `accent` mit 2 px Abstand; disabled 40 % Deckkraft plus erklärender Text daneben.
- **Builder-Baustein:** Button mit `line`-Rahmen, Inhalt in Mono; ausgewählt: `text`-Rahmen; per Tab erreichbar, Entf entfernt, Pfeiltasten verschieben.
- **Regelzeile:** Name (Body), Channels/Zeiten (Mono), Status als Punkt + Wort. Ausgelöst: Glut (siehe Motion).
- **Statuszeile:** immer sichtbar, feste Höhe; neutral „verbunden", `warning` „verbinde neu", `error` „getrennt seit …"; `aria-live=polite`.
- **Toast:** unten rechts (Mobile: über der unteren Leiste), überlagert, schiebt nichts.
- **Fehlerzeile unter Feldern:** feste reservierte Höhe, auch wenn leer.
- **Browser-Elemente:** `::selection` in `accent` mit `on-accent`, Caret in `accent`, Scrollbars in `line`/`surface`, `color-scheme: dark`.

## Do's and Don'ts

- Do: Bernstein nur für Ereignisse verwenden.
- Do: jede Meldung in einen reservierten Bereich oder als Toast setzen.
- Do: alle Daten in Mono mit `tnum` setzen.
- Do: Status immer mit Wort, nie nur mit Farbe zeigen.
- Don't: Karten, Schatten, Glow oder Verläufe.
- Don't: Bernstein für Buttons oder den aktiven Navigationseintrag.
- Don't: ganze Zeilen oder UI-Texte in Mono.
- Don't: Twitch-Lila oder Murmel-Illustrationen als Dekoration.

## Motion

- **Approach:** minimal-funktional.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(80ms) short(200ms) medium(300ms) long(1200ms nur Glut)
- **The one authored moment:** die Glut. Feuert eine Regel, füllt sich ihre Zeile flächig mit `accent` (ca. 24 % Deckkraft) und klingt in 1,2 s auf transparent ab. Kein Glow, kein Blinken. `prefers-reduced-motion`: sofortiger Farbwechsel, nach 1,2 s zurück.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-20 | Initial design system created | /design-consultation auf Basis von Office Hours, Eng- und Design-Review sowie freigegebenem Mockup A; Anker „Ich verpasse nichts mehr" |
| 2026-10-20 | Bernstein nur für Ereignisse, Primärbutton neutral | Akzent wird zum verlässlichen Signal |
| 2026-10-20 | Glut als einziger Motion-Moment | macht „da war was" spürbar ohne Unruhe |
| 2026-10-20 | Mono nur für Daten | Daten wirken präzise, UI bleibt lesbar |
