# Einladungskette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einmal-Links durch einen persönlichen, teilbaren Link pro Nutzer (5 Plätze, Admin unbegrenzt) ersetzen, Pyramiden-Punkte im Header zeigen und dem Admin die komplette Einladungskette als Eiszapfen + Stammbaum darstellen.

**Architecture:** Der Code hängt als Spalte `invite_code` an `users`; „belegte Plätze“ = Anzahl Nutzer mit `invited_by = ich`. Baum-/Punkte-Mathematik ist eine reine Funktion in `src/invite-tree.ts`, die Server (`/me`) und Web (Admin) gemeinsam importieren. Der Admin-Baum wird clientseitig aus `GET /admin/users` (hat schon `invitedBy`) gebaut.

**Tech Stack:** Node ≥ 24 (`node:sqlite`, `node --test`), Hono, Preact + Vite, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-invite-chain-design.md` – vor jeder Task lesen.

## Global Constraints

- UI-Texte deutsch, Ton wie DESIGN.md; keine internen Begriffe (Spec, Plan, Task, Etappe) in sichtbaren Texten.
- Nichts springt: feste Höhen/Platzhalter, Meldungen als Toast (`toast()` aus `web/src/ui.tsx`).
- Daten (Logins, Zahlen, Codes) in Mono (`class="mono"`), Farben nur über die CSS-Variablen aus `web/src/styles.css`.
- Bernstein (`var(--accent)`) im Admin-Baum für die längste Kette ist freigegeben – sonst kein Bernstein.
- Keine neuen Dependencies.
- Limit-Konstante: `MAX_INVITEES_PER_USER: 5` ersetzt `MAX_OPEN_INVITES`; `INVITE_TTL_DAYS` entfällt (in `src/types.ts`, `src/api/config.ts`, `web/src/api.ts`).
- Punkte: Σ über alle Nachfahren 1 / 2^(Tiefe − 1); gesperrte Nachfahren zählen mit; Anzeige eine Nachkommastelle mit deutschem Komma.
- Commits nach globaler Regel: `<icon> <type>(<modul>): summary`, englisch (Repo-History), Bullet-Body, **keine** Attribution-/Session-Trailer.

## Review Focus

1. Zwei Leute lösen gleichzeitig den 5. Platz ein → nur einer kommt rein, der andere bekommt `invite_full` (Check + Insert in einer Transaktion) – Test in Task 2.
2. Einlader wird gesperrt, nachdem der Link geteilt wurde → `invite_invalid`; nach Entsperren geht er wieder – Test in Task 2.
3. Bestehende Nutzer loggen sich mit einem alten/ungültigen `invite`-Parameter ein → normaler Login, keine Ablehnung – Test in Task 2.
4. `invitedBy` zeigt auf einen unbekannten Nutzer oder es gibt mehrere Wurzeln (Admin + Altnutzer ohne Einlader) → Baum baut ohne Absturz/Endlosschleife, unbekannte Eltern werden Wurzeln – Test in Task 1.
5. Kette mit 10+ Ebenen und lange Logins → Eiszapfen behält feste Höhe (scrollt intern), Labels werden abgeschnitten statt umzubrechen – Prüfung in Task 4 (e2e mobile + Augenschein).

---

### Task 1: Baum- und Punkte-Mathematik

**Files:**
- Create: `src/invite-tree.ts`
- Test: `src/invite-tree.test.ts`

**Interfaces:**
- Produces:
  - `interface TreeUser { id: string; invitedBy: string | null }`
  - `interface TreeNode<U extends TreeUser> { user: U; depth: number; children: TreeNode<U>[]; size: number /* Nachfahren, ohne sich selbst */; direct: number; points: number }`
  - `buildForest<U extends TreeUser>(users: U[]): TreeNode<U>[]` – Wurzeln = `invitedBy` null **oder** unbekannt **oder** Teil eines Zyklus; Kinder sortiert in Eingabe-Reihenfolge; `depth` der Wurzel = 0.
  - `pointsFor(users: TreeUser[], id: string): number`
  - `longestPath<U extends TreeUser>(roots: TreeNode<U>[]): Set<string>` – IDs entlang der tiefsten Kette (bei Gleichstand die erste).
  - `formatPoints(p: number): string` – `3.75 → "3,8"`, `0 → "0"`, `1 → "1"` (ganze Zahlen ohne „,0“).

- [ ] **Step 1: Failing tests schreiben** (`node:test` + `node:assert/strict` wie die übrigen `*.test.ts`)

```ts
const U = (id: string, invitedBy: string | null) => ({ id, invitedBy });
const chain = [U('a', null), U('b', 'a'), U('c', 'b'), U('d', 'c'), U('e', 'a')];

