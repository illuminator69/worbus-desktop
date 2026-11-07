# Results: the queue header, the Tracks table and Popular follow-ups (R15), walked on the VM

Written 2026-10-29 by R15's fix agent.

- **Plan:** `navi-connect/PLAN-feishin-followups-2026-10-29.md`.
- **Branch:** `fix/followups-2026-10-29`, cut from `1365f12c`.
- **The owner's items:** the 18 px blank line in the queue header (B-251's workstation clause), B-264, B-265, B-266.
- **Every number below is a VM number** (the sandbox VM, nested, VirGL), production builds, with frames forced
  (`--disable-gpu-vsync --disable-frame-rate-limit`), so positions, widths, node counts and the order of frames are good
  evidence; frame times are not.

## Commits

| Commit | What |
|---|---|
| `a955880f` | Task 1: the queue header drops its empty line; Autoplay no longer changes the sentence (B-251) |
| `d2b54094` | Task 2: the tracks table scrolls sideways instead of crushing Title (B-264) |
| `e436fcc2` | Task 3: Popular holds its order for a visit and redraws light stars when left (B-265, B-266) |
| `fcf568ab` | Review I3, I4: Popular's stars ignore click focus and keep a star's focus across a window switch |
| `fbb43995` | Review I1, I2: autoFit tables floor small columns at a duration's width, and a drag ends where it let go |
| `1fcb84d1` | Review M2: the playing-from model drops the character nothing reads |

## Gates (workstation, at `1fcb84d1`)

