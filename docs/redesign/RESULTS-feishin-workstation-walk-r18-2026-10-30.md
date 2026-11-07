# Results: R18 walked on the workstation

Written 2026-10-30 by the workstation walk agent. One walk of repair round R18 (B-284 hero photo, B-285 sideways
rows, B-286 Fresh shelf) on the owner's machine: Fedora, KDE Plasma on Wayland, real window sizes, this machine's
fonts and real 60 Hz frames (the session was unlocked at every check, 19:52 to 21:30). No app code was changed. Every
value below was watched on this machine unless a line says it was reasoned.

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `.worktrees/r18-before/feishin` (detached worktree, removed at the end) | `f3426aa9b` | 9371 | `~/.cache/feishin-walk-r18-2026-10-30/cfg-before` |
| after | `.worktrees/repair-r18/feishin` (`fix/hero-chips-fresh-2026-10-30`) | `8fadb9b79` (code `9ded2d76d`) | 9372 | `.../cfg-after` |

- **Builds.** Before: `pnpm install --frozen-lockfile --offline` exit 0, `pnpm run build` exit 0. After: `pnpm run
  build` exit 0 (the lockfile and `package.json` do not differ between the two commits). One build at a time, no app
  up, about 5.3 GB available. No typecheck, no branch switched, both trees clean.
- **Data.** The VM's shared stand-in Navidrome (4533) through my own `ssh -N -L 14533` (`ControlMaster=no`, own pid).
  My own copy of the VM lane's `r18_fake.py` on the VM's 4951 and my own scratch hub from `~/src/navi-connect/hub` on
  4953 / 4952 (state and logs in `~/standins/run/r18-ws/`), `LBBOT_URL` at my fake, moods from the loopback AudioMuse
  stand-in (4880, only read), the hub tunnelled here as 14953. A throwaway hub token was generated in one shell, handed
  to the hub over stdin and written into the two scratch profiles by `hubcfg.mjs`, never printed or stored elsewhere.
  Both stopped by pid at the end and the ports read free; the shared 4533, 4880, 4897, 4898 / 4899 and 9222 were never
  touched and still listened at the end; `~/src/feishin-repair` was not touched.
- **Profiles.** Copies of the R16/R17 walk's logged-in profiles (`Stand-in` server at `127.0.0.1:14533`), hub on and
  pointed only at my hub. Nothing was played: the 1-song queue stayed paused and the bar muted; no `cast-*` device
  was touched (the cast bridge registered a LAN speaker with my hub, as it does).
- **Window.** Sized only by `window.resizeTo` over CDP, which sets the inner size here. Got every size asked exactly:
  1600 x 900, 1440 x 900, 1312 x 773, 1312 x 700, 1280 x 900, 1100 x 700, 960 x 700, 800 x 600, 600 x 700 and 480 x 700;
  480 is the narrowest the window allows. **`devicePixelRatio` is 2**, not 1.2: the app disables Chromium's Wayland
  fractional scale (B-209), so under KDE's 1.2 it rasterises at 2, and that is what the owner sees. One extra launch of
  the after build with `--force-device-scale-factor=1.2` (an app flag, nothing in KDE) re-ran the 1.2 cases; it gave
  1439 x 900 for 1440 and 1312 x 699 for 1312 x 700 (one px short), labelled "forced 1.2" below.
- **Scripts.** The VM lane's probes (`heroprobe.js`, `chipsprobe.js`, `chips.mjs`, `chipkeys.mjs`, `tabs.mjs`,
  `shift.mjs`, `quick.mjs`, `fresh.mjs`, `noRg.mjs`, `folded.mjs`, `fonts.mjs`) with the port, paths and sizing changed
  (real `resizeTo`, no emulation), plus new ones: `herows.mjs` and `framemon.js` (the hero per REAL frame: each rAF
  re-arms a fresh ResizeObserver so its read comes after the app's own observer and its `flushSync` fold, i.e. what
  that frame paints), `b290.mjs`, `tipshot.mjs`, `atend.mjs`, `speed.mjs`, `menuitem.mjs`. Everything in
  `~/.cache/feishin-walk-r18-2026-10-30/` (`r/`, `logs/`, `shots/`).
