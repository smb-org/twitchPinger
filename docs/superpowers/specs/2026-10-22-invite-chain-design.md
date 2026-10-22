# Einladungskette: persönliche Links, Pyramiden-Punkte, Admin-Baum

Stand: 2026-10-22 · Status: Entwurf zur Freigabe

## Warum

twitchPinger soll sich weiter verbreiten, und der Admin will nachvollziehen,
über welche Wege die Leute reingekommen sind – auch bei langen Ketten
(A lädt B ein, B lädt C ein, … zehn Ebenen tief).

Heute: Jeder Nutzer kann bis zu 5 offene **Einmal-Links** erzeugen (7 Tage
gültig). Wer wen eingeladen hat, steht schon in `users.invited_by`, wird aber
nirgends angezeigt. Ein im Chat geteilter Link bringt nur die erste Person
rein – das bremst die Verbreitung.

## Ziele

1. **Ein persönlicher, teilbarer Link pro Nutzer** statt Einmal-Links.
   Normale Nutzer: die ersten **5 Einlösungen insgesamt** zählen, danach ist
   der Link voll. Admin: unbegrenzt.
2. **Pyramiden-Punkte im Header** jedes Nutzers als einziger Anreiz.
3. **Admin sieht die komplette Einladungskette**: Eiszapfen-Übersicht oben,
   darunter Stammbaum-Liste des gewählten Asts.

## Nicht-Ziele

- Keine Belohnungen außer der Zahl (keine Freischaltungen, keine Rangliste).
- Nutzer sehen **nicht** den Baum – auch nicht ihren eigenen Ast. Nur die Zahl.
- Kein Wiederauffüllen von Plätzen (5 ist 5, für immer).

## Anti-Ziele

- Die Seite darf nicht springen (siehe DESIGN.md / globale UI-Regel): der
  Eiszapfen hat eine feste Höhe, die Liste darunter tauscht nur ihren Inhalt,
  Meldungen als Toast.
- Kein Spam-Tor: ein geleakter Link darf nicht unbegrenzt Leute reinlassen
  (abgedeckt durch 5 Plätze, Reset-Button und das bestehende `MAX_ACCOUNTS`).

## Entscheidungen von sb

| Thema | Entscheidung |
|---|---|
| Link-Art | Ein persönlicher Link pro Nutzer, mehrfach einlösbar, 5 Plätze; Admin unbegrenzt |
| „5“ heißt | 5 Geworbene insgesamt, verbrauchte Plätze kommen nicht zurück |
| Sichtbarkeit Baum | Nur Admin |
| Header-Zahl | Pyramiden-Punkte (nicht „x/5“) |
| Link in falschen Händen | Nutzer kann neuen Link würfeln, alter wird sofort ungültig |
| Bernstein im Baum | Längste Kette im Admin-Baum in Bernstein – bewusste Ausnahme von DESIGN.md, nur dort |
| Admin-Darstellung | Variante C: Eiszapfen als Übersicht, Klick auf einen Ast filtert die Stammbaum-Liste darunter; rechts in jeder Zeile **direkt · Ast · Punkte (mit Balken)** |

Mockup der Varianten: `.superpowers/brainstorm/29182-1792700929/content/chain-views.html`
(nicht eingecheckt; Variante A liefert die Zeilen, B die Übersicht).

## Verhalten im Detail

### Persönlicher Link

- Jeder Nutzer hat genau einen aktiven Code. Er wird beim ersten Aufruf der
  Einladungsseite (oder beim Anlegen des Nutzers) erzeugt. Gespeichert wird
  wie heute nur der SHA-256-Hash; der Klartext-Code muss aber **dauerhaft
  wieder anzeigbar** sein, weil der Nutzer ihn jederzeit kopieren will.
  → *Meine Entscheidung:* Code im Klartext speichern ist hier vertretbar
  (der Link ist zum Teilen gedacht, Schaden begrenzt durch 5 Plätze + Reset).
  Als Spalte an `users` (z. B. `invite_code`, UNIQUE). Keine HMAC-Ableitung
  aus `sessionSecret` – sonst ändern sich alle Links bei Secret-Rotation.
- URL-Form bleibt `/invite/<code>`, der Login-Flow (`/auth/login?invite=…`,
  signierter OAuth-State) bleibt unverändert.
- **Neu würfeln:** Button auf der Einladungsseite (mit Bestätigung wie die
  bestehenden `ConfirmButton`s). Alter Code sofort ungültig. Bereits
  Geworbene und verbrauchte Plätze bleiben – Plätze zählen pro Nutzer, nicht
  pro Code.
- **Plätze:** belegte Plätze = Anzahl Nutzer mit `invited_by = ich`.
  Einlösung wird abgelehnt, wenn das ≥ 5 ist (neuer Fehlercode z. B.
  `invite_full`, Login-Seite braucht dafür einen Text). Admin: kein Limit.
  Check und Anlegen in derselben Transaktion wie heute (`repo.tx`).
- `MAX_ACCOUNTS` gilt weiter zusätzlich.
- **Gesperrter Nutzer:** sein Link funktioniert nicht mehr (heute widerruft
  `lock` offene Einladungen – gleiches Verhalten). Entsperren macht ihn
  wieder gültig. *(Meine Entscheidung.)*
