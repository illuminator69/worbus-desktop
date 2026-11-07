# Results: autoFit tables fit instead of scrolling by slivers, and cut cells end in an ellipsis (R16), walked on the VM

Written 2026-10-29 by R16's fix agent.

- **Plan:** `navi-connect/PLAN-feishin-table-fit-2026-10-29.md`. **Item:** B-267.
- **Branch:** `fix/table-fit-2026-10-29`, cut from `df91334b` (R15's tip).
- **Every number below is a VM number** (the sandbox VM, nested, VirGL), production builds, session locked so frames
  were forced (`--disable-gpu-vsync --disable-frame-rate-limit`): widths, scroll sizes, text and attributes are good
  evidence; frame times were not measured.

## Commits

| Commit | What |
|---|---|
| `2c90a23b` | Task 1: a table overflowing by less than one column's minimum shrinks to fit instead of scrolling |
| `26de9097` | Task 2: table text cells end in an ellipsis on one line; the full text as a native `title` when cut |
| `ea02dccd` | Ruling on concern 2: numbers, durations, dates, sizes, counts and icon columns keep their floor in the band |
| `627f1af0` | Review M1 to M4: genre badges hide whole when narrow, the row index has no tooltip, no `undefined` class, every `TableColumn` id classified |
| `8da3632b` | M1 measured on the VM: the badge width steps moved so each drawn badge keeps about 20 px of label |

## Gates (workstation, at `8da3632b`)

- Every harness (`node --test` over `git ls-files 'src/**/*.harness.ts'`): 1211 tests, 1211 pass, 0 fail (1205 at
  `ea02dccd`, plus 6 for the review's fixes).
- Red first: the five new tests for M1 to M3 (`genreBadgesHideWholeInsteadOfCuttingThrough`,
  `theGenreBadgeTooltipNamesEveryGenre`, `theRowIndexGetsNoFullTextTooltip`, `everyCellClassExistsInItsModule`,
  `aHiddenPartCountsAsCut`) failed against `ea02dccd` (5 of 43 in the three files). M4's
  `everyTableColumnIsClassifiedForTheBand` is a guard: it passes on the code and fails against a copy of
  `fit-column-widths.ts` with `skip` removed from the floor list ("skip: 192 38 38 38 39 80").
- `tsc --noEmit --composite false`: `tsconfig.web.json` and `tsconfig.node.json`, 0 lines after filtering TS6307.
- `eslint --max-warnings=0` on every changed file, `stylelint --max-warnings=0` on the changed stylesheet: exit 0.
- `pnpm build:web` and `pnpm build:remote`: exit 0. On the VM `pnpm run build` exit 0 in `~/src/feishin-r16` at
  `8da3632b`; the built stylesheet carries the container queries.
- `commitlint` 0 on both fix commits; no em dash in any added line, no attribution.

## The rule as built

- R15's floors stay (Title 200 or half a table under 400, Rating 80, others 40 or 0.4 of a narrow column).
- Floors that overflow the table by 1 to 39 px: the overflow is taken from the text columns only (Title, Album,
  Artist, Album artist, Genre, Composer, Path, Comment, custom), in proportion to their floors, so the table fits
  exactly. Numbers, durations, dates, sizes, counts, codes, icons, the row index and Rating keep their floor. With no
  text column to give, the table scrolls.
- 40 px of overflow or more: R15 unchanged, every column on its floor, the table scrolls by the whole overflow. So a
  sideways scroll is 0 or at least 40 px.
- A drag saves the own width that shows the dragged px, or the nearest one when the band's jump has none.
- Every text cell is one line ending in an ellipsis; a cut cell gets its full text as a native `title` when the
  pointer enters it. Genre badges: the cell is a size container; below 80 / 122 / 164 px of content it draws 1 / 2 / 3
  badges and hides the rest whole; below 64 px the one badge has 2 px side padding.

## Setup

- **Before:** `~/src/feishin-r15` at `1fcb84d1` (only two docs commits from the base `df91334b`), its production
  build from 17:48 today, tree clean. CDP 9311.
- **After:** `~/src/feishin-r16`, a detached worktree of `~/src/feishin` at `tmp-r16` (`8da3632b`), `pnpm install
  --frozen-lockfile --offline` then `pnpm run build`. CDP 9312. (The first after build was `627f1af0`; the badge
  measurement below moved the steps, and every after number in this note is from the `8da3632b` rebuild.)
- **Profiles:** two copies of R15's VM profile (`~/standins/run/r16/cfg-{before,after}`). Before either app ever ran
  on them, a small offline Electron script turned the hub **off** in each (so no local play could reach the shared
  scratch hub's session) and put Library Tracks back to its default columns (R15 had left Artist and Play Count on and
  Album saved at 597). No queue had to be made: the profile carried a local 40-song queue, paused; nothing was played.
- Apps run one at a time. Sizes are CDP viewport emulations (dpr 1; the VM screen is 1280 x 800, `resizeTo` does
  nothing there). Navigation by clicks (the search palette for the album). Column changes through the table settings,
  each undone afterwards; widths reset through the settings' width fields before each drag and at the end; the light
  window through Settings, then back to dark. No rating, favourite or play touched the stand-in Navidrome.
- Scripts and logs in `~/standins/run/r16/`, shots in `~/standins/shots/repair-r16-{before,after}-*` (copied to the
  workstation's `~/.cache/feishin-r16-vm-2026-10-29/`).

## Before and after

| What | Before (`1fcb84d1` = base) | After (`8da3632b`) |
|---|---|---|
| Tracks 1440 x 900, queue docked, Filters open (516 px) | 24 200 40 40 40 40 40 24 80, scroll **12** | 24 **192** 40 **38 38** 40 40 24 80, scroll **0** |
| same, 1100 x 700 (492) | 24 200 40 ..., scroll **36** | 24 **174** 40 **35 35** 40 40 24 80, scroll **0** |
| same, 800 x 600 (344) / 1600 x 900 (676) | scroll 156 / 0 | identical |
| + Artist and Play Count, 1440 / 1100 / 800 / 1600 | scroll 92 / 116 / 238 / 0 | identical |
| Crossing the threshold, window 1418 to 1409 and back | scroll 34, 35, ... 43, Title 200 throughout | fits down to 489 px (Title 176 to 172), at **488** one change to Title 200 and scroll 40; back up the same |
| Album / Genre cell at 40 px | "Wys / Live" on two lines, "Jaz" clipped, no ellipsis | "W..." / "J..." one line, ellipsis, full text on hover |
| Duration, Year, Bitrate cell at 40 px | "0:03", "2026", "320 / kbps" whole, the text running into the cell padding | **"0:...", "2...", "3..."** with ellipsis (see Findings) |
| Rating stars, row hovered (80 px cell) | 12.5 px inside either edge | identical |
| Native tooltip on a cut cell | none anywhere | on every cut cell, none on uncut cells or the row index |
| Playlist / Now Playing at 375 x 812 | 24 188 40 40 40 40 24, scroll **21** | 24 **173** 40 **37 37** 40 24, scroll **0** |
| Playlist / Now Playing 1440 / 1100 / 800 | 36 200 60 182 181 121 36 / ... / 26 200 44 130 131 87 26 | identical widths |
| Full-screen queue 1440 / 1100 / 800 / 480 / 375 | 688 / 518 / 368 / 480 / 375 px, no scroll | identical widths, no scroll |
| Album table (Hits Flag 4) 1440 / 1100 / 800 / 375 | 62 498 125 75 / ... / 26 210 52 31 | identical |
| Side queue 360 px / at its narrowest (250 px table) | 42 207 69 42 / 29 144 48 29, no scroll | identical |
| Genre badges at 40 px, 2 badges (cloned cell) | two 18 px pills with 0 px of label, the second 16 px past the cell | one badge, 18 px of label, "I..." |
| Title drag +10 at 1440 | 200 to 210 (exact), scroll 22 | 192 to **198** (wanted 202) |

## What was watched

### 1. Library Tracks, four sizes, default and extra columns

`tbl.mjs` read every header and cell box (width, `scrollWidth` vs `clientWidth` of the grid body, each cell's text,
whether a box in it is cut, its `text-overflow`, line count, `title`). The values are in the table above. At 1600 the
table fits (676 px) on both builds with the same widths: the band changes nothing where the floors fit. With Artist
(text) and Play Count (number) added the floors overflow by 92 / 116 / 238 px at 1440 / 1100 / 800, so both builds
scroll by the same amount (no band). Duration, Year and Bitrate stayed at 40 px at every size and in every table on the
after build; Rating 80.

### 2. The threshold

`sweep.mjs` changed the emulated width 1 px at a time across the band edge (window 1418 to 1409 and back up), and
after each step read the widths 6 times at 60 ms, then 10 times at 200 ms. After build: one change of widths at 489 /
488 px of table (Title 172 to 200, Album 34 to 40, Genre 35 to 40, scroll 0 to 40) in both directions; within each
step's first 360 ms two width sets were seen (the old, then the new: the container tracker's 100 ms debounce), and none
of the 2 s holds changed again: no oscillation. Header cells and the first row's cells had the same x and width at
every step (difference 0). Before build: one width set throughout, scroll 34 to 43.

### 3. Drags

`resize.mjs` pressed on a header's resize handle, moved in 10 steps, read mid-drag, released, then clicked the handle
twice without moving. Widths reset to Title 300 / Album 300 between drags.

| Drag | Before: shown (wanted), scroll | After: shown (wanted), scroll |
|---|---|---|
| Title +10, 1440 | 210 (210), 22 | **198 (202)**, 0 |
| Title +20, 1440 | 220 (220), 32 | **198 (212)**, 0 |
| Title +36, 1440 | 236 (236), 48 | 228 (228), 40 |
| Title +60, 1440 | 260 (260), 72 | 252 (252), 64 |
| Title -20, 1440 | 200 (180), saved own width **1** | 192 (172), saved own width **1** |
| Album +10, 1440 | 50 (50), 22 | 48 (48), 0 |
| Album +25, 1440 | 65 (65), 37 | **68 (63)**, 40 |
| Album +160, 1440 | 200 (200), 172 | 198 (198), 170 |
| Album +220 / +260, 1600 | 320 / 360 exact | 320 / 360 exact |
| Title +10, 1100 x 700 | 210 (210), 46 | **175 (184)**, 0 |

- Inside the jump the after build lands up to 14 px off (Title +20 at 1440), within the ledger's ~15 px. A Title
  drag of +10 or +20 at 1440 ends at 198 px whatever the release point; the table fits. Whether the owner reads that
  as "springs back" is the owner's call.
- During every drag only the dragged column widens, so the table scrolls by the drag distance until release (mid-drag
  scroll 10 for Title +10) and settles on release (0 for Title +10, 40 past the jump). Same on the before build.
- The two clicks on the handle changed nothing (shown and saved width) after each of the 11 drags, on both builds.
- Album past ~320 at 1600 (676 px table) pushes the others to their floors and scrolls 132 / 172 on both builds,
  landing exactly where released.

### 4. Every text cell at its floor

Album, Album artist, Artist, Composer, Genre, Genre (badges), Comment and Path turned on (13 columns, all at 40 px, the
table scrolling 250 at 1440 and 92 at 1600). After: every Album, Album artist, Artist, Genre, Path and badge cell one
line with an ellipsis (`text-overflow: ellipsis`, `white-space: nowrap`); the before wrapped Album and the artists onto
two lines clipped without an ellipsis ("Stat / Sign"), and Path onto 5 or 6 lines. Composer and Comment are empty on
the stand-in (no data). Links: the element under a point 4 px into each Album, Artist, Album artist, Genre and badge
cell is the `<a>` on both builds. `title` on hover: present on every cut cell with the cell's text ("Static Signals",
"Jazz" for the badge), absent where the text fits ("Pop" in a 40 px Genre cell, Title cells), absent on the row index
(M2). After a wheel scroll with the pointer still the cell under it carries the new row's text ("Wysea Live", then
"Young Hearts Sessions", then "Foxurn Live"). Row heights compact / default / large: 40 / 66 / 88 on both builds, one
line in the large row. Dark and the light window (Settings, cover colours Light): same widths and the same ellipses; the
light shot read back shows "W...", "St...", the "J..." badge legible.