- **KDE.** `sha256sum ~/.config/kwinrc ~/.config/kwinoutputconfig.json ~/.config/kscreen/*` and read-only copies of
  `kwinoutputconfig.json` at the start and the end: identical (`kwinrc` `1ea3358e...`, `kwinoutputconfig.json`
  `a103a563...`). KDE rewrote `kwinoutputconfig.json` at 19:54:15 with the same content. `~/.config/kscreen/` does not
  exist. Nothing ran nested.sh, a compositor, dbus-run-session, kwin.sh, raise.sh, a KWin script, `org.kde.KWin`,
  kscreen-doctor or kwriteconfig.
- **Restores.** Fresh filters back to the profiles' starting values (read first: Your artists, All, 30 days, Newest)
  in both; queue shown and sidebar expanded again after every hide / collapse; the fake back to its normal mode; no
  rating, favourite or station chip touched.

## Before and after

Artist page "The Long Players" unless named; "photo" = photo bottom minus Play button bottom (0 = level).

| What | before `f3426aa9b` | after `9ded2d76d` | VM (R18 note) |
|---|---|---|---|
| Artist, queue docked: 1600 / 1440 / 1312 x 773 / 1312 x 700 | 1 line 0 / **2 lines 60** / **2, 60** / **2, 60** | full 0 / **icons 1 line 0** / icons 0 / icons 0 | same both builds |
| Same: 1280 / 1100 / 960 / 800 / 600 / 480 | 2, 60 / 2, 60 / 2, 60 / 2, 60 / 2, 60 / **4, 152** | stacked 60 / icons 0 / stacked 60 / stacked 60 / stacked 60 / stacked 60 | same |
| Artist, no queue: 1440 to 1280 / 1100 / 960 and down | 1, 0 / **2, 60** / 2, 60 (480: 4, 152) | full 0 / icons 0 / stacked 60 | same |
| Album "Hits Flag 4", queue docked | 2 lines 60 from 1440 to 800, 3 (106) at 600, 4 (152) at 480 | full 1600, icons 1440 / 1312 / 1100, stacked 1280 and 960 down, never more than 2 | same |
| Owner's size 1312 x 773, pixels (photo column vs Play column, last bright row) | photo 335.5, Play 275.5: **60 px low** | 277.5 / 277.5: **level** | n/a |
| Forced 1.2: 1599 / 1439 / 1312 x 773 / 1312 x 699 / 1100 x 699 / 799 | not run | full / icons / icons / icons / icons / stacked, photo 0 except stacked | identical |
| Slow real drag, 1500 to 480 to 1500 by 2 px (1022 resizes, ~3130 real frames each): frames painted wrapped | artist q **3126 of 3126**, artist no q 2197 of 3122, album q 3132 of 3132, album no q 2200 of 3131 | **0 of 3127, 0 of 3123, 0 of 3142, 0 of 3125** | 0 settled steps (forced frames) |
| Same: mode changes / console errors / ResizeObserver errors | (no modes) / 0 / 0 | 14 / 12 / 14 / 12, one per crossing / 0 / 0 | 15 / 12 / 15 / 13 / 0 |
| B-290: sidebar collapse, expand at 1440 (app menu), frames 2.5 s | 154 frames, 7 and 148 wrapped, end group jumps a line (286 to 227) | 0 wrapped, one mode flip each (icons to full at frame 10, back at frame 6), end group never moves (826, 227) | `stacked` on one line for a few frames |
| B-290: queue hide / show at 1440 and 1312 x 773 | 3 / 145 / 6 / 145 frames wrapped | 0 wrapped, one flip mid-slide, end group slides with the queue | not walked |
| Folded buttons at 1312 x 773 | labels | 36 x 36, icon offset 0 / 0, AX name = label (button / link), tooltip = label, captured on screen | same |
| Cold font reload (cache off) at 1200 no queue | `loadingdone` 2219 / 2659 ms, 2 lines | 2329 / 2800 ms; icons at 1200, full at 1300 | 2632 / 3210 ms, same |
| Library chips, plain wheel at 800 (122 hidden), 4 notches fwd / back | 0, 0, 0, 0 / 0 | 100, 122, 122, 122 (cancelled, cancelled, passed on, passed on) / 22, 0, 0, 0 | identical |
| Same at the owner's 1312 x 773 (78 hidden) | 0 | 78, 78, 78 (cancelled once) / 0 | not walked |
| Touchpad `deltaX` 120 / Shift+wheel / Ctrl+wheel | 120 / 100 / 0, no zoom | 120 not cancelled / 100 / 0, not cancelled, dpr stays 2 | identical |
| B-289: five quick notches then one back, Library 800 | 0 (no wheel) | **22** (3 runs, dpr 2); 120-px notches: 2 (2 runs); forced 1.2: **23.3** = 123 - 100 (3 runs), 120-px: 3.3 | 22 at dpr 1, 39 at CDP 1.2 |
| Mood row (Home) 1100 / 800, artist chips 800 | plain wheel scrolls the page in both builds (row stays 0); Shift+wheel 100 (mood), 13.5 (artist) | same; end button glides to the end (161 / 13.5) and sets `data-start` | identical |
| Fades / buttons | Library row: fixed 94 % mask even when it fits; no buttons | only on a side with hidden content (0 / 32 px), the other button `inert`, opacity 0; buttons on the chips' centre (Library 177 / 177, mood 211.5 / 211.5, artist 442 / 442) | identical |
| After a chip click and the pointer leaving | no buttons | both buttons opacity 0, chip focused but not `:focus-visible` | identical |
| B-288: Tab to the first partly hidden chip, 800 | Library "Radio stations" 18.8 px past, artist "Soundtracks" 11.6 px past, `scrollLeft` 0, under the fade | **same positions, now under the shown end button**; mood "Workout" 1.3 px inside the edge, also covered by the end button; Tab to the next chip scrolls (mood "Commute" scrollLeft 160.5) | 18.9 / 11.6 |
| Station chips (now-playing page) | 4 chips fit at 1600, 1100, 800, 480 | same, no fade, both buttons `inert` | fit at every width |
| Rows that fit, pixel diff (> 8 levels) | | Library 1600 / 1100: 0 px; mood 1600: 0; artist 1600: 0 (after clip 4 px shorter); artist 1100 chip band: 0; **station 1600 / 1100 / 800 / 480: ~1200 px**, all glyph edges | 0 (station not compared) |
| Library head, 1440 / 1312 / 1100 wide | 900 and 773: column, slot 28 px from the right; 700: row, slot flush right (gap 0) | identical; the frame (not the scroller) is the head's child, `flex 1 1 auto` | identical |
| Fresh: Home shelf vs the page's first 20 | always 20 owned rows in feed order | equal in all 7 cases | equal (Home only) |
| Fresh: Discover shelf vs the page | always the same owned rows | **equal in all 7 cases** (found: Library, More, Discover) | not reached |
| Hub `GET /lb/fresh-releases` | 10, 11 at 7 days, 12 when a Home / Discover visit refetched 30 days, 13 at 90 days | 5, 6 at 7 days, 7 at 90 days; no Home or Discover visit added one | 8, 9, 10 |
| Frames during the window drag, p50 / p95 / max, >25 ms | 16.7 / 16.8 / 66.6 to 66.7, 2 to 6 per drag | 16.7 / 16.7 to 16.8 / 66.7 to 116.7, 7 to 16 per drag | not measured (locked) |
| Frames while wheeling the Library chips at 800 (3 runs x 5 rounds) | 16.7 / 16.7 to 16.8 / 16.8, 0 long | 16.7 / 16.8 / 16.8 to 17.5, 0 long | not measured |
| Time to the Home Fresh shelf's first tile (Library to Home click, 10 runs) | median 175.0 ms [162.6, 232.8] | median 166.8 ms [160.1, 199.8] | not measured |