test('points halve per level', () => {
  assert.equal(pointsFor(chain, 'a'), 1 + 1 + 0.5 + 0.25); // b, e direkt; c Ebene 2; d Ebene 3
  assert.equal(pointsFor(chain, 'd'), 0);
});
test('forest sizes and direct counts', () => {
  const [a] = buildForest(chain);
  assert.equal(a.size, 4); assert.equal(a.direct, 2); assert.equal(a.children[0].depth, 1);
});
test('unknown parent and cycles become roots, no hang', () => {
  const f = buildForest([U('x', 'ghost'), U('p', 'q'), U('q', 'p'), U('r', null)]);
  assert.deepEqual(f.map((n) => n.user.id).sort(), ['p', 'r', 'x']); // q hängt unter p
});
test('longest path', () => {
  assert.deepEqual([...longestPath(buildForest(chain))], ['a', 'b', 'c', 'd']);
});
test('formatPoints', () => {
  assert.equal(formatPoints(3.75), '3,8'); assert.equal(formatPoints(2), '2'); assert.equal(formatPoints(0), '0');
});
```

Zyklusregel festgelegt: im Zyklus wird der Knoten mit der kleinsten Position in der Eingabeliste zur Wurzel (im Test `p`).

- [ ] **Step 2:** `node --test src/invite-tree.test.ts` → FAIL (Modul fehlt).
- [ ] **Step 3: Implementieren** in `src/invite-tree.ts`. Keine Imports außer Typen. `pointsFor` = `points` des Knotens aus `buildForest`.
- [ ] **Step 4:** `node --test src/invite-tree.test.ts` → PASS.
- [ ] **Step 5: Commit** zusammen mit `.superpowers/` in `.gitignore`.

```bash
git add src/invite-tree.ts src/invite-tree.test.ts .gitignore
git commit -m "✨ feat(invites): add invite tree and points math"
```

### Task 2: Backend – persönlicher Link, Plätze, Reset, Punkte in /me

**Files:**
- Modify: `src/db/db.ts` (neue Migration ans Ende von `MIGRATIONS`)
- Modify: `src/db/repo.ts` (users- und invites-Abschnitt)
- Modify: `src/api/app.ts` (`/auth/callback` ~Z.158–167, `/me` ~Z.230, Invite-Routen ~Z.478–503)
- Modify: `src/types.ts:28`, `src/api/config.ts:69-70`, `src/api/deps.ts:19`
- Modify: `web/src/pages/Login.tsx` (ERRORS)
- Test: `src/api/app.test.ts`, `src/db/db.test.ts`

**Interfaces:**
- Consumes: `pointsFor` aus Task 1.
- Produces (HTTP, von Task 3/4 genutzt):
  - `GET /api/invites` → `{ link: string; used: number; max: number | null; invitees: { login: string; createdAt: number }[] }` (`max` = `null` für Admin; `invitees` = nur direkt Geworbene, älteste zuerst)
  - `POST /api/invites/reset` → `{ link: string }` (neuer Code, alter sofort ungültig)
  - `GET /api/me` → zusätzlich `invites: { points: number; used: number; max: number | null }`; `counts.openInvites` entfällt.
  - Login-Fehlercode `invite_full`.
  - Repo: `getUserByInviteCode(code: string): UserRow | undefined`, `resetInviteCode(userId: string): string`, `countInvitees(userId: string): number`, `listInvitees(userId: string): { login: string; createdAt: number }[]`, `listInviteEdges(): { id: string; invitedBy: string | null }[]`. `UserRow` bekommt `inviteCode: string`.
  - Entfernt: `createInvite`, `getInviteByHash`, `listInvites`, `countOpenInvites`, `revokeInvite`, `markInviteUsed`, Routen `POST /invites` und `DELETE /invites/:id`, `InviteRow`.

- [ ] **Step 1: Failing tests schreiben.** Test-Helper in `app.test.ts` anpassen: `mkInvite(cookie)` holt `GET /invites` und gibt `{ code, link }` zurück (`code` = letzter Pfadteil von `link`); `join` bleibt sonst gleich. Alte Tests „valid invite … single-use“ und „invites: open limit …“ ersetzen durch:

```ts
test('personal link: reusable up to 5, then invite_full; admin unlimited', async () => {
  // admin wirbt alice; alice-Link von 5 verschiedenen Leuten eingelöst → alle /onboarding
  // 6. Person mit alice-Link → '/login?error=invite_full'
  // 6 Leute über Admin-Link → alle /onboarding
  // GET /invites als alice → used 5, max 5, invitees.length 5; als admin → max null
});
test('reset invalidates old code, keeps slots and invitees', async () => {
  // alice hat 2 geworben, POST /invites/reset → neuer link ≠ alter
  // alter Code → invite_invalid; neuer Code klappt; GET /invites used === 3
});
test('locked inviter: link invalid, works again after unlock', async () => {});
test('existing user logs in with a garbage invite param normally', async () => {
  // Location '/' statt Fehler
});
test('/me exposes invite points', async () => {
  // admin → alice → bob: admin.points 1.5, alice.points 1, bob.points 0; alice used 1 max 5
});
test('reset needs same-origin', async () => {
  // POST /invites/reset mit origin evil → 403 (wie bestehender CSRF-Test Z.152)
});
```

Race (Review Focus 1): Test, der zwei Callbacks für den 5. Platz per `Promise.all` startet → genau ein `/onboarding`, ein `invite_full`. In `db.test.ts`: Migration auf alter DB füllt `invite_code` für alle bestehenden Nutzer eindeutig und setzt offene `invites` auf `revoked = 1`.

- [ ] **Step 2:** `npm test` → neue Tests FAIL.
- [ ] **Step 3: Migration** (neuer Eintrag in `MIGRATIONS`):

```sql
ALTER TABLE users ADD COLUMN invite_code TEXT;
UPDATE users SET invite_code = lower(hex(randomblob(12)));
CREATE UNIQUE INDEX users_invite_code ON users(invite_code);
UPDATE invites SET revoked = 1 WHERE used_by IS NULL;
```

- [ ] **Step 4: Repo.** `createUser` setzt `invite_code = randomBytes(12).toString('hex')`; `resetInviteCode` gleiches Format. `lockUser` verliert die `invites`-Zeile (Sperre wirkt über `locked`).
- [ ] **Step 5: Callback.** Ersetzt den Invite-Block: `inviter = repo.getUserByInviteCode(st.invite)`; fehlt/gesperrt → `invite_invalid`; `MAX_ACCOUNTS` wie bisher; **innerhalb** `repo.tx`: wenn `!inviter.isAdmin && countInvitees(inviter.id) >= MAX_INVITEES_PER_USER` → `invite_full` (Transaktion ohne Insert verlassen), sonst `createUser({ …, invitedBy: inviter.id })`. Link-Form: `${config.publicUrl}/invite/${code}`.
- [ ] **Step 6: Routen + /me** wie unter Interfaces. `points` via `pointsFor(repo.listInviteEdges(), u.id)`.
- [ ] **Step 7: Login-Text** in `Login.tsx`: `invite_full: 'Über diesen Link sind schon alle Plätze vergeben – frag nach einem anderen Link.'`; `invite_used` und `invite_expired` entfernen.
- [ ] **Step 8:** `npm test && npm run typecheck` → PASS. (Typecheck schlägt im Web fehl, bis Task 3 die Seiten anpasst – dann `tsc --noEmit -p .` allein muss grün sein.)
- [ ] **Step 9: Commit**

```bash
git commit -am "✨ feat(invites): personal reusable invite link"
```

### Task 3: Web – Einladungsseite und Punkte im Header

**Files:**
- Modify: `web/src/api.ts` (`Limits`, `Me`, `InviteDto` → `InvitesDto`)
- Modify: `web/src/pages/Invites.tsx` (komplett neu)
- Modify: `web/src/shell.tsx` (`StatusStrip`, `.strip-user`)
- Modify: `web/src/styles.css`
- Test: `e2e/invite.spec.ts`

**Interfaces:**
- Consumes: HTTP aus Task 2; `formatPoints` aus `../../src/invite-tree.ts` (Web importiert `../../src/types.ts` schon genauso).
- Produces: `interface InvitesDto { link: string; used: number; max: number | null; invitees: { login: string; createdAt: number }[] }` in `web/src/api.ts`.

- [ ] **Step 1: e2e umschreiben** (`e2e/invite.spec.ts`, Test 1 bleibt):

```ts
test('personal link: admin shares, two users redeem, reset kills old link', async (...) => {
  // admin: /invites → code.url enthält '/invite/'
  // invitee_one und invitee_two lösen denselben Link ein → beide /onboarding
  // invitee_one: /invites zeigt 'noch 5 von 5 Plätzen frei' und eigenen Link
  // admin: Klick 'Neuen Link erzeugen' → 'Wirklich?' → Toast 'Neuer Link erzeugt'
  // invitee_three mit altem Link → /login?error=invite_invalid
  // admin: Header zeigt Punkte '2' (Element mit title beginnt 'Werbepunkte')
});
```

- [ ] **Step 2:** `npx playwright test e2e/invite.spec.ts` → FAIL.
- [ ] **Step 3: Invites-Seite.** Aufbau von oben nach unten, alles in festen Bereichen (bestehendes `slot slim`-Muster weiterverwenden):
  - `PageHead title="Einladungen"` mit Button **„Neuen Link erzeugen“** als `ConfirmButton` → `POST /invites/reset`, Toast `Neuer Link erzeugt`.
  - Link in `code.mono.url` + Button **„Kopieren“** (`copy()`); darunter `noch N von 5 Plätzen frei` bzw. Admin: `unbegrenzt`; bei 0 frei: `Alle Plätze vergeben` in `.muted`, Link bleibt sichtbar.
  - Liste „Geworben“: `@login` (mono) + Datum, leer: `Noch niemand über deinen Link dabei.`
- [ ] **Step 4: Header.** In `.strip-user` vor `@login`: `<span class="mono strip-points" title="Werbepunkte: 1 pro geworbener Person, ½ für deren Geworbene, ¼ eine Ebene tiefer …">◆ {formatPoints(me.invites.points)}</span>`. Feste `min-width` (z. B. `5ch`) gegen Springen; auf schmalen Screens sichtbar bleiben (nicht `hide-sm`). Farbe `var(--muted)`.
- [ ] **Step 5:** `npm run typecheck && npx playwright test` → PASS (inkl. `a11y.spec.ts`, `mobile.spec.ts`).
- [ ] **Step 6: Commit** `✨ feat(invites): personal link page and header points`

### Task 4: Admin – Einladungskette (Eiszapfen + Stammbaum)

**Files:**
- Create: `web/src/invite-chain.tsx`
- Modify: `web/src/pages/Admin.tsx` (neue `<section>` zwischen Channels-Sektion und Nutzerliste)
- Modify: `web/src/styles.css`
- Test: `e2e/invite.spec.ts` (neuer Test) bzw. bestehende Admin-e2e-Struktur

**Interfaces:**
- Consumes: `AdminUser` (hat `invitedBy`, `locked`, `login`) aus `web/src/api.ts`; `buildForest`, `longestPath`, `formatPoints` aus `src/invite-tree.ts`.
- Produces: `export function InviteChain({ users }: { users: AdminUser[] | undefined })`.

Verhalten (Referenz-Mockup: `.superpowers/brainstorm/29182-1792700929/content/chain-views.html`, Variante B oben + A darunter):

- [ ] **Step 1: e2e schreiben:** Admin wirbt `u1`, `u1` wirbt `u2`. Auf `/admin`: Sektion „Einladungskette“ sichtbar; Eiszapfen-Block `u1` (button, `aria-label` enthält Login und „Ast“) anklicken → Liste enthält `u1`, `u2`, aber nicht den Admin; Zeile `u1` zeigt direkt `1`, Ast `1`, Punkte `1`; Klick „Alle“ → Admin wieder in der Liste.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Eiszapfen.** Absolut positionierte Buttons (Breite ∝ `size + 1`), eine Zeile je Ebene (28 px), Ebenen-Label `E1…En` links in Mono. Container **feste Höhe** `min(Ebenen, 6) × 28 px`, darüber `overflow-y: auto`. Blöcke < 34 px ohne Text, Login als `title` + `aria-label`. Längste Kette: `color/border var(--accent)`. Gewählter Ast: heller Rahmen `var(--text)`. Platzhalter gleicher Höhe, solange `users` undefined.
- [ ] **Step 4: Stammbaum-Liste.** Zeilen eingerückt mit `├`/`│` in `var(--line)`, Auf-/Zuklapp-Toggle (`button`, `aria-expanded`), Pfad der längsten Kette initial offen, sonst bis Tiefe 2 offen. Rechte Spalten (fixe Breiten, Mono, rechtsbündig): **direkt** · **Ast** · **Punkte** + Balken (Breite relativ zum höchsten Punktwert der sichtbaren Liste, Farbe `var(--accent)`). Gesperrte: `.muted` + Suffix `gesperrt`. Kopfzeile: `N Nutzer · M Ebenen tief` und Button **„Alle“** (nur aktiv bei Ast-Filter).
- [ ] **Step 5:** `npm run typecheck && npx playwright test` → PASS; Augenschein bei 390 px Breite (Review Focus 5).
- [ ] **Step 6: Commit** `✨ feat(admin): show full invite chain`

---

## Self-Review-Notizen

- Spec-Abdeckung: Link/Plätze/Reset/Sperre/Migration → Task 2; Punkte → Task 1+2+3; Nutzerseite → Task 3; Admin-Baum → Task 4; Tests → je Task.
- `MAX_INVITEES_PER_USER` überall gleich benannt; `InvitesDto` ↔ `GET /invites` deckungsgleich.