### 5. Other tables

Values in the table above. Where nothing overflows the widths are identical on both builds; the only width change
outside Library Tracks is the playlist and Now Playing tables at 375 px, which fit now instead of scrolling 21 px.

### 6. The reviewer's "declined to judge"

- **The jump watched:** one change, no oscillation, header and rows aligned (item 2). Frames were forced, so a
  flicker inside the 100 ms debounce was not observable here.
- **Title +10 at 1440:** lands at 198 (item 3).
- **Live drag in the band:** scrolls by the drag distance, settles on release (item 3).
- **The tooltip:** only on cut cells, follows a wheel scroll, none on the row index (item 4).
- **A spurious `title` from 1 px rounding:** none on an uncut cell; the opposite does happen (Findings).
- **Genre (badges) at its floor (M1):** the stand-in songs carry one genre each, so a live badge cell was cloned off
  screen with 1 to 4 badges at cell widths 40 to 200 (same CSS module classes, so the container query and the clip
  apply). After: at 40, 50, 60, 70 px one badge with 18 to 48 px of label and an ellipsis; two badges from 100 px (22
  px of label each), three from 140 (Jazz, the shortest, 11 px), four from 200; no drawn badge past the cell at any
  width. The first after build (steps at 64 / 100 / 136 px) left 12 px of label at the start of a step, which drew "I.."
  and a clipped "E..": hence `8da3632b`. Before: at 40 px two 18 px pills with no label, the second 16 px past the
  cell, four badges 60 px past.
