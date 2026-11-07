# Results: number cells at a column's 40 px floor read whole again (R17, B-271), walked on the VM

Written 2026-10-30 by R17's fix agent.

- **Plan:** `navi-connect/PLAN-feishin-number-cells-2026-10-30.md`. **Item:** B-271.
- **Branch:** `fix/number-cells-2026-10-30`, cut from `b5726d89` (R8 to R16 plus R16's note).
- **VM numbers** come from the sandbox VM (nested, VirGL), production builds. The session was locked, so frames were
  forced (`--disable-gpu-vsync --disable-frame-rate-limit`). Widths, boxes, drawn text and attributes are good
  evidence. Frame times were not measured. The VM's Figtree draws a little wider than the workstation's ("2026" 34.9 px
  against 32.6 px, "44100" 43.6 against 41.1).

## Commits

| Commit | What |
|---|---|
| `2b9ff21d` | Implementer: number cells (the floor-list columns, not the row index) use the base's rule again (min-content box, clamp by row size) and clip at their own border |
| `28634766` | Fix pass: a number too wide for the padding box ends in an ellipsis inside it; a start or end aligned number uses the other side's padding; review M-2, M-3, M-4 |
| this note | `docs(ui): number cells at a column's floor walked on the VM` |

## Gates (workstation, at `28634766`)

| Gate | Result |
|---|---|
| New harness red first (`fix-harness-red.log`) | 5 of 10 fail before the fix: `aNumberPastItsCellShowsItsFullText`, `aNumberWiderThanItsCellEndsInAnEllipsisInsideIt`, `aNumberUsesTheOtherSidesPaddingBeforeItIsCut`, `theNumberCellPaddingIsTheCellsOwn`, `thePlayableTrackNumberDoesNotDependOnCssOrder` |
| M-3 guard `everyNumberCellComponentsColumnKeepsItsFloor` | passes on the code; fails in a scratch copy with a new `TableColumn` id routed to `NumericColumn` and left off the floor list ("newNum renders a number cell") |
| Every harness, `node --test $(git ls-files 'src/**/*.harness.ts')` | 1221 tests, 1221 pass, 0 fail, exit 0 (1216 + 5 new) |
| `tsc --noEmit --composite false`, web / node | exit 0 / exit 0, 0 errors after filtering TS6307 |
| `eslint --max-warnings=0` (3 TS files) / `stylelint --max-warnings=0` (2 CSS files) | exit 0 / exit 0 |
| `pnpm build:web` / `pnpm build:remote` | exit 0 / exit 0; the built CSS carries the `translate: min(...)` / `max(...)` rules and `.full-size-content.full-size-content` |
| VM: `pnpm install --frozen-lockfile --offline`, `pnpm run build` in `~/src/feishin-r17` at `28634766` | exit 0 / exit 0 |
| commitlint, em dash in added lines, attribution | 0, 0, none |

Logs are in `.superpowers/sdd/PLAN-feishin-number-cells-2026-10-30/fix-*.log`.

## The rule as built

- **Number cells** are the floor-list columns rendered through the shared text container, except the row index (the
  ledger's ruling, unchanged): Duration, Year, Release year, Date, Release date, Date added, Last played, Bitrate,
  Sample rate, Bit depth, Channels, BPM, Disc number, Track number, Play count, Album and song counts, Size, Codec.
- Their box keeps the base's rule: min-content width, line clamp 1 / 2 / 3 by row size. That makes "320 kbps" read
  "320 / kbps" at the default size, and "32..." in compact rows, as before R16 (M-1, accepted).
- **The box is at most the cell's padding box** (`max-width: calc(100% + 2 * var(--number-cell-padding))`, 39 or
  40 px at a 40 px column). A number wider than that ends in the base rule's ellipsis inside the box, with the start of
  the value readable, and gets its full text as a tooltip on hover. Nothing draws past the cell border: the box cannot
  pass it, and the cell keeps `overflow-x: clip` as a guard.
- **A start or end aligned number moves into the other side's padding by exactly what it lacks**, through `translate`:
  - start: `min(0px, 100cqw + var(--number-cell-padding) - 100%)`;
  - end: `max(0px, 100% - 100cqw - var(--number-cell-padding))`.

  The cell is a size container, so `100cqw` is its content box and `100%` is the box's own width. The shift is 0 for
  a number that fits its aligned side, so it keeps its alignment. A centred box no wider than the padding box already
  stays inside it.
- **The threshold is derived, not guessed.** The only edge is the cell's own padding box, its content box plus the
  side padding the cell names. Each padding class sets `--number-cell-padding` to its own horizontal padding, and a
  harness reads each `.container.padding-*` rule and checks that the two agree.
- **Start alignment had no rule in table data cells.** `'start'` reaches a data cell as the module's `left` class, and
  `.container.start` is never set on one. So the box stretched to the content box and was cut, at R15 too
  (VM: R15 and R16 start-aligned "0:03" and "2026" read "0:..." and "2..."). Number cells now name it
  (`.number-cell.left`). Text cells are untouched; see Findings.
- **M-2:** the past-the-cell guard (`runsPastItsCell`) now measures rects, with half a px allowed for rounding. Rects
  do not depend on the offsetParent, and they include the shift.
- **M-3:** every column whose cell is a number component (`CountColumn`, `NumericColumn`, `BitRateColumn`,
  `DurationColumn`, `SizeColumn`, `YearColumn`, `ReleaseYearColumn`, `DateColumn`, `AbsoluteDateColumn`,
  `RelativeDateColumn`, `TrackDateColumn`, `TrackNumberColumn`) must keep its floor.
- **M-4:** `.full-size-content.full-size-content`. On the VM the album table's playable track number has
  `number-content` and `full-size-content` together and computes `display: flex`, `overflow: visible`, clamp `none`.

## The reproduction, before the VM (workstation)

The page was run in the repo's Electron, offscreen, at a device scale of 1. It used the module's own CSS: the blocks
for `.container`, padding, alignment, `.content`, `.number-*` and `@container` were taken from the stylesheet at each
commit. Cells were 40 px with a 1 px border (padding box 39), `sm` padding, the bundled Figtree woff2 at 14 / 18 px,
rows 40 / 66 / 88. Alignment classes were applied as the TSX applies them (start = `left`). Values are box edges in
the padding box (0..39); "cut" means the box overflows and draws an ellipsis. Scripts:
`main.cjs` and `tab.cjs` in the session scratchpad.

Default rows, after the fix:

| value | width | centre | start | end |
|---|---|---|---|---|
| 48000 | 44.2 | 0..39 cut "480..." | 0..39 cut | 0..39 cut |
| 44100 | 41.1 | 0..39 cut "441..." | 0..39 cut | 0..39 cut |
| 10,000 | 44.8 | 0..39 cut "10,0..." | 0..39 cut | 0..39 cut |
| 12,345 | 41.1 | 0..39 cut "12,3..." | 0..39 cut | 0..39 cut |
| 1:02:03 | 46.3 | 0..39 cut "1:02:..." | 0..39 cut | 0..39 cut |
| 2 months ago | 85.7 | 0..39 cut "2 / mon..." | 0..39 cut | 0..39 cut |
| 10:03 | 34.9 | 2.1..37 | 4.1..39 | 0..34.9 |
| 45:12 | 33.9 | 2.5..36.5 | 5.1..39 | 0..33.9 |
| 2026 | 32.6 | 3.2..35.8 | 6.4..39 | 0..32.6 |
| 1,234 | 33.1 | 3..36 | 5.9..39 | 0..33.1 |
| 0:03 | 29.1 | 5..34.1 | 8..37.1 (its alignment) | 1.9..31 (its alignment) |
| 320 kbps | 57.7 | 4.6..34.4, 2 lines | 8..37.8, 2 lines | 1.2..31, 2 lines |

- Compact: the same boxes, one line. Everything from "10:03" to "0:03" is whole; "320 kbps" is "32...".
- Large: the same. "320 kbps" is on 2 lines, "Oct 29, 2026" on 3 lines and whole, "2 months ago" "2 / mon... / ago".

The same values at the base (`df91334b`, the reference for "before R16") and at the first R17 cut (`2b9ff21d`):

- Centred, every number up to 39 px is identical in all three builds.
- Base, wider than 39 px: drew past both borders, for example "48000" at -2.6..41.6 and "1:02:03" at -3.6..42.6.
- First R17 cut, the same numbers: the same box, but clipped at the border mid-glyph.
- End alignment: the base drew into the previous cell ("10:03" -3.9, "1:02:03" -15.3). The first cut clipped there.
- Start alignment: cut to "2...", "0:..." and so on in both builds, since the box stretched to the 23 px content box.

## The walk on the VM

### Setup

| Build | Worktree | Commit | Build time | CDP port |
|---|---|---|---|---|
| R15 | `~/src/feishin-r15` | `1fcb84d1` (the "as before R16" numbers) | 2026-10-29 17:47, clean tree | 9321 |
| R16 | `~/src/feishin-r16` | `8da3632b` (the regression) | 22:21, after the commit at 22:19 | 9322 |
| R17 | `~/src/feishin-r17` | `tmp-r17` = `28634766`, a detached worktree of `~/src/feishin` | `pnpm run build` exit 0 at 10:08 | 9323 |

- **Profiles:** copies of R16's scratch profiles in `~/standins/run/r17/cfg-{r15,r16,r17}`. Before any app ran, an
  offline Electron script read each one: hub off (`ws://127.0.0.1:4899`, disabled), Library Tracks on its default
  columns. The profiles carry R16's local 40-song queue, paused.
- **Nothing was played.** The window title read "(Paused)" at the end. The player volume was not found in the profile
  stores, so it was not set; only the visualiser's volume field became 0.
- At most two apps ran at once. Sizes are CDP viewport emulation, dpr 1. `window.resizeTo` does work here (the window
  went from 1280 x 768 to 1100 x 700, then back), but it cannot reach 1440 x 900 on the VM's 1280 x 800 screen, so the
  sizes were emulated as in R16.
- Navigation was by clicks. Columns, row size and alignment were changed through the table settings and put back.
- The side queue was dragged to its narrowest and back (handle at 1072 before and after).
- No rating or favourite was touched. One row was selected by a click and stays selected in memory only.
- Apps were closed with CDP `Browser.close`, which is a normal quit. Each profile was read offline afterwards: default
  columns, centre alignment on Duration and Year, Default row size, hub off.
- Scripts and logs are in `~/standins/run/r17/` (`walk1.sh` to `walk3.sh`, `num.mjs`, `clone.mjs`). Shots are in
  `~/standins/shots/repair-r17-*`, copied to the workstation's `~/.cache/feishin-r17-vm-2026-10-30/`.

### R15 / R16 / R17 at a glance (Library Tracks, 1440 x 900, queue docked, Filters open, 40 px cells, row 1)

| Cell | R15 `1fcb84d1` | R16 `8da3632b` | R17 `28634766` |
|---|---|---|---|
| Widths / sideways scroll | 24 200 40 40 40 40 40 24 80, scroll 12 | 24 192 40 38 38 40 40 24 80, scroll 0 | same as R16 |
| Duration, centre | "0:03" | "0:..." | "0:03" |
| Year, centre | "2026" | "2..." | "2026" |
| Bitrate, default / compact / large | "320 / kbps" / "32..." / "320 / kbps" | "3..." / "3..." / "3..." | as R15 |
| Sample rate "44100" (43.6 px) | whole, 1.8 px past both borders | "4..." | "441..." inside 0..40, tooltip |
| Size "156.41 KiB" | "156.41 / KiB", 3.3 px past both borders | "1..." | "156.... / KiB", tooltip |
| Date added "Oct 22, 2026": default / large / compact | "Oct / 22..." / three lines / "Oc..." | "O..." | as R15 |
| Last played "2 days ago": default / large | "2 / da..." / three lines | "2..." | as R15 |
| Disc, Track, Plays ("0", "1") | whole | whole | whole |
| Duration and Year, start aligned | "0:...", "2..." | "0:...", "2..." | "0:03" at 8..37.7 (its alignment), "2026" at 5.1..40 (shifted 2.9 px) |
| Duration and Year, end aligned | "0:03"; "2026" from -2.9 px, over the previous cell | "0:...", "2..." | "0:03" at 2.3..32; "2026" at 0..34.9 (shifted 2.9 px) |
| Cells drawing past their border | 28 of 667 measured | 0 of 688 | 0 of 706 |

### 1. Library Tracks: number cells at 40 px

- **Sizes and scroll.** At 1440 x 900, 1100 x 700 and 800 x 600, R16 and R17 have identical widths and scroll:
  0 / 0 / 156 with the default columns, and 352 / 392 / 555 with the eight extra columns. R15 scrolls 12 / 36 / 156.
  Every number column is 40 px on every build. Row heights are 40 / 66 / 88 (compact / default / large) on every build.
- **Default columns, every size, three rows.** R17 reads "0:03", "0:02", "2026", "2009", "320 / kbps",
  "192 / kbps" and "128 / kbps", with the same boxes as R15. R16 reads "0:...", "2...", "3...".
- **Extra columns** (Sample rate, Play count, Size, Date added, Last played, Track number, Disc number, BPM), measured
  with the table at its left and after a sideways wheel. R17 reads as R15 everywhere a value fits the padding box.
  Where it does not (Sample rate "44100", Size "156.41 KiB"), R17 ends in an ellipsis inside the cell, where R15 drew
  across the border. BPM is empty on the stand-in, and Last played is empty on rows 1 and 2.
- **Compact and large rows.** Compact Bitrate is "32...", "19...", "12..." on R15 and R17, exactly as R15 (M-1; shot
  `repair-r17-r17-extra-Compact-1440x900.png` beside `-r15-`). Large: Date added "Oct / 22, / 2026" and Last played
  "2 / days / ago" whole on R15 and R17.
- **Alignment** (Duration and Year set to start, then end, then back to centre, at 1440 and 800): the values are in
  the table above. The read-back shots match: `repair-r17-r17-align-start-1440x900.png` shows "0:03", "2026", and
  `-r15-` shows "0:...", "2...".
- **The review's values, in-app.** A live Duration cell was cloned off to the side, with its classes, so each build's
  own CSS applies. Each clone was set to 40 px with one review value, in each alignment and row size, then removed.
  Default rows:

| value | R15 centre / start / end | R16 (any) | R17 centre / start / end |
|---|---|---|---|
| 48000 | whole, -1.8..41.8 past / "4..." / -11.6..32 past | "4..." | "480..." in 0..40, all three |
| 10,000 | whole, -3.4..43.4 past / "1..." / -14.8..32 past | "1..." | "10,0..." |
| 12,345 | whole, past / "1..." / past | "1..." | "12,3..." |
| 1:02:03 | whole, -5.3..45.4 past / "1:..." / -18.7..32 past | "1:..." | "1:02..." |
| 2 months ago | "2 / mont..." past / "2 / m..." / past | "2..." | "2 / mon..." |
| 10:03 | whole 0.8..39.2 / "1..." / -6.4..32 past | "1..." | whole: 0.8..39.2 / 1.6..40 / 0..38.4 |
| 45:12 | whole / "4..." / -6.4 past | "4..." | whole: 0.8..39.2 / 1.6..40 / 0..38.4 |
| 2026 | whole / "2..." / -2.9 past | "2..." | whole: 2.6..37.5 / 5.1..40 / 0..34.9 |
| 1,234 | whole / "1,..." / -6.1 past | "1,..." | whole: 1..39 / 1.9..40 / 0..38.1 |
| 0:03 | whole / "0:..." / whole | "0:..." | whole: 5.1..34.9 / 8..37.7 / 2.3..32 |
| 320 kbps | "320 / kbps" / "3... / kb..." / whole | "3..." | "320 / kbps" in all three |

  Compact: the same, one line ("32..." for 320 kbps). Large: the same, "2 / mon... / ago". Shots:
  `repair-r17-{r15,r16,r17}-clone-{compact,default,large}.png`. Read back: R17 shows "480...", "10,0...", "1:02...",
  and "10:03", "2026" whole in every alignment.

### 2. No overlap

- **No ink past the border on R17.** Of 706 measured R17 cells, none had ink past its border. Ink was taken from the
  glyph boxes intersected with the box's and the cell's clips. R15 had 28 such cells, all number cells: Sample rate,
  Size, and Year when end aligned.
- **Selected row.** Row 2 was selected with the eight extra columns on. 0 cells drew past their border, and the
  highlight runs unbroken under the number cells (`repair-r17-r17-selected-right.png`).
- **Header and rows.** At 1440, 1100 and 800 with the extra columns, the header and first-row cells differ by 0 px in
  x and width, on R16 and R17.
- **The resize handle.** It sits in the header cell, which this change does not touch; it was not dragged in this walk.

### 3. Text cells unchanged from R16

`walk2` was run on R16 and R17: hover over every cell of 3 rows, with the default and the extra columns, left and
right. The diff of the two logs has only number-cell lines.

- **Text cells are identical on both builds**: Album, Genre and Title text, cut state, the `title` on hover
  ("Wysea Live", "Jazz"), and links (`link=true` on Album and Genre).
- **Number cell tooltips.** R16 gives every number cell a `title`, because every one was cut. R17 gives one only to cut
  numbers: "44100", "Oct 22, 2026", "156.41 KiB", "2 days ago". There is none on "0:03", "2026", "320 kbps",
  "93.95 KiB" or the row index.

### 4. Other tables

- **Widths and sideways scroll are identical on R16 and R17** in the side queue (360 and its narrowest), the playlist,
  Now Playing, the full-screen queue and the album table, at 1440 / 1100 / 800 / 480 / 375 as in R16's walk. Every
  scroll is 0. For example, the playlist and Now Playing at 375 are 24 173 40 37 37 40 24, and the album at 375 is
  26 210 52 31.
- **Number cells, R16 against R17:**
  - playlist at 800 (Duration 44 px): "0:..." against "0:01";
  - playlist and Now Playing at 375: "0:..." / "1..." against "0:01" / "1976";
  - full-screen queue at 1100, 800 and 375: "0:..." / "2..." against "0:03" / "2013";
  - full-screen queue at 480: Year at 48 px, "20..." against "2013".
- **Text cells are unchanged** in all of these tables.
- **Cells of 48 px or more** (the side queue, the album table) read whole on every build.
- **Against R15:** the only differences in these tables are R16's band (playlist and Now Playing at 375 scroll
  21 -> 0) and R16's one-line text cells. Numbers read as on R15.

