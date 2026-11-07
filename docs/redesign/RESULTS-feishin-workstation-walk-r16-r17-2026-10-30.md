# Results: R16 and R17 walked on the workstation

Written 2026-10-30 by the workstation walk agent. One walk of repair rounds R16 (table fit and ellipsis, B-267) and R17
(number cells read whole at a column's floor, B-271) on the owner's machine: Fedora, KDE Plasma on Wayland, the app's
window at `devicePixelRatio` 2 on a 1600 x 900 screen, real 60 Hz frames. No app code was changed. Every value below was
watched on this machine unless a line says it was reasoned.

The walk ran in two parts. The first (12:33 to 12:51) stopped when the session locked (`LockedHint=yes`): frames
stopped being measured, the app and the tunnel were stopped. The owner unlocked the screen and the walk resumed at
13:12 and ran to the end (13:54) with the session unlocked at every check. The before numbers from the first part were
kept; nothing from a locked moment is used.

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `.worktrees/repair-r15/feishin` | `df91334b` (R8 to R15) | 9361 | `~/.cache/feishin-walk-r16-r17-2026-10-30/cfg-before` |
| after | `.worktrees/repair-r17/feishin` | `5d746cfd` (R16 + R17) | 9362 | `.../cfg-after` |

- **Builds.** After: `pnpm run build`, exit 0 (12:34 to 12:35); its CSS carries 10 `number-cell-padding` rules, the
  before's none. Before: its `out/` was reused. The last code commit there is `1fcb84d1` (17:44 on 10-29),
  `git diff --stat 1fcb84d1..df91334b` touches 2 docs files only, and every file in `out/main`, `out/preload` and
  `out/renderer` is dated 18:46 to 18:47, after it. Both trees clean before and after. No install, no typecheck, no
  branch switched, one app at a time, no build with an app up.
- **Data.** The VM's stand-in Navidrome (4533) through my own `ssh -N -L 127.0.0.1:14533:127.0.0.1:4533`
  (`ControlMaster=no`, its own pid, killed at the end). Nothing on the VM was restarted or stopped.
- **Profiles.** Copies of the R15 walk's logged-in profiles. Each had its hub enabled (pointing at a forward that was
  not open); right after each launch the hub was set to off and read back (`enabled: false`) before anything else.
  Nothing was played: the local 1-song queue stayed paused, the bar stayed muted. No `cast-*` device was touched.
- **Window.** Sized only by the page's own `window.resizeTo` over CDP. On this machine `resizeTo` sets the inner size.
  Got exactly 1600 x 900, 1440 x 900, 1100 x 700, 800 x 600 and 480 x 800; **a 375 x 812 request gave 480 x 812**, so
  480 is the narrowest the window allows, as in R15. dpr 2. A first try that added the frame size got 1472 x 900; it
  is discarded (its log kept as `walkA-before-failed-size.log`).
- **Scripts.** The R16 and R17 VM lanes' scripts (`tbl.mjs`, `num.mjs`, `hover.mjs`, `clone.mjs`, `sweep.mjs`,
  `resize.mjs`, ...) with only the port, the paths and the sizing changed, so the numbers compare with the VM's. Every
  script checks the lock before it touches the app. Scripts, logs and shots in `~/.cache/feishin-walk-r16-r17-2026-10-30/`.
- **Restores.** Columns, row size, alignment, the light wash and every width were put back and read back in both
  profiles (default columns, Default rows, Duration and Year centred, dark). The after profile's Album own width was
  302 at the start; it was set to 300 for the walk so both builds start equal, and set back to 302 at the end. No
  rating or favourite was touched. Two notes: during the first part a VM coordinate toggled the before profile's
  Tracks view to posters (set back to Table in the table settings); and the lock caught the before profile with the 8
  extra columns on, which were turned off by editing `store_settings` and reloading, since a locked window gets no
  frames for the dialog.