- **Duration "12:34" and Bitrate "1,411 kbps":** not on the stand-in (every song is about 2 s; the WAVs were not in
  the first rows). The 40 px floor already fails for "0:03" (Findings).

## Findings

- **New, from this round: numbers at their 40 px floor now read "0:...", "2...", "3..." where they read whole before.**
  A duration ("0:03", 30 px of text), a year ("2026", 35 px) and a bitrate ("320 kbps", 59 px) get 24 px inside the
  `sm` padding. The base let them run into the cell padding unclipped (the R15 workstation shots read "0:03", "2026",
  "320 / kbps"); Task 2's one-line rule clips every text container at its content box, so the value is lost behind an
  ellipsis (full text on hover). Seen at every size on Library Tracks, at 800 px on the playlist and Now Playing
  tables (Duration 44 px: "0:..."), and in the full-screen queue below 1100. The plan's walk item 1 asks for these to
  be readable; they are not. Filed as a new B line; it needs a ruling (exempt the numeric cells from the clip and let
  them use the padding as before, or floors measured from the text, about 48 px for a duration and a year).
- **New, low: a cell cut by under 1 px draws an ellipsis but gets no tooltip.** "Pop" in a 40 px Genre cell is
  24.38 px of text in 24 px: Chromium draws "P...", while `scrollWidth` (24) equals `clientWidth` (24), so the cut
  check says it fits. Every "Pop" in the 13-column table's Genre column (the before drew "Pop" whole, 0.38 px
  into the padding). Filed as a new B line.
- **Pre-existing since R15, low: a drag narrower than a column's floor saves own width 1.** Title dragged -20 at 1440
  saves 1 on both builds (the search returns the smallest own width that shows the floor), so on any wider window that
  column keeps its floor while the others share the rest, until reset in the table settings. Filed as a new B line.
- The drag misses inside the jump (up to 14 px) are the ruled cost; Title at 1100 x 700 lands 9 px off.

## Not verified

Watched running, but not here:
- The owner's workstation: its GPU, real 60 Hz frames, its display scale and fonts (the text widths above are this
  VM's), and a flicker at the jump.
- Genre (badges) with two or more real genres (cloned cells only), Composer and Comment with data, a "12:34" duration
  and a 1,411 kbps row in view.
- Native tooltips appearing on screen: the `title` attribute was read; the OS tooltip itself is not in a CDP capture.
- Light theme beyond the cover-colours Light window (the stock light themes were not selected).

Reasoned from code, not watched:
- That the container width the rule reads cannot change when a scrollbar appears (OverlayScrollbars, no layout space):
  consistent with the sweep (no oscillation), not proven by it.
- That no other caller of `TableColumnTextContainer` uses the row index type than the index cells.
