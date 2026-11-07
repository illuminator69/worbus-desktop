# Results: the hero keeps its photo aligned, sideways rows scroll with a mouse, the Fresh shelf follows the page (R18)

Written 2026-10-30 by R18's fix agent.

- **Plan:** `navi-connect/PLAN-feishin-hero-chips-fresh-2026-10-30.md`. **Items:** B-284, B-285, B-286.
- **Branch:** `fix/hero-chips-fresh-2026-10-30`, cut from `feat/redesign` @`f3426aa9b`. Not pushed to GitHub, not merged.
- **VM numbers** come from the sandbox VM (nested, VirGL), production builds. The GNOME session was locked, so
  frames were forced (`--disable-gpu-vsync --disable-frame-rate-limit`) in both builds alike. No frame times are
  quoted. Geometry, DOM attributes, scroll positions and request counts are the evidence. Window sizes are CDP
  emulation (dpr 1, and 1.2 where named). Another session ran an Android emulator on the VM during the walk (load
  average up to 150 at the end; the VM dropped off the network for about two minutes once).

## Commits

| Commit | What |
|---|---|
| `6a7debd48` | Implementer, B-284: hero buttons fold to icons before they wrap |
| `ff62e7ba1` | Implementer, B-285: sideways rows scroll with a mouse wheel and show where more is |
| `437980e79` | Implementer, B-286: the Fresh shelf shows the Fresh page's releases with its filters |
| `9ded2d76d` | Fix pass: review findings I-1, M-2 to M-9, M-11, M-12 |
| this note | `docs(ui): hero, sideways rows and Fresh shelf walked on the VM` |

## The fix pass (review findings, controller rulings)