### 5. An hour-long duration

The stand-in library has none: every song is 1 to 3 s and the playlist is "1m 21s". So "1:02:03" was walked in the
in-app clones above:

- R15: whole but 5.3 px past both borders when centred, 18.7 px into the previous cell when end aligned, and "1:..."
  when start aligned.
- R16: "1:...".
- R17: "1:02..." inside the cell in every alignment and row size.

The reproduction gives "1:02:..." with the workstation's narrower glyphs.

## Findings

- **Ruled cost, now visible on the VM: every 44.1 kHz Sample rate at the 40 px floor reads "441..."** (the full value
  on hover). "44100" is 43.6 px of text on the VM and 41.1 px on the workstation, so it does not fit the 39 to 40 px
  padding box. R15 drew it whole by overdrawing both neighbours by 1.8 px. The ledger ruled this cost (I-1). Size
  values of 100 KiB or more ("156.41 KiB") behave the same way. New B line, for the owner's call: a wider floor for
  Sample rate and Size, or kHz.
- **Pre-existing since upstream: start alignment has no rule in table data cells.** `TableColumnTextContainer` sets
  `styles.left` for `'start'`, while the stylesheet defines `.container.start`. Number cells name it now. Text cells
  still stretch and look left aligned through inheritance, so the effect is latent. New B line.