- Das 5er-Limit ersetzt `MAX_OPEN_INVITES` (umbenennen/umdeuten, z. B.
  `MAX_INVITEES_PER_USER = 5`); `INVITE_TTL_DAYS` entfällt – persönliche
  Links laufen nicht ab. *(Meine Entscheidung.)*

### Migration

- Neue DB-Migration in `src/db/db.ts` (Schema ist versioniert über
  `user_version`).
- Bestehende **offene Einmal-Links werden in der Migration widerrufen.**
  Damit entfallen der alte Lookup im Callback, `markInviteUsed`,
  `GET/DELETE /invites` samt alten Tests; die `invites`-Tabelle bleibt
  einfach stehen. *(Meine Entscheidung – bei ≤ 100 Nutzern egal, so ist es
  der kleinere Code.)*
  Wer schon über alte Links geworben hat, dem zählen diese Leute als belegte
  Plätze (folgt automatisch aus `invited_by`).

### Pyramiden-Punkte

- Ebene 1 (direkt geworben) = 1 Punkt, Ebene 2 = ½, Ebene 3 = ¼, …,
  also Σ über alle Nachfahren von 1 / 2^(Tiefe − 1).
- Gesperrte Nachfahren zählen mit (die Kette ist trotzdem passiert).
  *(Meine Entscheidung.)*
- Anzeige mit einer Nachkommastelle, deutsches Komma („3,8“), in Mono.
  Kleiner Tooltip/`title`: „1 Punkt pro geworbener Person, ½ für deren
  Geworbene, ¼ eine Ebene tiefer …“.
- Header: feste Breite reservieren, damit nichts springt; auf dem Handy
  muss es neben dem bestehenden Header-Inhalt Platz haben (ggf. nur Zahl +
  kleines Icon).
- Berechnung: bei ≤ 100 Nutzern einfach alle `(id, invited_by)` laden und im
  Speicher rechnen; kommt über `GET /me` mit (z. B. `invites: { points,
  used, max }`).

### Einladungsseite (`web/src/pages/Invites.tsx`) – Nutzer

Ersetzt die Liste der Einmal-Links durch:

- den persönlichen Link + „Kopieren“,
- „noch N von 5 Plätzen frei“ (Admin: „unbegrenzt“),
- Liste der direkt Geworbenen (Login + Datum) – nur Ebene 1, kein Baum,
- „Neuen Link erzeugen“ mit Bestätigung.

Wenn alle Plätze voll sind: Link-Feld bleibt stehen (kein Springen), aber
deutlich als voll markiert.

### Admin-Bereich (`web/src/pages/Admin.tsx`)

Neue Sektion „Einladungskette“ im Stil der bestehenden `admin-channels`-
Sektion.

- **Eiszapfen (oben, feste Höhe):** Wurzel ist der Admin (bzw. alle Nutzer
  ohne `invited_by`). Jede Zeile = eine Ebene (E1, E2, …), Breite eines
  Blocks ∝ Größe seines Asts. Längste Kette in Bernstein (Akzent ist laut
  DESIGN.md ein Signal – hier vertretbar als „das ist die interessanteste
  Spur“). Bei vielen Ebenen: feste Maximalhöhe, darin vertikal scrollbar.
  Schmale Blöcke ohne Label, Name per `title`/Tooltip.
- **Klick auf einen Block** wählt diesen Ast: Block hervorgehoben, Liste
  darunter zeigt nur diesen Ast. Klick auf Wurzel bzw. „Alle“ setzt zurück.
- **Stammbaum-Liste (darunter):** eingerückt mit Linienführung, Äste
  auf-/zuklappbar, Namen in Mono. Rechte Spalten: **direkt**, **Ast**
  (Anzahl aller Nachfahren), **Punkte** mit kleinem Balken. Gesperrte Nutzer
  ausgegraut mit Hinweis. Pfad zur längsten Kette standardmäßig aufgeklappt.
- Datenquelle: `GET /admin/users` liefert schon `invitedBy`; Baum, Ast-Größen
  und Punkte können clientseitig berechnet werden. Rechenfunktion als reine
  Funktion, die Server (Header-Punkte) und Client teilen, wenn das ohne
  Verrenkung geht; sonst doppelt, aber mit einem Test.
- Eingebunden über der bestehenden Nutzerliste oder als eigener Tab –
  dem Builder überlassen, solange die Nutzerliste nicht nach unten
  springt, wenn der Baum lädt (Platzhalter mit fester Höhe).

## Tests

- Einlösen: 5 klappt, 6. wird mit `invite_full` abgelehnt; Admin unbegrenzt;
  derselbe Link für mehrere Personen; nach Reset ist alter Code ungültig,
  belegte Plätze bleiben; gesperrter Einlader → Link ungültig.
- Punkte-Funktion: kleiner Unit-Test mit einer tiefen Kette.
- `e2e/invite.spec.ts` an den neuen Ablauf anpassen (der heutige
  „reuse fails“-Teil kehrt sich um).

## Dem Builder überlassen

- Genaues Tabellen-/Spaltenlayout für den Code (eigene Tabelle vs. Spalten
  an `users`), Klartext vs. HMAC-Ableitung (siehe oben).
- Ob die Eiszapfen-Darstellung als SVG oder absolut positionierte Divs.
- Exakte Texte, solange sie DESIGN.md-Ton treffen und keine internen
  Begriffe enthalten.