## Per item

### 1. The hero (B-284)

The owner's complaint reproduces on the before build at the owner's size: at 1312 x 773 with the queue docked the row
wraps, the rating group drops onto its own line and the photo sits 60 px below the buttons (pixel-sampled on the shot:
last bright row of the photo column 335.5, of the Play column 275.5). On the after build the same size shows the
icons, one line, photo level (277.5 / 277.5). Shots `before-hero-artist-1312x773-q.png` /
`after-hero-artist-1312x773-q.png`, and the album pair `*-hero-album-1312x773-q.png`.

**Thresholds here** (window widths, real resizes, after build): artist, queue docked, going down: icons at 1500
(full needs about a 677 px row, so about 1549 px with the queue docked, reasoned from the no-queue crossing), stacked
at 1280, icons again at 1176 (the queue folds to its rail), stacked at 964, icons at 896 (the sidebar folds), stacked at
812, icons at 768 (sidebar hidden), stacked at 656; the way up mirrors them within 2 px, except that the queue's
rail unfolds at 1206 going up (it folds at 1176 going down). No queue: full to icons at
1232, stacked at 964. Album: 1296, 1178, 980, 896, 828, 768, 672; no queue 1256 and 980. These are the VM's values (its
table at 1440 / 1312 / 1280 / 1100 / 960 matches this one cell for cell): the font difference the brief expected did
not move a threshold by a walked width.