| Finding | Fix | Check (red on `437980e79`, green on `9ded2d76d`) |
|---|---|---|
| I-1 Library head under 760 px tall | `SidewaysRow` takes `frameProps`; the Library chips put `data-library-chips` on the frame, the head's own child | `theLibraryHeadRuleReachesTheFrame` (grep-only) |
| M-2 a "ResizeObserver loop" error per fold | the full row never wraps, so a fold inside the observer callback leaves the row's height alone; only a folded row wraps, in layout | `aFoldNeverChangesTheRowsHeight` (grep-only) |
| M-3 a late font leaves labels folded | `document.fonts` `loadingdone` bumps the content key, so both widths are measured again | `aLateFontMeasuresBothModesAgain` (grep-only) |
| M-4 scroll buttons stay up after a chip click | `:focus-within` became `.frame:has(:focus-visible)` | `theButtonsShowOnHoverAndOnKeyboardFocusOnly` (grep-only) |
| M-5 Ctrl+wheel / pinch scrolls the chips | `ctrlKey` / `metaKey` wheels are the browser's | `aCtrlOrMetaWheelIsTheBrowsersZoom` (pure) |
| M-6 artist row buttons 4 px off centre | the artist row's padding is symmetric, the space below is the frame's margin | `theButtonsSitOnTheChipsCentre` (computed from each row's padding and margin) |
| M-7 View all tracks icon | `playlist` (LuListMusic) | `everyLabelledHeroButtonHasAnIcon` |
| M-8 a no-release-group tile opens a broken page | `freshTileTarget`, one rule for the page and the shelf: no click and no acquire without an album or a release group | `aTileWithNoReleaseGroupOpensNothing` (pure plus grep) |
| M-9 the reason line hides a type filter | " · EPs" (the type's word from `FRESH_TYPE_WORDS`, which the page's chips read too) | `theReasonFollowsTheScopeAndNamesAWindowThatIsNot30Days` |
| M-11 two spellings, observers, every-render reads | the page calls `freshScopeInEffect`; `SidewaysRow` observes and lets go of chips through a `MutationObserver`; both components read layout only on resize, scroll, mutation, a mode or a font | `layoutIsReadOnResizeScrollAndMutationNotEveryRender`, `theRowIsMeasuredOnResizeNotEveryRender` (grep-only), the page check |
| M-12 a tautological shelf test | `theShelfIsThePagesFirstRows` now checks ids written out by hand | the old test passes with the week order reversed, the new one fails (`fix-m12-mutation.log`) |

**Grep-only checks, named as such.** These read source text and pin a spelling, not a behaviour:
`collapsedButtonsKeepTheirNames`, `theDecisionComesFromAMeasurementNotAThreshold`, `theRowsMechanism`,
`everySidewaysRowUsesTheOneMechanism`, `thePageAndTheShelfReadTheSameFunctionsAndTheSameQuery`, and the new
`theLibraryHeadRuleReachesTheFrame`, `aFoldNeverChangesTheRowsHeight`, `aLateFontMeasuresBothModesAgain`,
`theButtonsShowOnHoverAndOnKeyboardFocusOnly`, `layoutIsReadOnResizeScrollAndMutationNotEveryRender`,
`theRowIsMeasuredOnResizeNotEveryRender`. Nobody should count them as behavioural tests. The walk below is what shows
the behaviour.

## Gates (workstation, at `9ded2d76d`)

| Gate | Result |
|---|---|
| New checks red first (`fix-red.log`, `fix-red-fresh-stubbed.log`) | 10 of 27 fail in the hero and row harnesses; the Fresh harness fails to load (new exports missing), and with stub exports 3 of 13 fail |
| Every harness, `node --test $(git ls-files 'src/**/*.harness.ts')` | 1260 tests, 1260 pass, 0 fail, exit 0 (1251 + 9) |
| `tsc --noEmit --composite false`, web / node | exit 0 / exit 0, 0 errors after filtering TS6307 |
| `eslint --max-warnings=0` (12 TS files) / `stylelint --max-warnings=0` (4 CSS files) | exit 0 / exit 0 |
| `pnpm build:web` / `pnpm build:remote` | exit 0 / exit 0 |
| VM: `pnpm install --frozen-lockfile --offline` and `pnpm run build`, before (`f3426aa9`) and after (`9ded2d76`) | exit 0 each |
| commitlint, em dash in added lines, attribution | 0, 0, none |

Logs are in `.superpowers/sdd/PLAN-feishin-hero-chips-fresh-2026-10-30/logs/fix-*.log`.

## The walk on the VM

| Build | Worktree | Commit | CDP port |
|---|---|---|---|
| before | `~/src/feishin-r18-before` (a worktree of `~/src/feishin-repair`, branch `r18-before`) | `f3426aa9` | 9381 |
| after | `~/src/feishin-r18-after` (branch `fix/hero-chips-fresh-2026-10-30`) | `9ded2d76` | 9382 |

- **Profiles:** copies of R17's scratch profile, pointed at my own scratch hub (`127.0.0.1:4953`, health 4952, a
  throwaway token generated at run time and never printed or stored by me) with `LBBOT_URL` at my own fake lb-bot
  (`~/standins/run/r18/r18_fake.py`, port 4951) and moods from the loopback AudioMuse stand-in (4880). Both builds
  connected as the same device (copied profile), one at a time. The shared app (9222), the shared stand-ins (4533,
  4897, 4899 / 4898) and `~/src/feishin-repair`'s checkout were not touched; all five ports were still listening at
  the end.
- **The fake's Fresh feed:** 62 rows, dates relative to the day (upcoming, this week, last week, 2 and 3 weeks ago,
  35 / 60 / 80 days ago, undated), owned and unowned artists in turn, `artistPlays` on some owned rows (and 0 on
  others), types Album, EP, Single, empty and Broadcast, and two rows with no release group and no album (one owned,
  one not). `/__mode?old=1` drops `artistPlays` from every row (an older lb-bot). Counts per window at `/__stats`.
- **Nothing was played.** No cast device was chosen (the app's cast bridge registered a LAN speaker with my hub,
  as it does; it was never a target).
- Navigation was by clicks (sidebar links, the search palette, the player bar's song title, the Library's More menu).
  Filters were set back to 30 days / Your artists / All / Newest at the end of each Fresh walk. The queue was hidden
  and shown again with its own button. Scripts and logs: `~/standins/run/r18/` on the VM, copied with the key shots to
  `~/.cache/feishin-r18-vm-2026-10-30/` here.

### 1. The hero at every width (B-284)