- Harnesses (`node --test` over every `src/**/*.harness.ts`): 1183 tests, 1183 pass, 0 fail (1174 after Task 3, plus
  9 for the review's fixes). Each fix's harness was watched failing first against a stub of the code it replaces:
  `aMouseFocusedRowReturnsToOneElement` and `aWindowSwitchKeepsTheStarsFocus` (5 of 22 failed),
  `aResizeInOverflowKeepsTheDraggedWidth` ("album dragged to 200, shows 80"), `otherAutoFitTablesDoNotScrollAtNarrowWidths`
  and four more (6 of 15 failed), `theHeaderCarriesNoCharacter` (2 of 18 failed).
- `tsc --noEmit --composite false`: `tsconfig.web.json` and `tsconfig.node.json` give 0 lines after filtering TS6307,
  after each commit.
- `eslint --max-warnings=0` on every changed file: exit 0 (no stylesheet changed in the fixes). `commitlint` 0 on the
  three fix commits.
- `pnpm build:web` exit 0, `pnpm build:remote` exit 0. On the VM `pnpm build` exit 0 in `~/src/feishin-r15`.
- Added lines contain no em dash, and no commit carries attribution.

### The fixes in one line each

- **I1:** under autoFit a resize now saves the own width (a proportion) that fits back to the dragged px, found by a
  search over `fitColumnWidths`; a column dragged past the widest default (300) raises its own floor at 40 / 300 of its
  own width, so in an overflowing table it does not spring back; a click on the handle (no move) saves nothing.
- **I2 (option (a)):** Title (200, or half a table under 400) and Rating (80) keep their floors; every other column's
  floor is 40 px, a duration ("3:45", about 24 px at the table's size) inside the `sm` cell padding (2 x 8). A column
  narrower than that by default (row index, heart, cover: 60 to 70) keeps 0.4 of its own width instead, because with 40
  the side queue at its narrowest (226 px of table) would scroll by 7 px; with this it keeps its widths exactly
  (26 / 131 / 43 / 26).
- **I3:** a row's focus keeps the stars drawn only when it is `:focus-visible` or inside the stars; a click focuses the
  `<li>` itself, which no longer counts.
- **I4:** a blur while `document.hasFocus()` is false (the window lost the focus) is not a leave.
- **M2:** `PlayingFrom.character` and its input are gone.

## Setup

- Before: `~/src/feishin-r13` at `79507ae0`, the same code as `1365f12c` (`git diff --stat 79507ae0 1365f12c` touches
  only the two walk notes under `docs/`). Its production build from 2026-10-29 00:48 was intact (tree clean, `out/main`,
  `out/preload`, `out/renderer`, `out/remote` all written after the commit), so it was reused, not rebuilt. CDP 9301.
- After: `~/src/feishin-r15`, a worktree of `~/src/feishin` at `tmp-r15` (`1fcb84d1`), `pnpm install --frozen-lockfile
  --offline` then `pnpm build`. CDP 9302.
- Profiles: two copies of R14's logged-in production profile (`~/standins/run/r15/cfg-{before,after}`); no login typed.
- The two apps share one hub identity (copied profiles), so they flapped when both ran; they were run **one at a time**.
- Stand-ins: Navidrome 4533, fake lb-bot 4897, scratch hub 4899 and a stand-in AudioMuse on 4880, none restarted; the
  shared app on 9222 not touched. 1440 x 900, 1100 x 700, 800 x 600 and 375 x 812 are CDP viewport emulations (dpr 1).
- Scripts in `~/standins/run/r15/`, shots in `~/standins/shots/repair-r15-{before,after}-*`.

## Before and after

| What | Before (`1365f12c`) | After (`1fcb84d1`) |
|---|---|---|
| Header, queue of no kind ("R8 scratch queue"), engine mode, Autoplay off / on / off | 200 / 200 / 200, an empty 18 px line under the title | 182 / 182 / 182, no line; the characters row 163 -> 145 |
| Header, playlist, Auto DJ mode (no engine) | 162 / 162 / 162, the line "Playlist" / "Playlist · Auto DJ" / "Playlist" | 162 / 162 / 162, "Playlist" throughout |
| Tracks 1440 x 900, queue docked, Filters open: Title | 102 px ("A...") | 200 px, title text 118 px whole |
| same: Bitrate header | 34 px cell, 18 of its 34 px label shown ("'RA") | 40 px cell, "BI..." (ellipsis) |
| same: Rating stars vs the heart | stars 1015.5..1078.5 over the heart (1010..1030) and past their cell | stars 1004.5..1067.5 inside their cell 996..1076, heart 972..996 |
| same: sideways scroll | none (516 of 516) | 12 px (528 of 516) |
| Tracks 1100 x 700 / 800 x 600 (queue as the rail): Title | 98 / 67 | 200 / 172 |
| Tracks with Artist and Play Count added, 1440 / 1100 / 800: Title | 80 / 76 / 53, no scroll | 200 / 200 / 172, scroll 92 / 116 / 238 px |
| Resize Album +160 px in that table (1440) | 80 -> 67 shown (saved 240) | 40 -> 200 shown (saved 1497); a drag -120 px: 200 -> 80 |
| A click on the handle (twice) | no change | no change |
| Playlist table / Now Playing page, 1440 / 1100 / 800: Title, scroll | 186 / 180 / 147, none | 200 / 200 / 200, none |
| same at 375 x 812 | Title 86, none | Title 188, scroll 21 px |
| Full-screen queue 1440 / 1100 / 800 (688 / 518 / 368 px) | no scroll | no scroll |
| Album table (Hits Flag 4), three sizes | 62 / 498 / 125 / 75 at 1440 | identical at all three |
| Popular: nodes after rating rows 2 and 5 with the mouse and leaving | 420 (both rows keep a Rating) | 350 (R10's limit 356) |
| Popular: nodes after Tab through every row and leaving | 528 | 351 (three rows rated) |
| Popular: order during three counted plays | moved twice (5th to 3rd at 14.5 s and at 25.2 s) | held for the visit (sampled every 500 ms, 32 s) |

## What was watched

### 1. The header across queue kinds (Review Focus 1, M5)

Measured on `[data-queue-header]` at 1440 x 900, panel docked, Autoplay switched off, on, off by clicking it.

- **No kind** (the saved "R8 scratch queue", loaded from Saved queues): before 200 / 200 / 200 with lines "Playing from"
  (96), "R8 scratch queue" (114), a zero-width space (132, 18 px) or "autoplay continues after it, Blend" with Autoplay
  on; after 182 / 182 / 182 with no third line. 18 px shorter, as the plan asked. Shot read back: the before's empty band
  between the title and the characters row is flat (pixel range 4 across y 58..74 of the shot), the after has the
  characters row's top there (range 29). In Auto DJ mode (no characters row) the after reads 144 / 144 / 144.
- **Playlist** ("R1 colour walk"): engine mode after 200 / 200 / 200, "Playlist" each time. Auto DJ mode: before
  162 / 162 / 162 with "Playlist · Auto DJ" while on; after 162 / 162 / 162, "Playlist" each time.
- **Album** (Hits Flag 4, one song) and **Album radio**: no "Playing from" block on either build (no saved-queue record
  matched, M5's third case). The album queue went 178 / 140 / 140 on both builds: with Autoplay on the engine appended
  five songs and the characters row went away, and it did not come back with Autoplay off. Pre-existing, filed as B-268.
  Album radio: 140 / 140 / 140 on both.
- **A remote device's queue** and **a bound station's line**: not reached. The only other devices on the scratch hub are
  the shared app, cast bridges and a Navic entry, and Album radio did not bind a hub station.
- M5's first case (the status line toggling in Auto DJ mode with a binding still in the store) was not produced: no
  binding existed.

### 2. The Tracks table (Review Focus 2, I1, I2, M4)

Library > Tracks, Filters open. The panel docks only at 1440 here; at 1100 and 800 the app shows the queue as its rail
(B-207's fold below 1180), so those two sizes are "queue folded, Filters open".

- **Widths, 1440 x 900, default nine columns** (container 516 on both builds): before 20 / 102 / 34 / 102 / 102 / 68 / 34
  / 20 / 34; after 24 / 200 / 40 / 40 / 40 / 40 / 40 / 24 / 80 (528). Labels: Album 44 px label in 24 px ("AL..."),
  Genre "G...", Year "YE...", Bitrate "BI...", each with `text-overflow: ellipsis`. Cells at 40 px clip their text
  ("Wys", "Jaz") without an ellipsis: filed in B-267.
- **Sideways scroll:** Shift+wheel moved the rows 0 -> 12 (1440), 36 (1100), 156 (800); every header cell's x equalled
  its row cell's x after the scroll; the autoFit container stayed 516 / 492 / 344 (no growth). The rows' horizontal
  scrollbar is an overlay thumb (0 px reserved); dragging it 150 px at 1440 with extra columns gave `scrollLeft` 45, the
  Year header at x 887 over its cell at 887.
- **Extra columns** (Artist, Play Count; 11 columns): after 608 / 608 / 582 px of content for 516 / 492 / 344, Title 200
  / 200 / 172, each added column 40 px.
- **The stars** (row 1 hovered, 1440): after inside their cell with `overflow-x: clip`, 8.5 px from either edge; M4 (the
  80 px floor assumes the default font and `sm` padding) stands as accepted.
- **I1, resize in overflow** (1440, 11 columns): the Album handle dragged +160 px: after 40 -> 200 shown (saved 1497),
  -120 px: 200 -> 80 (saved 597); two clicks on the handle after each: no change in shown or saved width. Before
  (`1365f12c`, no floors yet): 80 -> 67 for the same +160 drag, saved 240 (upstream's drift); the clicks saved nothing new
  because the handle resent the last drag's width (now reset at mousedown).
- **I2, the other tables:** the playlist table and the Now Playing page (seven default columns) fit at 1440, 1100 and 800
  on both builds (816 / 792 / 644 px); the after's Title is 200 there instead of 186 / 180 / 147. At 375 x 812 the after
  scrolls by 21 px (floors 396 for 375; the before squeezed Title to 86): filed in B-267. The full-screen player's queue
  (six columns, no header) does not scroll at 688 / 518 / 368 on either build. The side queue at 1440 (360 px) does not
  scroll. The album table's widths are identical before and after at all three sizes.

### 3. Popular stars (Review Focus 3, 5, I3, I4)

The Long Players, "Yours", five rows, 1440 x 900; ratings put back afterwards (all five unrated, no favourite).

- **Mouse:** pointed at row 2, clicked its third star, waited 1.5 s, moved the pointer to the sidebar. After: 384 nodes
  while pointed, 349 once left, with `document.activeElement` still the clicked `<li>` (not `:focus-visible`); row 5 the
  same, 385 -> 350. Before: 384 -> 384, then 420 after row 5 (both rows keep their Rating).
- **No visual change at the swap:** the Mantine stars and the one-element stars both at (809, 480.5), 63 x 11 px.
- **Within a frame:** with a rAF sampler started just before the pointer left, the row read Rating, Rating, then the one
  element from the third frame, 37 ms after the sampler started (the pointer move goes through CDP in that time).
- **Keyboard:** Tab from the Yours chip runs through each row; the after draws a row's Rating only while that row holds
  the focus (roots 10000, 01000, 00100). Arrow keys move between the stars without rating (radio roving); Space rated row
  3 to 2 stars with the focus on that star in every sample through the save (8 samples over 900 ms) and after it; Tab on
  to row 4 returned row 3 to one element. 351 nodes with three rated rows once everything was left. Before: 492, then 528
  after tabbing through.
- **I4, a window deactivation:** the session was not locked this time (`LockedHint=no`), but Alt-Tab cannot be sent over
  CDP, so the app's own minimize (`window.api.browser.minimize()`, the title bar's button) deactivated the window with a
  star focused. In Electron 43 the star got `blur` with `relatedTarget` null and `document.hasFocus()` false; the Rating
  stayed (roots 00100), the star stayed the active element, and after `Page.bringToFront` the window had the focus back
  on the same star. On the before build the same minimize did not deactivate the window in that run (no blur), and its
  latch never unmounts anyway, so there is no before number.

### 4. Popular order (Review Focus 4, B-266, M1)

- **Counted plays:** row 5's own Play, three times (each ran on through autoplay, so more than three plays were counted;
  the queue reached 57). After: the order Live Plain 2 1 | Hits Flag 8 1 | Live Plain 6 1 | Live Plain 1 1 | Score 4 1
  held for the whole visit. Before: Live Plain 6 1 moved from fifth to third 14.5 s in and Hits Flag 8 1 from fifth to
  third at 25.2 s.
- **A rating and a favourite** on the held list: the stars and the heart changed in place, the order did not.
- **Everyone, then Yours:** the new order (Score 4 1 from fifth to second). **A new visit** (Home, then the artist's link)
  and **Back** (an album, then the app's Back): the new order, the chip still Yours (R10's restore).
- **M1:** three plays of an album while away, then the artist's link, sampling every 50 ms: after, rows at 372 ms already
  in the new order (Live Plain 1 1 to second) and no change for the next 3.6 s; before the same at 397 ms. The rows came
  from a fetch (an empty list from 309 ms), so the cached-then-reordered arrival did not happen on this loopback stand-in.

## What the header's line no longer says, and where it is shown now

| It said | Now |
|---|---|
| "autoplay continues after it" | the Autoplay switch (on); the queue rail's end label reads "Autoplay" instead of "End of queue" |
| the character (", Blend") | the characters row's selected segment (engine mode) |
| "stopped" (a stopped station) | only the switch (off) and the dimmed characters row. The station's own line (name, character, "via Navidrome") never said "stopped" (review M3) |
| "Auto DJ" (no station engine, Autoplay on) | only the switch, and the More menu's Auto DJ entry (walked: "Playlist · Auto DJ" became "Playlist") |

## Findings

- **B-267 (new):** option (a)'s small floors leave slivers and clipped cells where the floors only just overflow: Tracks
  at 1440 x 900 with the queue docked and Filters open scrolls by 12 px (528 for 516), and the playlist table and the Now
  Playing page at 375 px by 21 px; Album and Genre at 40 px show "Wys" / "Jaz" cut without an ellipsis. Owner's call
  (the ruling's named cost).
- **B-268 (new, pre-existing on both builds):** on a queue with no saved-queue record (an album played from its page),
  turning Autoplay on in engine mode appended five songs and removed the characters row (178 -> 140 px, the list moves
  38 px), and Autoplay off did not bring it back.
- A drag in an overflowing autoFit table saves a large proportion (Album 1497 for 200 px); on a wide window that column
  then takes about five times its default share. Not walked at a wide window; reasoned from the rule.

## Not verified

Watched running, but not here:
- A remote device's queue in the header, a bound hub station's line, and the no-kind queue in Auto DJ mode on the before
  build.
- The mobile layout's full-screen player (it needs the mobile user agent), and the side queue at its narrowest panel
  (250 px) or with an added column (harness only).
- A real Alt-Tab; the window was deactivated by the app's minimize instead.
- I4 on the before build (no deactivation in that run).

Reasoned from code only:
- M1 on a slow server or with a cache the scrobble does not invalidate: the review's one reorder just after arrival can
  still happen there.
- The large proportion a drag in overflow leaves for a wide window (above).
- The rating and title floors with a larger font size or `lg` / `xl` cell padding (M4: the stars clip in their cell).

And, as for every VM walk: the owner's GPU, real 60 Hz frames (frames were forced uncapped here), and the owner's library
(long titles, real ratings, real play counts). The stand-in's play counts went up during the walk and stay up.