**Drags.** Four slow drags per build, 1022 real resizes each (~52 s, about three real frames per step). Per real frame
the row was read after the app's own observer: the after build painted a wrapped row in 0 of 12,517 frames, the before
in 10,655 of 12,511. Every after mode change is one per crossing (no flip back at the next step) and no "stacked on one
line" read appeared in any drag, including the sidebar folds at 1176 and 896 (B-290's widths on the VM). 0 console
errors, 0 warnings, 0 ResizeObserver errors in both builds.

**Folded buttons.** 36 x 36, the icon centred; the accessibility tree names them Shuffle / Artist radio / View all
tracks (button, button, link) and Play next / Add to queue / Album radio; the app's tooltip (a DOM tooltip, so a window
capture includes it) shows the label: `after-tip-artist-1312x773.png` ("Shuffle" above the button) and
`after-tip-album-1312x773.png`. A cold reload (cache off) at 1200 x 900 without the queue: fonts arrived at 2.3 s and
2.8 s, the row read icons at 1200 and full again at 1300, so labels come back where they fit.

### 2. B-290: sidebar and queue with the hero on screen

The VM's transient (`stacked` on one line while a sidebar animates) did not appear in real frames here: collapsing and
expanding the sidebar from the app menu at 1440 x 900 flips the mode once (icons to full at frame 10, back at frame 6)
and the end group stays at (826, 227) the whole time; at 1312 x 773 the mode does not change. Hiding and showing the
queue flips the mode once, mid-slide, and the end group slides with the panel. 0 wrapped frames in 8 actions. The
before build shows the second line for 145 to 154 frames whenever the column is narrow and the rating group jumps a
line.

### 3. Sideways rows (B-285, B-288, B-289)

- **Wheel delta.** A real notch could not be measured: the only input here is CDP's (`deltaMode` 0), and real mouse
  input would mean driving the owner's desktop. Series were run with 100 (the VM's) and 120.
- Library chips at the owner's 1312 x 773 already overflow (766 in 688): before, a wheel did nothing; after, one notch
  reaches the end (78) and the next ones pass on. Shots `before-row-lib-1312.png` / `after-row-lib-1312.png` (the 32 px
  fade over the hidden "More").
- Page rows (mood, artist) leave the plain wheel to the page in both builds, as designed; Shift+wheel, a touchpad
  swipe and the end button reach the end.
- Ctrl+wheel: the row does not take it and the app does not zoom (dpr stays 2; nothing to restore).
- A click where the hidden start button sits lands on the row (Library: the scroller's padding; mood "Relax", artist
  "Popular releases": the chip).
- **B-289 does not reproduce here**: 22 every time at the owner's real dpr 2, and 23.3 (the correct 123 - 100) at a
  forced 1.2, against 39 on the loaded VM.
- **B-288 reproduces** as on the VM, and the mood row adds a case: "Workout" sits 1.3 px inside the edge but under the
  shown end button.
- **New: at a fractional scale the end never reads as reached** (forced 1.2, Library at 799 px): wheel, the end button
  and Shift+wheel all stop at `scrollLeft` 122.5 with `scrollWidth - clientWidth` = 123 (box 643.19 px), so the row keeps
  `data-end`, the end fade and the "Scroll right" button at the end (`after-atend-lib-800-dpr1.2.png`: both buttons
  up). At dpr 2 the end reads correctly. Filed as B-292.

### 4. Fresh shelf (B-286), Home and Discover