- **KDE config.** `sha256sum ~/.config/kwinrc ~/.config/kwinoutputconfig.json ~/.config/kscreen/*` with read-only
  copies of `kwinoutputconfig.json`, at the start and end of each part: `kwinrc` identical (`21474a50...`),
  `kwinoutputconfig.json` identical in content (`c6581a44...`), although KDE rewrote it at 12:50:53 (the lock) and
  13:11:46 (the unlock, before the second part's snapshot). `~/.config/kscreen/` does not exist. Nothing ran
  nested.sh, a compositor, dbus-run-session, kwin.sh, raise.sh, a KWin script, `org.kde.KWin`, kscreen-doctor or
  kwriteconfig.
- **Password.** Never printed or written; the stand-in password appears 0 times as a value in the work dir.

## Before and after

Library Tracks, queue docked, Filters open, unless a row says otherwise. VM R17 = the R17 VM note's numbers.

| What | before `df91334b` | after `5d746cfd` | VM R17 |
|---|---|---|---|
| Widths, 1440 x 900 (table 516) | 24 200 40 40 40 40 40 24 80, scroll **12** | 24 **192** 40 **38 38** 40 40 24 80, scroll **0** | same as after |
| 1100 x 700 (492) | scroll **36** | 24 174 40 35 35 40 40 24 80, scroll **0** | 0 |
| 800 x 600 (344) / 1600 x 900 (676) | 156 / 0 | 156 / 0, identical widths | 156 / n/a |
| + 8 extra number columns, 1600 / 1440 / 1100 / 800 | 172 / 352 / 392 / 555 | identical | 352 / 392 / 555 |
| Threshold, window 1425 to 1400 and back, 1 px steps | scroll 27 to 52, widths fixed | one change at table 489 / 488 px (window 1413 / 1412) both ways: Title 172 to 200, scroll 0 to 40 | 489 / 488 |
| Same, 1110 to 1080 x 700, 2 px steps | scroll 26 to 56 | fits down to 490 px, at 488 px scroll 40 | n/a |
| Duration / Year / Bitrate at 40 px, centre | "0:03" / "2026" / "320 / kbps" | identical boxes (5.1..34.9, 2.6..37.4, 5.1..34.9) | as R15 |
| Sample rate "44100" | whole, -1.8..41.8, past both borders | **"441..."** inside 0..40 | "441..." |
| Size "156.41 KiB" | "156.41 / KiB", -3.3..43.3, past both borders | **"156.... / KiB"** inside 0..40 | "156.... / KiB" |
| Compact Bitrate / Size / Date added | "32..." / "156.4..." past the borders / "Oc..." | "32..." / "156...." inside / "Oc..." | as R15 |
| Large Date added | "Oct / 22, / 2026" | identical | identical |
| Start aligned Duration, Year | "0:...", "2..." | **"0:03" at 8..37.7, "2026" at 5.1..40** | identical |
| End aligned Duration, Year | "0:03"; "2026" from -2.9, into the previous cell | "0:03" 2.3..32; "2026" 0..34.9 | identical |
| Number cells past their border (Library Tracks, every size, row size and alignment) | **40 of 364** (Sample rate 30, Size 4, end-aligned Year 6) | **0 of 364** | 0 of 706 (R15 28) |
| Same, a selected row, extra columns, left / scrolled right | 3 / 4 | 0 / 0 | 0 |
| Header vs first row, 1440 / 1100 / 800, extra columns | max difference 0 | 0 | 0 |
| Shift+wheel frames, 3 runs x 20 ticks, p50 / p95 / max (ms) | 1440: 16.7 / 16.7 to 16.8 / 16.8 (scrolls 12); 1100: same (36); 800: same (156); extra 1440: same (332) | 1440 and 1100: no scroll; 800: 16.7 / 16.7 to 16.8 / 16.8 (156); extra 1440: same (332) | not measured |
| Vertical wheel, 4 runs, p50 / p95 / max | 16.7 / 16.7 to 16.8 / 16.8 | 16.7 / 16.7 to 16.8 / 16.8, one 33.3 ms frame in run 3 | not measured |
| Time to first rows (Albums to Tracks click), median [min, max] | 209.8 [189.5, 255.2] ms of 10 (192.1 of 5 earlier) | 215.6 [192.5, 231.8] ms of 10 (213 of 5 earlier) | not measured |
| Text cells at 40 px (Album, Album artist, Artist, Genre, Path) | 2 lines or more, clipped mid-glyph, no ellipsis, no tooltip | one line, ellipsis, `title` with the full text on hover | identical |
| Rating stars on a hovered row (80 px) | 12.5 px inside either edge | identical | identical |
| Album drag +10 / +25 / +160 at 1440 (shown, wanted) | 50 (50) / 65 (65) / 200 (200) | 48 (48) / **68 (63)** / 198 (198) | n/a (R16 VM: 48 / 68 / 198) |
| Title drag +10 / +20 at 1440 | 210 / 220 exact | **198 (202) / 198 (212)**, table fits | 198 / 198 |
| Title -20 at 1440 (B-273) | shows 200, saves own width **1** | shows 192, saves **1** | saves 1 |
| Album -120 at 1440 | **16 px**, saves 24, Genre 58 | **16 px**, saves 24, Genre 58 | not walked |
| Click on the handle (twice after each of 9 drags) | no change | no change | no change |
| Playlist / Now Playing 1440 / 1100 / 800 / 480 | 36 200 60 182 181 121 36 / ... / 24 200 40 72 72 48 24, no scroll | identical widths | identical |
| Full-screen queue 1440 / 1100 / 800 / 480 | 688 / 518 / 368 / 480 px, no scroll | identical | identical |
| Album table (Hits Flag 4) 1440 / 1100 / 800 / 480 | 62 498 125 75 / ... / 35 277 70 42 | identical | identical |
| Side queue 360 / narrowest (250 px table) | no scroll, "0:01" whole | identical; handle back at 1072 | identical |
| Tracks at the narrowest window (480) | scroll 48 | scroll 48, identical widths | not walked |

## Per item

### 1. The threshold (R16)

Each 1 px step was read 6 times at 60 ms, then held and read 10 times at 200 ms. After: from window 1425 down to 1413
the table fits exactly (Title 182 down to 172, Album and Genre 34 to 36); at 1412 (488 px of table) one change to
Title 200, every number column 40, scroll 40; the same step on the way up. Within each step's first 360 ms two width
sets were seen (the old, then the new, the tracker's debounce), and none of the 2 s holds changed again: no
oscillation. Header and rows aligned at every step (difference 0). Before: one width set throughout, scroll 27 to 52.

### 2. Number cells at the floor (R17, B-271)

The after build reads every number the way the before build did wherever the value fits the padding box, in compact,
default and large rows: "0:03", "2026", "320 / kbps" ("32..." compact), Disc "0", Track "1", Plays "0", Date added
"Oct / 22..." (default), "Oc..." (compact), "Oct / 22, / 2026" (large), Last played "3 / da...". Where it does not fit
("44100", "156.41 KiB"), the after build ends it in an ellipsis inside the cell. Shots
`after-extra-1440x900-right.png` beside `before-extra-1440x900-right.png` (the before shows "44100" touching
"kbps").

Clones of a live Duration cell with the review's values (`clone.mjs`, both builds' own CSS) give the same values as
the VM's R17 table to 0.1 px: after "480...", "441...", "10,0...", "12,3...", "1:02..." inside 0..40 in every
alignment; "10:03", "45:12", "2026", "1,234", "0:03" whole in every alignment (start "2026" 5.1..40, end 0..34.9).
Before: the same values centred run past both borders, end aligned up to 18.7 px into the previous cell, start
aligned cut to "4...", "1:...", "2...".

**Pixels.** In the 1440 shots with the 8 extra columns scrolled right, the 2 px just outside the Sample rate cell's
borders hold 37 (left) and 109 (right) bright pixels on the before build and 0 and 0 on the after; outside the Size
cell 44 and 32 against 0 and 0.

### 3. No overlap

0 of 364 number cells drew past their border on the after build (every size, row size and alignment of item 2), 40
of 364 on the before. A selected row: 0 left and 0 right on the after (3 and 4 on the before). The header and the
first row's cells have the same x and width at 1440, 1100 and 800 (difference 0) on both builds. Near the resize
handle (reasoned): the handle sits on the header's border and no after number draws past its cell border, so none
reaches it; a number under a dragged handle was not looked at.

### 4. Text cells (R16)

Album, Album artist, Artist, Composer, Genre, Genre (badges), Comment and Path turned on (13 columns at 40 px; scroll
250 at 1440 and 92 at 1600 on both builds). After: every text cell one line with an ellipsis; `title` on hover with
the full text where cut ("Wysea Live", "Static Signals", "Jazz" for the badge, the full Path); none on uncut cells,
the numbers or the row index. Links click through: Album to `#/library/albums/...`, Genre to `#/library/genres/...`,
Album artist to `#/library/album-artists/...`, and the app's Back returns to Tracks each time. Row heights 66 on both
builds. Before: Album and the artists on two lines clipped mid-glyph ("Hit|", "Roc|" in the full-screen queue at
800), Path on 5 or 6 lines, no tooltip anywhere. The light wash (Settings, cover tint Light, then Dark again): the
same widths, the same ellipses and titles; `after-light-text-1440x900.png` read back, "W...", "St...", the "J..."
badge legible.

The native tooltip on screen was **not captured**: a CDP capture does not include it, and the only way to grab the
desktop here is KWin's screenshot interface, which this walk may not call.

### 5. Rating and icons

In the band (1440 and 1100) the stars of a hovered row sit 12.5 px inside either edge of their 80 px cell on both
builds; the heart and the row index keep 24 px, Rating 80, every number column 40. Only Title, Album and Genre give.

### 6. Drags

Values in the table above. Inside the jump the after build lands up to 14 px off (Title +20 ends at 198, Album +25 at
68 with the table scrolling 40), as the VM saw. Every drag past the jump lands where released. The two clicks on the
handle after every drag changed nothing, shown or saved. **B-273 as seen here:** Title -20 shows its floor and saves
own width 1 on both builds. **New: Album dragged -120 ends at 16 px on both builds** (saved own width 24, Genre takes
the rest at 58): the column draws only "..." and its header label disappears (`after-album-drag-minus120.png`). At
1600 the same saved width gives Album 16 again. Widths reset through the table settings after each drag.

### 7. Other tables

Playlist ("R1 colour walk"), Now Playing, the full-screen queue, the album table (Hits Flag 4), the side queue at 360
and its narrowest, and Library Tracks at 480: widths and sideways scroll are identical on both builds at every size
(diff of the two logs: only text-cell lines and Library Tracks' own 12 -> 0 change). Every number in them reads
whole on both builds ("0:01", "1976", "1986", Year at 48 px "1976"). Look changes where nothing overflowed: text cells
in the full-screen queue at 480 read "Hits Fl..." on one line where the before wrapped "Hits Flag / 8" whole on two
(R16's one-line rule). 375 px could not be reached (the window stops at 480).

### 8. Speed

Vertical wheel frames are the same on both builds (16.7 / 16.8 / 16.8, one 33.3 ms frame in one after run; R15's
walk saw one such frame too). Time to first rows after the Tracks click, 10 runs each: 209.8 ms median before, 215.6
after, ranges overlapping (189.5 to 255.2 against 192.5 to 231.8). A 6 ms median difference inside the spread; no
visible cost.

### 9. Anything else

- **B-272 on this machine:** "Pop" in a 40 px Genre cell draws "P..." (zoomed shot `after-pop-cell-800.png`), and its
  hover gives no `title` (glyphs 8..32.4 in a box 8..32).
- Escape does not clear a row selection on Library Tracks, on either build (13 cells stay selected). The VM's script
  assumed it would. Not filed: a selection is not obviously meant to clear on Escape.

## Bugs found

- **New (B-277), pre-existing on both builds:** a column dragged far below its floor is left narrower than it.
  Album -120 at 1440 lands at 16 px (own width 24), drawing "..." under a header with no label, while Genre widens to
  58. Title -20 instead returns to its floor (B-273); the two paths disagree.
- B-272 confirmed on this machine (above).
- Nothing new from R16 or R17.

## B-274 on this machine

The running app measures this machine's Figtree exactly as the VM's: "44100" is **43.6 px** wide, "2026" 34.8 px
(VM 43.6 and 34.9). The earlier "41.1 px on the workstation" came from an offscreen dpr-1 reproduction, not the app.
So against R17's 40 px padding box (39 to 40 px) "44100" is **3.6 px too wide** and draws "441..." with the full value
on hover; "156.41 KiB" is 46.5 px, **6.5 px too wide**, "156.... / KiB". Both watched on the after build, in every row
size, at 1440 x 900. Every 44.1 kHz row and every file of 100 KiB or more at the floor reads this way here too.

## Not verified

Watched running, but not here:

- The native tooltip appearing on screen (see item 4).
- A 375 px window (the window stops at 480; the VM emulated 375).
- Padding sizes other than `sm`; an hour-long duration, a five-digit play count or BPM in real rows (stand-in data:
  clones only); Genre (badges) with two or more real genres; Composer and Comment with data.
- A remote device's queue (the hub stayed off).

Reasoned from code, not watched:

- That the threshold's single change also holds while a horizontal scrollbar appears in other tables (none of them
  overflowed here).