- **Pre-existing at R15: the line clamp's ellipsis is not drawn on an end-aligned multi-line number.** Examples: the
  compact "2 months ago" shows "2" alone, and the default "Oct 29, 2026" shows "Oct / 29,". It is the same on the base
  and on R17, and the full text shows on hover. New B line, low.
- No new bug from this round.

## Not verified

Watched running, but not here:

- The owner's workstation: its GPU, display scale, fonts (the VM's Figtree is wider, see above), and real frames.
- The native tooltip appearing on screen. The `title` attribute was read; the OS tooltip is not in a CDP capture.
- An hour-long duration, a five-digit play count, 48 kHz audio and BPM data in real rows. These were walked as cloned
  cells only (stand-in data).
- The light theme.
- Library Tracks at 375 px wide (not in R16's walk either).
- A column resize drag in this round.
- Padding sizes other than `sm`: the table setting was not changed. Their `--number-cell-padding` is pinned by the
  harness against the stylesheet.

Reasoned from code, not watched:

- That `--number-cell-padding` follows the cell's padding class for `xs`, `md`, `lg`, `xl` and no horizontal padding.
- That the playable track number in other tables behaves like the album table's, which was the one seen.
- That a number column made wider than 40 px by the user keeps the same rule; it should, since the rule has no fixed
  width.
