# Results: F3, the shell, the sidebar and the type pair

Plan: `PLAN-feishin-shell-2026-10-20.md` with its addendum (kept outside the repo, in the F3 context package). Branch `redesign/shell`, cut from
`origin/feat/redesign` at `c58c0b5` (contains F1's `ae8e15f3` and F2, PR #4). The harness checked out `feat/redesign` itself; since nothing may be pushed
there, the work is on a new branch cut from that same commit. Written 2026-10-21 at the end of the branch.

One session ran the plan inline (`executing-plans`), tasks 1 to 7, then 9, then 8, one commit each. One fresh whole-branch review follows; its
findings, the fixes, the rulings and the deferred minors are appended at the end of this note.

## Gates

| Check | Baseline (`c58c0b5`) | Final |
|---|---|---|
| `tsc -p tsconfig.web.json` (TS6307 filtered) | clean | clean |
| `tsc -p tsconfig.node.json` | clean | clean |
| eslint `--max-warnings=0`, every changed TS/TSX file (25) | - | clean |
| stylelint, every changed CSS file (15) | - | clean |
| The 41 existing harnesses (F1's `device-rows` 21, F2's five, and the rest) | 717 pass, 0 fail | 717 pass, 0 fail |
| `sidebar-groups.harness.ts` (new) | - | 17 pass (15 at Task 2, two added by the review's fixes) |
| `sidebar-widths.harness.ts` (new) | - | 3 pass |
| `font-migration.harness.ts` (new) | - | 4 pass |
| `pnpm build:remote` | - | exit 0, emits the four new woff2 |
| `pnpm build:web` | - | exit 0, emits the four new woff2 |

44 harness files, 741 pass, 0 fail after the review's fixes (739 before them), run by hand (`node --test --test-reporter=tap <file>`); CI does not run them. Node here was 22.22. Every new harness
was seen to fail (`ERR_MODULE_NOT_FOUND`) before its module existed; `sidebar-groups` was also mutated (dedupe off, `gaveUp` counted) and went red in
3 cases before the code was restored.

**Install.** `pnpm install --frozen-lockfile` cannot finish in this container: the egress proxy answers 403 for `codeload.github.com`, which serves the
two git-hosted packages (`node-mpv`, `@electron/node-gyp`). They were cloned at their pinned commits over git and installed through a temporary,
uncommitted pnpm override; `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` were restored byte for byte. The lockfile is untouched.

## Watched running

`electron-vite dev` under Xvfb, driven over CDP with the package's `cdp.mjs` and `measure-layout.js`, against the package's stand-in server
(`--playlists 60`) behind a small scratch front that answers `getUser.view`, empty Subsonic and Navidrome lists and `getScanStatus`. No music
server, no hub, no lb-bot, no real library. The gates were flipped by setting `hub.store` and the fills ledger from the page; songs were put into the
player store directly; covers are the stand-in's fixtures. The Electron window itself is 885 x 900, so a check without `--size` is at the fold.

### The window, heights and cards (Tasks 1 and 9)

`measure-layout.js` on Home, an album page (its error state), the Tracks list, Settings, a playlist and the full-screen player, at 800 x 600,
1100 x 800, 1280 x 600, 1280 x 800 and 2560 x 1440, for the `windows`, `linux` and `macos` window-bar styles: 90 measurements, queue panel open.

| | Before (`c58c0b5`, windows bar) | Final, windows and macos bar | Final, linux bar |
|---|---|---|---|
| rows at 1280 x 800 | bar 0-30, page and sidebar 30-710, player 710-800 | bar 0-30, top bar 30-82, cards 82-702, player 710-800 | top bar 0-52, cards 52-702, player 710-800 |
| document scrolls | never (25 of 25) | never (60 of 60) | never (30 of 30) |
| horizontal overflow | never | never | never |
| sidebar bottom to bar | 0 | 8 at every size | 8 at every size |
| card gaps (left, sidebar/page, page/queue, right, under) | 0 | 8 / 8 / 8 / 8 / 8 in all 90 | 8 / 8 / 8 / 8 / 8 |
| vertical scrollers | the sidebar list, the page | the sidebar list, the queue list, the page | same |

No second scrollbar anywhere: the scrollers are the sidebar's list, the queue panel's list and the page's own scroller (Home's native scroll area,
Settings' and Tracks' scroll areas).

The `cards` block by queue mode at 1280 x 800 and 2560 x 1440, `Cover colours` on and off (20 measurements): radius 10px on the sidebar, the page and
the queue panel; 8 between every pair and at both window edges and under the cards; **8, not 16, on the right in drawer mode** (the page ends at 1272
of 1280); in the vertical layout the page ends at 374 and the queue starts at 382; the rail (not a card) has radius 0. Before: all 0.

Other window states, watched: the login and action-required shell draws no top bar and no cards (rows 30 / 0 / 680 / 90, `--panel-gap` 0, no padding, measured after the cards); the four window-bar
styles all add up (windows and macos 30 + 52 + 628 + 90, linux and web 0 + 52 + 658 + 90 at 1280 x 800 before the cards); the full-screen player and
the full-screen visualizer cover 0-1280 x 82-710, the gaps included, below the top bar.

### The top bar (Task 1)

Search opens the command palette on click, Enter, Space and `Ctrl K` (the palette's state read closed, then open, each time); the hint reads `Ctrl K`
for the default binding; the view menu opens with its 7 items; back and forward move through the history (`#/` to `#/settings` and back); the menu
icon spins while a scan runs (the front answered `scanning: true`) and stops after; drawer mode's queue popover still opens from the bar.

### The sidebar (Task 3)

| State | Groups seen (1280 x 800) |
|---|---|
| lb-bot absent | Home, Library (9 children + Mixed for You); Listening: Saved queues; App: Settings |
| lb-bot present | Home, Library (+ Discover, Mixed for You), Fresh; You: Needs attention, Activity; Listening: Statistics, Saved queues; Library tools: Library Matches; App: Settings |
| listening unsupported | as present, without Statistics |
| overrides not advertised | as present, without Library tools |
| hub down | Home, Library (9 children); Listening: Saved queues; App: Settings |
| 1100 px and under | Home, Library, Fresh; You; More (Statistics, Saved queues, Library Matches, Settings, each a link) |

- **The badge:** with five ledger rows (settled failed, settled needsPick, settled gaveUp, settled cancelled, unsettled failed) it reads **2**
  (accessible name "Needs attention, 2"); after dismissing the failed one, **1**.
- **Selection:** on `/downloads` only Activity is selected; Needs attention never is.
- **Icons:** every row has its own; only Home wears Home's (Library books, Needs attention a triangle, Activity a clock).
- **The fold:** at 1101 px no More, at 1100 and 1000 px More; a marked node in the page and the page's scroll offset survived crossing the fold.
- **A short column:** at 1280 x 600 with every group the column is 428 tall for 517 of content and scrolls as a whole, Settings reachable; at
  800 x 600 the fold makes it fit (428 of 428).
- **60 playlists** (all under Shared Playlists, the stand-in's owner is not the user): 60 rows, the list scrolls, the 40-character names truncate with an
  ellipsis (124 px shown of 266).
- **The sidebar cover** on: the column scrolls as a whole and Settings stays reachable at 1280 x 800 and 1280 x 600.

### Reachability (Task 8 Step 1)

The hrefs a user can click on each surface, against what the old sidebar reached in the same state (the enabled stored entries, Discover, Mixed for
You, Saved Queues, Fresh, Downloads, Library Matches, My Listening, Settings, the Playlists page, a seeded collection `#/library/albums?genre=Jazz`).

| State | Surface | Routes reached | Missing | In More |
|---|---|---|---|---|
| lb-bot present | expanded 1280 | 19 | none | - |
| lb-bot present | expanded 1000 (fold) | 19 | none | Statistics, Saved queues, Library Matches, Settings |
| lb-bot present | collapsed rail | 19 | none | - |
| lb-bot present | drawer 700 | 19 | none | - |
| lb-bot absent | expanded 1280 / fold / rail / drawer | 14 each | none | fold: Saved queues, Settings |
| hub down | expanded 1280 / fold / rail / drawer | 13 each | none | fold: Saved queues, Settings |
| listening unsupported | expanded 1280 / fold / rail / drawer | 18 each | none | fold: Saved queues, Library Matches, Settings |

The rail reaches the collection through its kept Collections dropdown and `/playlists` through its new Playlists entry; the drawer reaches the
collection through the Collections section it gained (its old Collections row linked to nothing). After the review: with the sidebar's playlist
section turned off and the Playlists entry enabled, `/playlists` is reached once on each of the expanded sidebar, the rail and the drawer (before the
fix only the rail reached it).

### The rail and the drawer (Task 4)

The rail lists the main entries, the Library children, Collections, Playlists, then the groups with a hairline between them and the count as a dot
on Needs attention's icon; its back, forward and menu items are gone. The drawer (700 x 900) lists the groups with their labels and no More, and keeps
its own search bar.

### The queue rail (Task 5)

- Panel closed: the rail shows and the grid's third track is 44 px (`400px 836px 44px` before the cards); clicking the rail opens the panel
  (`400px 280px 600px`); the bound hotkey closes and opens it (the toggle hotkey has no default binding, `alt+q` was bound for the check).
- Count: 49 queued songs read 49; with the hub's remote state set (7 songs on another device) it reads 7, back to 49 when local.
- Now Playing with no panel to show and the flag set: no panel, no rail, and the bar's button shows the closed icon; a click flips the flag.
- Drawer mode and the vertical layout: no rail, no extra column.
- Expressive motion on: opening from the rail eases the track 44 px to 600 px through in-between values (`44, 64, 549, 563, 583, 594, 598, 599, 600`);
  with reduced motion it is one value (600) after the fix in this branch (before it, reduced motion still eased, the panel's 0 to 600 as well).
- After the cards: open, close, collapse and expand each move the page card's edges through in-between values (`t9` traces), and the left handle,
  the right handle and the vertical layout's top handle drag 1:1.

### Widths (Task 6)

A `store_app` of version 5 with 400 / 600 opens at 232 / 360 and is stored as version 6; one with 300 / 480 opens at 300 / 480. The left drag,
measured as the card's width after the cards: the cursor on the handle keeps 232 (no jump), 150 gives 200, 400 gives 320, under 100 collapses to the
80 px rail.

### The type pair (Task 7)

- Files: `@fontsource-variable/figtree@5.3.0` and `@fontsource-variable/bricolage-grotesque@5.3.0` (OFL-1.1), `npm pack --ignore-scripts` outside the
  repo, tarballs listed before extracting:

  | File | Bytes | sha256 |
  |---|---|---|
  | figtree-latin-wght-normal.woff2 | 20156 | 4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd |
  | figtree-latin-ext-wght-normal.woff2 | 10280 | bf7828e2c258cffcfa50a048ee388a36b95bc16b452e8d36fa797635dbe15965 |
  | bricolage-grotesque-latin-wght-normal.woff2 | 41344 | a97804dc9fbe5fc972a08018c5eda4dab7ef2346f64c57e61419d05e6de4ea1c |
  | bricolage-grotesque-latin-ext-wght-normal.woff2 | 18668 | e808f16b56f84dc7933e498cc8a41d4a5cd853adc6eef154584baa5de1008b15 |
  | Figtree-OFL.txt | - | ee23e6c84000126692e112ff067b456470493349f993ceaa8b4d3766dd6fad5d |
  | BricolageGrotesque-OFL.txt | - | 923f4ddf0fd39f9b7794ab0df7332f3d95dc43e8ad7ec2289d6d9e8491177f51 |

- `cdp.mjs fonts` on `Łódź Жук Ωmega 日本語`: in a sidebar row, Figtree (11 glyphs, `ł` and `ź` from its latin-ext face), Inter (4: Cyrillic and Greek),
  Noto Sans JP (3); in a carousel title and a page title, Bricolage Grotesque, Inter, Noto Sans JP; on the album and artist header's `<h1>` class,
  Figtree before the fix in this branch, Bricolage Grotesque after.
- Seeds: Inter (built-in, version 36) becomes Figtree, stored as version 37; Poppins, a custom font and a system font are kept.
- The font picker offers Figtree, Inter and Poppins.
- `cdp.mjs net` across a reload: two font requests, both `localhost:5173` (the latin faces; the latin-ext faces load only when such text appears).
- The remote SPA: both builds pass; `pnpm dev:remote` renders an empty root here (no Electron remote server); the built `out/remote` served
  statically renders its header and "connecting" spinner with `--theme-content-font-family` = `Figtree, Inter, ...` and
  `--theme-title-font-family` = `"Bricolage Grotesque", ...` on its root. That screen has no text to compare.

### Keyboard and motion

Tab from the top of the page (45 presses): Back, Forward, Search, Menu, the sidebar rows (Home, the Library toggle, its children, Fresh), the
collection, the Playlists section's buttons, Needs attention ("Needs attention, 1"), Activity, More, the rail's "View queue", then the page and the
bar. The More menu fades in through in-between opacities (opacity only, Mantine's menu transition) with and without reduced motion, as every menu in the app does.

### Contrast on rendered pixels

Each new surface's text colour through a canvas, its background from the screenshot pixel inside the element's box (each point checked visible with
`elementFromPoint`), over `fixture:black`, `fixture:grey25` and `fixture:split`, hues 40, 120 and 250, dark and light (`__coverWash.set`), 1280 x 800:
126 pairs.

| Pair | Dark, lowest | Light, lowest |
|---|---|---|
| Group label (on2) on the sidebar card | 6.81 (split, h120) | 5.89 (black, h250) |
| Row label (on2) on the sidebar card | 7.56 (split, h120) | 5.93 (black, h250) |
| Selected row (accct on accc) | 6.17 (black, h120) | 8.01 (black, h40) |
| Needs attention badge (`#1b1304` / `#fff` on the warning role) | 11.04 | 7.95 |
| `Ctrl K` hint (Mantine's Kbd colours) | 9.37 | 7.76 |
| Rail count pill (accct on accc) | 6.17 (black, h120) | 8.01 (black, h40) |
| Rail "Up next" (on2 on the window) | 9.30 (grey25, h120) | 6.53 (black, h120) |

Every pair is 4.5 or more. **With `Cover colours` off** the badge was first the theme's background colour on its warning colour, which the
review found unreadable on light themes; measured 1.18 (Default Light), 2.10 (Ayu Light), 3.12 (GitHub Light, VS Code Light+), 3.41 (Gruvbox
Light). After the fix (the board's dark label in both schemes off the wash) it measures 4.76 to 17.13 across all 32 built-in themes (Gruvbox Light
lowest, Default Light 13.03, Default Dark 7.19). The other off-wash surfaces use the roles the shell used before.

### `Cover colours` on and off

Screenshots of the top bar, the sidebar and its stack, the badge, the rail and the cards with the wash on and off at 1280 x 800. Off, the rows keep
today's colours (the selected row in the theme's accent, the sidebar on the alternate background) and the page card matches the gaps (both the
theme's background); on, the three cards paint the translucent surface once and the gaps show the wash.

## Reasoned from code only (NOT VERIFIED)

- **A real lb-bot and hub**: a fill that really fails, the live `fill` frames, the hub connecting after first render. Only the badge's arithmetic and
  rendering and the gates' effect on the model were watched, by setting the stores.
- **The hub's remote queue**: the rail's count follows the hub store's `remoteQueue` when its remote state is set (watched); a real phone driving it
  was not.
- **The owner's library and long real playlist list**; the album and artist header with real data (the class was probed with an injected element).
- **Windows and macOS title bars as the OS draws them**, a real display and GPU; only the layout of each `windowBarStyle` was measured.
- **The WEB window style** (plan call 11): its 65 px titlebar over the top bar's right edge was not seen; the web build was built, not run.
- **The remote SPA with a connected server** (only its disconnected screen rendered).
- **Custom CSS themes**: `custom-themes/catppuccin-glassy.css` has its own height literals and styles `.fs-action-bar-module-container`; not checked.
  The built-in Glassy Dark theme's `.fs-action-bar` input rule no longer reaches the top bar's search field. Glassy Dark's own height override was
  measured (8 px under the cards after the review's fix, 16 before); the rest of that theme was not looked at.
- `prefers-color-scheme` changing while the app runs; user-installed fonts.

## Calls made beyond the plan

1. The main grid row is its own height (`--main-row-height`), and `--content-height` is that less the card gap, so every stylesheet that sized itself
   against the old literals gets a card's height. The plan's `minmax(0, 1fr)` row grew with its content (Settings measured 30-9266).
2. The queue panel's grid tween now obeys reduced motion (it eased with reduced motion before F3 too).
3. The album and artist header's `<h1>` reads the title font (Mantine only gives `Title` the headings font).
4. The mobile drawer gained the Collections section; the rail kept its Collections dropdown and gained a Playlists entry.
5. `docs/ENV_SETTINGS.md` lists Figtree as the built-in font's default.
6. Each title and text face ships `latin` and `latin-ext` (four files), and the Figtree stack falls back to Inter, so Cyrillic and Greek stay in a
   bundled face.

## Open for the owner

1. **Cards**: built as the board draws them. With `Cover colours` off the page card has no surface of its own, so it matches the gaps (both the
   theme's background); the resize handles are 4 px inside each card, so a drag that starts in the gap does nothing. The queue rail is drawn on the
   window, not as a card (as the Narrow board shows it).
2. **The top row**: the board's centred track title and its dimmed arrow when there is nowhere to go are not built (plan call 1).
3. **Sizes the board draws differently**: the rail is 52 px in the Main board's hidden-queue state (44 built, as on the Narrow board); the Narrow
   board's sidebar is 196 px and its top row 48 px (232 and 52 kept, the fold at 1100 px); the bar's row is 96 px on the board (F1's 90 kept).
4. **Controls that now do nothing**: the Sidebar settings page's rows for Home, Settings and Playlists and the order of the Library children
   (`sidebar-settings.tsx`, `sidebar-reorder.tsx`) no longer change the sidebar beyond enabling or disabling a Library child; `sidebarCollapsedNavigation`
   does nothing (back and forward live in the top bar). No UI was built for either.
5. **Settings is always visible** in the App group, though its stored entry is disabled by default. Playlists stays reachable through its section's
   list icon (expanded sidebar and drawer), the rail's new Playlists entry, and, when the playlist section is turned off, a Library child.
6. **Indistinguishable choices moved**: a deliberately chosen 400 px sidebar or 600 px panel moved to 232 / 360, and a deliberately chosen Inter moved
   to Figtree.
7. **Fonts**: Cyrillic and Greek are drawn in Inter beside Figtree, Japanese in Noto Sans JP; the remote SPA's fonts changed with the renderer's.
   The alternatives (keep Inter as the default, or add a face with those scripts) are yours.
8. **The badge's label colours** are the board's two literals over the warning role: `#1b1304` everywhere except the wash's light scheme, which takes
   `#fff`. Wash on: 7.95 to 11.04 measured; wash off: 4.76 to 17.13 across the 32 built-in themes. They are written in the sidebar's and the rail's
   modules (a deferred minor).
9. **The command palette's "go to" list** still uses the old navi-connect names (Downloads, My Listening) from `navi-connect-items.ts`.
10. **The stack is tall**: with every group at 1280 x 800 the bottom stack takes 377 px and the scroll area above it 239 px. At 1100 px and under
    the fold applies; above it the column scrolls as a whole only when it must.
11. **The `Ctrl K` hint** keeps Mantine's Kbd colours (light grey in a light window, dark grey in a dark one) instead of taking the wash.
12. Windows and macOS title bars and a real display: NOT VERIFIED.

## Try this

1. Open the app at about 1280 x 800 with lb-bot connected: the sidebar shows Home, Library, Fresh and the You, Listening, Library tools and App
   groups; fail a fill and Needs attention counts it; dismiss it and the count drops.
2. Narrow the window to 1100 px and under: the lower groups fold into More; widen it again, the page does not reload.
3. Hide the queue with the bar's button: the 44 px rail stands where the panel was, with the queue's length; click it to bring the panel back.
4. Collapse the sidebar (drag it under 100 px): the rail lists every entry, Collections and Playlists included.
5. With Expressive motion on, open and close the queue and collapse the sidebar: the cards ease and keep their 8 px gaps; turn on reduced motion in
   the OS and the grid snaps.
6. Put a Polish, a Russian and a Japanese title side by side (a playlist name works): Figtree, Inter and Noto Sans JP.
7. Turn `Cover colours` off: the shell is the theme's own colours, the cards keep their shape.

## Final review

One fresh reviewer (a separate agent on the most capable model available) read the whole branch, `c58c0b5..2860e3c`, against the plan, the addendum,
the plan's Review Focus and the ledger's rulings, and ran the three new harnesses, both type-checks and the push gate. Verdict: **with fixes**;
0 Critical, 3 Important, 8 Minor.

Fixed in one pass (`fix(ui): address the branch review`), each seen failing first:

1. **The badge was unreadable on light themes with `Cover colours` off** (Important). Measured 1.18 to 3.41 on four light themes, then 4.76 to 17.13
   on all 32 after the fix.
2. **The Playlists page was unreachable from the expanded sidebar and the drawer when the playlist section is off** (Important). Harness case
   `playlistsIsAChildOnlyWhenItsSectionIsHidden` red, then green; watched on all three surfaces.
3. **A disabled stored entry could come back through a duplicate the settings merge appended** (Important; the old sidebar behaved the same).
   Harness case `aDisabledStoredItemStaysHiddenWhenTheMergedTailRepeatsIt` red, then green.
4. **Glassy Dark left 16 px under the cards** (graded Minor by the reviewer, re-graded Important: a regression this branch made in a built-in theme).
   Measured 16, then 8.

Suite after the pass: both type-checks clean, eslint and stylelint clean, 44 harnesses, 741 pass, 0 fail.

## Rulings I made

In the order they were made; each says what it costs if wrong.

1. Install: `pnpm install --frozen-lockfile` fails here (proxy 403 on `codeload.github.com`); the two git-hosted packages were installed through a
   temporary override and the three package files restored. Cost: local `node_modules` differs from CI in two main-process packages.
2. `pnpm` commands ran with `--config.verify-deps-before-run=false` (otherwise they re-install and hit the same 403). Cost: none.
3. Task 1: the main row was sized by `--content-height`, not `minmax(0, 1fr)` (the `1fr` row grew to its content). Superseded by ruling 33.
4. Task 1: the literal sweep's dispositions (six stylesheets and Glassy's override follow the variables; the mobile layout, the dead
   `side-drawer-queue.tsx`, a modal's height and user themes left alone). Cost: one surface keeps a stale literal.
5. Task 1: F2's `position` and `isolation` stay where F2 put them; the variants only set the bar height. Cost: none.
6. Task 1: `ActionBar` kept for the mobile drawer; `TopBar` written new. Cost: one more file to delete in F6.
7. Task 1: the top bar is a window-drag region with its controls excluded, as the action bar was. Cost: a stray drag on the empty bar.
8. Task 1: the hint reads `⌘ K` on macOS and `Ctrl K` elsewhere, only for the default binding. Cost: a wrong glyph on an unusual platform string.
9. Task 1: the full-screen player and visualizer cover the page area below the top bar, as they covered the page area before. Cost: you may want them
   over the top bar too.
10. Task 2: groups come in the board's order and an empty group is dropped; More holds the lower entries even without lb-bot. Cost: one test.
11. Task 3: dropped `.accordion-root { height: 100% }` (it added a viewport of blank scroll under the sections). Cost: none seen.
12. Task 3: `SidebarItem` gained `selectedTo` and `SidebarIcon` gained `name`. Cost: two optional props.
13. Task 3: `SidebarGroups` takes the groups and renders twice (main rows in the scroll area, the stack below). Cost: none.
14. Task 3: the badge is a styled span with the board's numbers, not Mantine's Badge. Cost: one class.
15. Task 3: the off-wash badge label was the theme's background colour. Wrong on light themes; replaced in the review's fix 1.
16. Task 3: a short column scrolls as a whole and the scroll area keeps 136 px. Cost: two scrollbars at once in that edge case.
17. Task 3: the Library group starts expanded, its state is not persisted, its children are indented. Cost: it re-opens on each launch.
18. Task 3: Discover and Mixed for You keep their English labels. Cost: two keys to add.
19. Task 3: on the wash the rows are on2 and the selected row accct on accc; off, today's colours. Cost: re-measure if the roles move.
20. Task 4: the rail keeps its Collections dropdown and gains a Playlists entry, after the main block. Cost: order.
21. Task 4: the rail flattens the Library group, draws hairlines and a count dot, and selects shared-route rows by the model. Cost: none.
22. Task 4: the drawer gained the Collections section. Cost: one section in the drawer.
23. Task 4: the rail and drawer ask the model for no fold; `navi-connect-items.ts` stays for the command palette. Cost: none.
24. Task 5: one hook for the rail beside the panel's, and the 44 px track only under the rail's class. Cost: none.
25. Task 5: the queue button's icon reads the shared hook, its click keeps the raw flag. Cost: on Now Playing a click flips a flag with nothing to show.
26. Task 5: the rail first painted the panel's roles; superseded by ruling 34 (not a card, transparent).
27. Task 5: the grid tween obeys reduced motion. Cost: none.
28. Task 6: the width step is guarded on a persisted `sidebar`. Cost: none; a deliberate 400 / 600 moves too.
29. Task 7: four font files (latin and latin-ext) under the packages' lower-case names, licences beside them. Cost: renames.
30. Task 7: the Figtree stack falls back to Inter; other fonts unchanged. Cost: Cyrillic and Greek in Inter.
31. Task 7: the album and artist header's `<h1>` reads the title font. Cost: one line.
32. Task 7: `docs/ENV_SETTINGS.md` lists Figtree as the default. Cost: none.
33. Task 9: the main row is `--main-row-height` and `--content-height` is a card's height. Cost: none.
34. Task 9: the queue rail is not a card. Cost: one rule if you want a card there.
35. Task 9: the page card paints the surface only on the wash; off, it matches the gaps. Cost: you may want a visible page card off the wash.
36. Task 9: the left drag measures the card. Cost: a drag starting in the gap does nothing.
37. Final: re-graded Glassy Dark's 16 px gap from Minor to Important and fixed it. Cost: one line.
38. Final: the reviewer's "declined to judge" items stand as decided earlier (WEB titlebar, user themes, the palette's names, the full-screen player
    under the top bar, the dead settings controls, the moved defaults, the board's sizes, the Now Playing button, the rail counting the whole queue,
    the hidden rail's subscription, a partial persisted font, the top bar's drag region, the drag's style read, the `Ctrl K` colours, the short-column
    scrollbars, an unused i18n key). Cost: each visible one is in "Open for the owner".

## Deferred minors

- The sidebar re-renders on every fills-ledger write (`useFillLedger` rebuilds the rows); a plain count selector would avoid it.
- The badge's two literal colours are written in two modules; hoist them into one place.
- At 1100 px and under, the first frame shows the unfolded stack (Mantine's `useMediaQuery` reads in an effect).
- The queue rail shows "Up next" and a count when the only panel is lyrics (the plan's predicate).
- The rail marks both `/downloads` rows `aria-current` (`NavLink`), though only Activity looks selected.
- Discover and Mixed for You have no i18n keys.
- The More menu marks the current page only with a filled icon.
- Commits carry the container's git author identity (`Claude <noreply@anthropic.com>`), as F1's and F2's did; the messages carry no attribution.