**Discover found by clicking**: Library, the More chip, "Discover" in its menu opens `#/explore`, whose first row is
the Fresh shelf titled "Fresh releases". (The VM's `t=Discover` step clicks the smallest element whose text is
"Discover", which on that page is the queue header's Discover station segment; that is the likely reason the VM saw a
"Your artists" page, and why its two profiles disagreed on the station chip.)

| Filters | page rows | after: Home = page's first 20 | after: Discover | after reason line | before (both shelves) |
|---|---|---|---|---|---|
| defaults (Your artists, All, 30, Newest) | 28 | yes (No Group Owned at 4th) | yes | "New releases from artists already in your library" | 20 owned in feed order (no No Group Owned) |
| All + 7 days | 20 | yes | yes | "... across ListenBrainz, from any artist in the last 7 days" | unchanged |
| Artists you play | 9 | yes (9) | yes | "... from the artists you play most" | unchanged |
| Your artists + EPs | 6 | yes (6) | yes | "... in your library · EPs" | unchanged |
| Artist A-Z | 28 | yes | yes | "... in your library" | unchanged |
| plays + 7 days + Other | 0 | shelf not drawn | not drawn | | unchanged (20) |
| All + 30 | 56 | yes | yes | "... from any artist" | unchanged |
| older lb-bot, plays stored, 90 days | 31 (reads Your artists) | yes | yes | "... in your library in the last 90 days" | unchanged |

No release group: with All, "No Group Far" (shelf page 2) and "No Group Owned" (page 3) are inert tiles with no acquire
control; a click on each left Home where it was. The before shelf never showed either. Shots `*-fresh-<case>-home.png`
and `*-fresh-<case>-discover.png` per case (for example `after-fresh-ep-home.png` with " · EPs").

### 5. Speed

The drag frames have the same p50 and p95 in both builds; the after build had more long frames per drag (7 to 16
over 25 ms against 2 to 6, max up to 116.7 ms against 66.7) out of about 3130. They were not attributed to an event
(the monitor keeps intervals only as totals); one fold per crossing (12 to 14 per drag) is the likely source, reasoned.
Wheeling the chips: no frame over 17.5 ms either way. Home's Fresh shelf appears 8 ms sooner on the median (within the
spread). Nothing here is visible at a glance.

### 6. Other things an owner would see

- The Fresh shelf is titled "Fresh" on Home and "Fresh releases" on Discover, with the same reason line under both
  (both builds; `after-fresh-ep-home.png`, `before-fresh-ep-discover.png`). Filed as B-294.
- At 700 px tall the sidebar's "Playlists" header is cut through its middle by the scroll area above "You" (both
  builds, `after-lib-1312x700.png`). Filed as B-295.
- The station chips' text lost its subpixel (LCD) antialiasing on the after build: the row now always carries a mask,
  which puts it on its own layer; ~1200 glyph-edge pixels differ by up to 93 levels, the colour fringes are gone. The
  other rows already had a mask before, so all four rows now render text alike. Filed as B-293 (cosmetic).

## Bugs found

- **B-292** (low): at a fractional device scale a sideways row at its end keeps `data-end`, the end fade and the
  "Scroll right" button (forced 1.2, Library at 799 px: `scrollLeft` stops at 122.5 of 123). Not on the owner's
  current dpr 2.
- **B-293** (low, cosmetic): station chips' text loses subpixel antialiasing on the after build.
- **B-294** (low): the Fresh shelf's title differs between Home ("Fresh") and Discover ("Fresh releases"). Pre-dates R18.
- **B-295** (low): the sidebar's "Playlists" header is half hidden at a 700 px tall window. Pre-dates R18.
- B-288 confirmed here (plus the mood row's "Workout"); B-289 and B-290 not reproduced in real frames.

## Not verified

**Watched running, but only partly:**

- A real mouse notch's `deltaY` and a real touchpad (CDP events only; 100 and 120 used).
- The native OS tooltip: the app's tooltip is a DOM element and was captured; no OS-level tooltip exists to capture.
- Long drag frames were counted, not attributed to the fold or the sidebar animation.
- Forced 1.2 is Chromium at 1.2, not KDE's Xwayland path; the owner's app runs at dpr 2 (B-209).
- The station row's overflow: four chips fit even at 480 px, so its wheel, fades and buttons were not reached.

**Reasoned from code only:**

- The full-to-icons threshold with the queue docked (about 1549 px) from the no-queue crossing.
- RTL rows and the web build.