Rows: lines of the action row, then `data-mode` (after only), then the photo's bottom minus the Play button's bottom
in px (0 = level; 60 = the photo hangs a line low). Artist page "The Long Players", 900 px tall, dpr 1. The dpr 1.2
tables are identical value for value in both builds.

| width | before, queue docked | after, queue docked | before, no queue | after, no queue |
|---|---|---|---|---|
| 1600 | 1 line, 0 | full, 1, 0 | 1, 0 | full, 1, 0 |
| 1440 | **2 lines, 60** | icons, 1, 0 | 1, 0 | full, 1, 0 |
| 1312 (the owner's 1574 / 1.2) | **2, 60** | icons, 1, 0 | 1, 0 | full, 1, 0 |
| 1280 | 2, 60 | stacked, 2, 60 | 1, 0 | full, 1, 0 |
| 1100 | **2, 60** | icons, 1, 0 | **2, 60** | icons, 1, 0 |
| 960 | 2, 60 | stacked, 2, 60 | 2, 60 | stacked, 2, 60 |
| 800 | 2, 60 | stacked, 2, 60 | 2, 60 | stacked, 2, 60 |
| 600 | 2, 60 | stacked, 2, 60 | 2, 60 | stacked, 2, 60 |
| 480 | 4, 152 | stacked, 2, 60 | 4, 152 | stacked, 2, 60 |

- The album page ("Hits Flag 4") gives the same picture: queue docked, before 2 lines (60) from 1440 to 800, 3 lines
  (106) at 600, 4 (152) at 480; after full at 1600, icons at 1440 / 1312 / 1100, stacked (60) at 1280 and from 960
  down, never more than 2 lines.
- At the owner's size (1312 x 773 and x 700, dpr 1.2, queue docked) the after build shows icons, one line, photo
  level (0).
- "Stacked" is the ruled last resort (the icon row is about 410 px; the column is narrower than that at 1280 with
  the queue docked, and from about 964 px down). There the photo still sits a line low, as designed.
- The column width is not monotonic in the window width (the sidebar collapses at about 1178 px, again at 898, the
  queue undocks at 768), so a drag crosses the thresholds several times.

**The drag** (1500 to 560 to 1500 px by 2 px, 942 steps, a new observer each step that reads the row after the app's
own observer, plus the state each step settles in):

| drag | before: steps settled wrapped | after: steps settled wrapped / mode changes | console errors (CDP + window), both |
|---|---|---|---|
| artist, queue docked | 942 of 942 | 0 / 15 | 0 |
| artist, queue docked, dpr 1.2 | 942 of 942 | 0 / 15 | 0 |
| artist, no queue | 650 of 942 | 0 / 12 | 0 |
| album, queue docked | 942 of 942 | 0 / 15 | 0 |
| album, no queue | 650 of 942 | 0 / 13 | 0 |

- Every mode change is one per threshold crossing (no change back at the next step), and no "ResizeObserver loop"
  error fired in any drag (M-2).
- One transient, found by the trace: while a sidebar animates its collapse (at 898 and 1178 px) the row reads
  `stacked` on one line for a few observer reads before it turns `icons`, so the end group sits at the left for those
  frames. Filed as a new bug (see Bugs).
- An earlier version of the monitor (one observer for the whole drag) reported 2 "wrapped" reads per drag and lost
  the row when the page re-mounted it at 768 px; that was the monitor (an app observer re-created after a font load
  runs after it), not the app, and the per-step monitor above replaced it.

**Folded buttons** (after, 1440, queue docked, icons): artist Shuffle / Artist radio / View all tracks and album Play
next / Add to queue / Album radio are 36 x 36, the icon centred (offset 0, 0), accessible name = label from the
accessibility tree (roles button / link), and the app's tooltip shows the label on hover. View all tracks folds to
the list-of-music icon (M-7).

**Font timing (M-3):** a reload with the cache off at 1200 px (no queue): `loadingdone` fired at 2632 ms (Figtree,
Inter) and 3210 ms (Bricolage Grotesque); the row then read icons at 1200 and full at 1300 (labels back).

### 2. Wheel and touchpad on every sideways row (B-285)

**Library chips** (chrome row; 800 px: 766 px of chips in 644, so 122 px hidden):

| | before | after |
|---|---|---|
| plain wheel, 4 notches forward | `scrollLeft` 0, 0, 0, 0 | 100, 122, 122, 122 (cancelled, cancelled, passed on, passed on) |
| plain wheel, 4 notches back | 0 | 22, 0, 0, 0 (cancelled, cancelled, passed on, passed on) |
| touchpad sideways (`deltaX` 120) | 120, not cancelled | 120, not cancelled |
| Shift+wheel | 100 | 100, not cancelled |
| Ctrl+wheel | 0, not cancelled | 0, not cancelled, devicePixelRatio unchanged (M-5) |
| five quick notches, one back | 0 | settles at 22 (= 122 - 100) at dpr 1; **39 at dpr 1.2** (two runs; see Bugs) |
| at dpr 1.2, 4 notches forward / back | | 83, 115, 122, 122 / 39, 0, 0, 0 (sampled mid-glide) |

The head is fixed, so a wheel passed on at an end scrolls nothing. At 1100 px the row fits (792 in 792): nothing is
cancelled, no fade, both buttons `inert`.

**Mood chips** (Home, a page row; 800 px: 749 in 588): the plain wheel scrolls the page (row 0, page 100, 200, 300,
400), never cancelled, in both builds; Shift+wheel 100 and the touchpad 161 (the end) in the after build; the end
button press glides to 161 with `data-start` set.

**Artist discography chips** (a page row; 800 px: 598 in 584): the plain wheel scrolls the page (row 0) in both;
after: Shift+wheel and the end button both reach 14 (the end).

**Station chips** (the now-playing page's queue head): four chips fit at every width walked (1600, 1100, 800, 600,
480, 400 px), so the overflow cases could not be reached there. Fitting, the after build shows no fade (0 px / 0 px)
and both buttons `inert`.

### 3. Fades and buttons tell the truth

- After, Library 800 at the start: `data-end` only, fades 0 / 32 px, end button not `inert` and shown on hover,
  start button `inert` (opacity 0, no pointer events). At the end: `data-start` only, 32 / 0, start button shown.
  Back at the start: the end again. Mood 1100 / 800 and artist 800 the same at the start. Before: no buttons; the
  Library row wears its fixed 94 % mask even when it fits.
- A click where the hidden start button sits lands on the chip under it (mood "Relax", artist "Popular releases").
- The end button sits on the chips' centre on all three overflowing rows: Library 177 / 177, mood 211.5 / 211.5,
  artist 442 / 442 (M-6; the implementer's build had it 4 px low on the artist row).
- After a mouse click on a chip and the pointer leaving, both buttons are at opacity 0 (Library 800, artist 800;
  M-4). The clicked chip keeps focus, not `:focus-visible`.
- **Rows that fit, pixel-compared:** Library at 1600 and 1100 and the mood row at 1600: 0 px differ. Artist row at
  1600: 0 px differ over the common 62 px (the after clip is 4 px shorter because the scroller box no longer carries
  the 8 px bottom padding; the chips and the row below sit where they did). Station row: the profiles disagreed on
  the selected chip (before "Off", after "Discover", with the queue's Autoplay switch off / on), so no like-for-like
  compare; I clicked no station chip and found no step of mine that changed it.
- **Keyboard focus** (Tab through each row): every chip is `:focus-visible`, but a chip only partly hidden is **not
  scrolled into view**: Library 800 "Radio stations" ends 18.9 px past the row's edge, artist 800 "Soundtracks" 11.6
  px, `scrollLeft` stays 0, and the shown end button covers it. The base did the same on the artist row (11.6 px past,
  under its fade, no button). `scroll-padding-inline` does not help: Chromium does not scroll a partly visible
  focused element. See Bugs.

### 4. The Library head in a short window (I-1)

Library (Artists), queue docked; "slot gap" is the head's right edge minus the page controls' right edge.

| height | before (`f3426aa9`) | after (`9ded2d76`) |
|---|---|---|
| 900 / 773 / 760 | column, slot in the title row 28 px from the right | the same |
| 759 / 740 / 700 (1440 wide) | row, chips 248 to 849.3 (`flex 1 1 auto`, the nav), slot 849.3 to 1064, gap 0 | row, chips 248 to 849.3 (`flex 1 1 auto`, the frame), slot 849.3 to 1064, gap 0 |
| 740 / 700 (1100 wide) | slot 825.3 to 1040, gap 0 | the same |

The head band of the 1440 x 740 and 1100 x 700 shots differs only where the chips meet the slot (the base's fixed
mask against the new 32 px fade). The implementer's `437980e79` was not built; that its slot sat after the More chip
is the review's reading of the code.

### 5. The shelf equals the page (B-286), and requests

Home's Fresh shelf (read page by page with the carousel's own next button) against the Fresh page's first 20 ids:

| filters | page rows | after: shelf = page's first 20 | after: reason line | before: shelf |
|---|---|---|---|---|
| defaults (30 days, Your artists, All, Newest) | 28 | yes (20) | "New releases from artists already in your library" | 20 owned rows in feed order: differs at index 3 (the page has "No Group Owned" there) |
| All + 7 days | 20 | yes (20) | "... across ListenBrainz, from any artist in the last 7 days" | unchanged (owned, 30 days) |
| Artists you play | 9 | yes (9) | "... from the artists you play most" | unchanged |
| Your artists + EPs | 6 | yes (6) | "... already in your library · EPs" | unchanged |
| Your artists + A-Z | 28 | yes (20) | "... already in your library" | unchanged |
| Artists you play + 7 days + Other (nothing) | 0 | the shelf is not drawn | | unchanged (20) |
| All + 30 days | 56 | yes (20) | "... across ListenBrainz, from any artist" | unchanged |
| older lb-bot, stored Artists you play, 90 days | 31 (reads Your artists; no plays chip) | yes (20) | "... already in your library in the last 90 days" | unchanged |

- **No release group (M-8):** with All, "No Group Far" (shelf page 2) and "No Group Owned" (page 3) are inert tiles
  with no acquire control, and a click on each left the page where it was. The page's tiles were inert in both builds.
  The before shelf never showed either (owned rows only, and "No Group Owned" sits at the feed's end).
- **Requests** (`GET /lb/fresh-releases` lines in my hub's log; upstream fetches at the fake): after, 8 at the start,
  9 after the page moved to 7 days, 10 after 90 days; seven visits to Home between page steps added none, so Home
  never fetched a second window. Before: 5, then 6 (7 days), 7 (90 days). Upstream over both walks: 30 days 5,
  7 days 2, 90 days 2 (the hub caches for 60 s; the app keeps a window for 10 min and persists it).
- **Discover:** the More menu's "Discover" opened a page headed "Your artists" with no Discover rows on this
  stand-in, so the Discover shelf was not seen. It is the same `FreshRow` as Home's (reasoned from code).

## Bugs found

1. Keyboard focus on a chip partly past a sideways row's edge does not scroll it into view; the shown scroll button
   then covers it (Library 800 px "Radio stations" 18.9 px past, artist 800 px "Soundtracks" 11.6 px).
2. At dpr 1.2 a quick series of five wheel notches and one back settles at 39 instead of 22 on the Library row at 800
   px (two runs; 22 at dpr 1). The cause was not found.
3. While a sidebar animates its collapse the hero row stays `stacked` on one line for a few frames before `icons`,
   so the end group jumps from the left to the right.

## Not verified

**Watched running, but only partly:**

- Frames: the session was locked and frames forced, so "no wrapped row painted" is the observer's read after the
  app's own observer plus the settled state per step, not a frame capture.
- The station row's overflow (it never overflowed with four chips) and the Discover shelf (not on screen here).
- The quick-series result at dpr 1.2 under a load average above 100.
- The implementer's build (`437980e79`) was not walked; I-1 and M-2 to M-6 are compared against the base and the
  review's reading.

**Reasoned from code only:**

- The owner's GPU, display scale (Xwayland 1.2 is CDP dpr 1.2 here), fonts and a real mouse wheel and touchpad (the
  wheel events were CDP's, `deltaMode` 0); judged later on the workstation.
- RTL rows (`scrollLeft` sign); the web build's Ctrl+wheel zoom (Electron did not zoom on Ctrl+wheel here, and the
  row did not cancel it).
- The Discover shelf following the filters, by being the same component as Home's.
