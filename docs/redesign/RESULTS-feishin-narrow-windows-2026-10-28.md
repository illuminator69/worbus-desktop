# Results: R6, narrow and short windows

Plan: `PLAN-feishin-narrow-windows-2026-10-28.md` (kept outside the repo, in `navi-connect/`). Branch `fix/narrow-windows-2026-10-28`, rebased by
the controller onto R5's final tip `853afeb0`. Written 2026-10-28 after the walk on the VM. Covers BACKLOG B-207 (the queue and the Tracks
columns on a narrow or short window), B-198 (the sidebar on a narrow window) and B-211 (the bar's seek row). All three are fixed but not yet
confirmed on the owner's machine.

One implementer lane (Tasks 1 to 3), one review of the whole lane (spec met; one Important finding, six Minor), one fix agent: the code fixes in
four commits, then Task 4 (the seek row, measured before and after on the VM), then this walk.

| Commit | Subject |
|---|---|
| `7ff9af71` | feat(ui): a rule for folding the queue and the sidebar on narrow windows (Task 1) |
| `0864c7bf` | feat(ui): fold the queue to its rail below 1180 px and the sidebar below 900 (B-207, B-198) (Task 2) |
| `9c828f40` | feat(player): lyrics as a 40 px strip that opens, the queue keeps its rows (B-207) (Task 3) |
| `19f797bb` | fix(player): the queue keeps its rows in a short window (B-207) (review: Important) |
| `a653a3f7` | fix(ui): the overlaid queue stays open for the player bar and a drag (B-207) (review: two Minors) |
| `c61fb6dc` | fix(window): the title bar, the menus and the sidebar handle follow the fold (B-207, B-198) (review: two Minors) |
| `9cffcd4f` | fix(lyrics): the strip folds tall and its arrows order lyrics and visualiser (B-207) (review: two Minors) |
| `4be2adec` | fix(player): the seek row as wide as the transport and centred under it (B-211) (Task 4) |

## Gates

| Check | Result |
|---|---|
| `tsc -p tsconfig.web.json` / `-p tsconfig.node.json` (TS6307 filtered) | clean / clean |
| eslint, stylelint `--max-warnings=0` on every changed file | clean |
| Every harness, `node --test $(git ls-files 'src/**/*.harness.ts')` | 1015 pass, 0 fail |
| The lane's harnesses | `shell-fit` (7), `panel-order` (3), `narrow-windows` (5 source guards), `seek-row` (2). Every case failed before its change was made: `shell-fit`, `panel-order` and `seek-row` because their module did not exist yet, and `narrow-windows` against `git archive 9473aa8a` |
| `pnpm build:web`, `pnpm build:remote` | both exit 0 (at `4be2adec`) |
| `commitlint --from 2302d69a --to HEAD` | 0 errors, 1 warning: `footer-leading-blank` on R4's `fix(ui): a forward push opens a page at its top (B-208)`. That commit belongs to R4, so it is left as it is. This lane's commits are clean |

## Rulings (from the lane ledger)

- The fold state lives in a zustand store that is not persisted (`use-shell-fit.ts`). `MainContent` mounts the one rAF-throttled window listener
  (`useShellFitTracker`), and readers use `useShellFit` / `useSidebarFolded`. The first fit is measured when the module loads. Why: several
  components need the same hysteresis state, and a narrow window should open already folded rather than animate into the fold. Cost if wrong: one
  more indirection to move into the app store later.
- The fold is applied where the flags are read for display (main-content classes, the left sidebar's rail choice, `use-right-sidebar-visible`).
  Nothing writes `sidebar.collapsed` or `sidebar.rightExpanded`. Why: Global Constraint. Cost if wrong: none known.
- Only the horizontal side queue folds. The vertical layout and the drawer and popover queue types are untouched, because they take no width.
  Cost if wrong: a user of the vertical layout at 800 px keeps a narrow page (the sidebar still folds).
- The folded queue opens as an overlay beside the rail: the panel's width, a shadow, z-index 192 (above the page header's 190, under the bar's
  200). It opens from the rail, the bar's queue button or the toggle hotkey. It is transient (not persisted) and is reset when the window widens
  past 1204. Why: Review Focus 2. Cost if wrong: an overlay that should survive a widen closes instead.
- The overlay closes on Escape, unless the event was defaultPrevented or came from a portal, and on a click outside it: amended in the fix round
  from a pointerdown to a capture-phase click, with the player bar added to the keepers. Clicks in portals do not close it. It opens with a 300 ms
  slide-in and closes instantly. Why: a row's context menu must not close the queue under it. Cost if wrong: see the Escape-in-search finding.
- The overlay keeps the queue's resize handle. A drag writes `rightWidth`, which is the user's own action, and the panel uses that width when it
  unfolds. Cost if wrong: a reviewer may want the handle hidden in the overlay.
- While the sidebar is folded for width, its resize drag is ignored. Amended in the fix round: the handle is hidden, and the app and native menus
  read collapsed-or-folded with the toggle off. Cost if wrong: none known.
- `left-controls.tsx` and `left-sidebar.tsx` belong to R5; R6's edits there are one-line hunks. Cost if wrong: a rebase conflict for the controller.
- Whenever the queue is one of the panels, the lyrics strip sits at the bottom of the panel. The order setting still orders lyrics against the
  visualiser; the old drag-resizable split stays only for the case without a queue. Cost if wrong: users who placed lyrics above the queue lose
  that placement.
- The strip's row is the area's header: "Lyrics" when lyrics are on, otherwise "Visualizer", with the microphone or audioLines icon. The open
  height is capped against the `queue-panel` size container. Cost if wrong: none known.
- Settings version 40 adds `general.queueLyricsOpen` (default false) in migrate, as F6's version 39 did. Cost if wrong: an import of a v39 export
  relies on the migrate step, as every other version does. Walked below.
- Short-height mode for the queue panel: the panel is a size container. In a short panel the "Playing from" lines, the status line and the
  station characters are hidden, the tabs and the count share one row, and the strip area is capped so the queue keeps 3 or more rows with the
  strip open and 6 or more with it folded at 1280 x 600. Why: the owner wanted the queue usable in short windows. The hidden lines return in a
  taller window. Cost if wrong: one CSS block to revert.
- The threshold is 580 px of panel, not 560. The full header, the strip row and six 48 px rows need 565. Cost if wrong: windows between about
  760 and 780 px tall lose the "Playing from" lines.
- The lyrics fetch now waits for the strip to open (the fetch lives in `<Lyrics>`, and nothing else listens). Harmless. Cost if wrong: a 500 ms
  debounce on opening.
- Task 4 moved to the fix agent, because it starts with a measurement on the VM. Cost if wrong: B-211 lands one agent later.

## Deferred minors

- **Escape in the overlay's search field closes the whole overlay**, and the typed search goes with it. Seen at 1100 x 700. A user who presses
  Escape to clear the search probably expects only the search to clear. Not fixed in this lane.
- **The 1280 x 800 case with the strip open:** at panel heights from 581 to about 707 px the full header (202 px here) still leaves fewer than three
  rows (2.69 at 1280 x 800). That is how it looked before this lane, and it was kept because taller windows had to stay unchanged.
- **`Input.insertText` into the overlay's search left the caret at 0**, so the text came out reversed ("eviL"). Real key events typed correctly
  in the overlay, and both methods worked in the unfolded panel. This is likely a CDP artifact, but IMEs commit text the same way, so it is worth
  one look.

## Found while walking (outside this lane)

- **Clearing a non-empty queue crashed the renderer to the error page.** React reported "Too many re-renders" in `<BaseImage>`. This happened
  twice on a copy of the scratch profile, at 1440 x 900 with the queue panel open and a cover in the bar. A reload recovers (with the queue
  empty). Likely cause: `BaseImage` in `src/shared/components/image/image.tsx` sets state during render, from `70406953` (2026-10-21, before
  R2). When the song goes away, `src` becomes undefined while `nativeImage.displaySrc` still holds the old URL. The first branch then appends it
  and the `gone` branch empties the list, and the two alternate on every render. R6 does not touch this file. I did not test it on another
  branch. Needs a BACKLOG line (left for the controller).

## Review Focus, answered

| # | Focus | Answer |
|---|---|---|
| 1 | Dragging the window edge across a threshold and back | Width stepped by 8 px, from 1260 to 1100 and back, and from 980 to 820 and back (41 steps each), at a height of 800. Queue: one flip each way, to the rail at 1172 and back to the panel at 1204. Sidebar: one flip each way. At 0.7 s per step the read showed the rail at 884; repeated at 1.5 s per step it showed rail at 892, still rail at 916, full at 924, which is the rule. The first read was simply late, because of the locked session's rAF. The user's flags were `{collapsed: false, rightExpanded: true}` before and after |
| 2 | Opening the queue while the window is narrow | At 800 and 1100 the bar's queue button opens the overlay beside the rail (screenshots), z-index 192. `elementFromPoint` at its corners hits the overlay, and it ends at 602 px, above the bar's 610. A click on the bar's time label or on the bar's background keeps it open. A click on the sidebar closes it, and so does a plain Escape. Escape in its `...` menu closes only the menu. Escape in its search closes the overlay (deferred minor). A track dragged from the Tracks page (native drag) dropped into it: the overlay stayed open and the queue went from 20 to 21 songs. The flags did not change |
| 3 | The lyrics strip | Folded: the "Lyrics" label and an up chevron. Open: the area above the row, which shows "No lyrics found" (the stand-in songs have no lyrics). Open state across a song change (16/21 to 17/21): still open. After an app restart: still open (`queueLyricsOpen: true` read back), then folded again. With the visualiser on, the area holds two panels of 144 px each (lyrics and visualiser), both inside the tall Fold (`data-tall="true"`), unmounted 4 s after folding. The visualiser panel had no canvas while playback was paused, so its drawing was not seen. A song that has lyrics was not available |
| 4 | Seek row with a one-hour track | See "The seek row". The track does not move between "3:42" and "1:02:03" |
| 5 | Short windows, 1280 x 600 | Header 80 px. The list's `clientHeight` is 299 (6.23 rows) with the strip folded and 159 (3.31 rows) with it open (the area is 140 px, capped by `calc(100cqh - 280px)`) |

## Watched running, per size

Setup: the sandbox VM, the dev build of the clone at this branch, the scratch profile, the stand-in Navidrome, the scratch hub and the fake
lb-bot. Sizes were held by CDP emulation (`Emulation.setDeviceMetricsOverride`, dpr 1). Each size change fired exactly one `resize` event (counted
with a listener), and `innerWidth` followed, so the fold's own listener ran as it would for a real resize. Clearing the override fires no resize
event, so a read straight after a clear shows a stale fold. Navigation was done by clicking: the sidebar's Library link, then the Tracks chip.
The GNOME session was locked throughout (`LockedHint=yes`), so frames were throttled. Geometry was read after the layout settled, at 2.5 s or
later. **Every number here is a VM number.**

"Content" is the width of `main`. "Title" is the width of the Tracks table's Title column. Queue rows are the queue list's `clientHeight` / 48:
first with the strip folded, then with it open.

| Size | Queue closed: rails, content, title | Queue open: rails, content, title | Queue header, rows folded / open |
|---|---|---|---|
| 800 x 600 | sidebar rail, queue rail; 644, 128 | sidebar rail, queue rail; 644, 128 | overlay 420 px: header 80; 6.23 / 3.31 |
| 1100 x 700 | full, queue rail; 792, 157 | full, queue rail; 792, 157 | overlay 520 px: header 80; 8.31 / 3.98 |
| 1280 x 600 | full, queue rail; 972, 192 | full, panel; 656, 130 | panel 420: header 80; 6.23 / 3.31 |
| 1280 x 800 | full, queue rail; 972, 192 | full, panel; 656, 130 | panel 620: header 202; 7.85 / 2.69 |
| 1440 x 900 | full, queue rail; 1132, 224 | full, panel; 816, 161 | panel 720: header 202; 9.94 / 3.94 |
| 1920 x 1080 | full, queue rail; 1612, 318 | full, panel; 1296, 256 | panel 900: header 202; 13.69 / about 7.0 |

- B-207's case, 1100 x 700 with the queue open: the Title column is 157 px, where it used to be one letter wide.
- The 800 x 600 page first read 492 px at 2.5 s. 644 px is the settled value: a re-read at 5.5 s gave 644, the same as with the queue open. The
  grid tween crawls when frames are throttled.
- 1920 x 1080 with the strip open: the 2.5 s read came before the Fold had opened. The screenshot shows it open with the 320 px area, so the rows
  are computed: 900 - 202 - 41 - 320 = 337 px, about 7.0 rows.
- `40cqh` holds where it applies. The area is 0.4 times the panel at 1100 (overlay 520 gives 208), 1280 x 800 (620 gives 248) and 1440 (720
  gives 288). The 320 px cap wins at 1920 (900), and `100cqh - 280px` wins at 420 px panels (140).
- The empty queue was checked on a copy of the scratch profile, after a reload: "0 songs, 0 min". Header 202 at 1440 and 80 at 1280 x 600, and
  the strip still at the bottom.
- v39 to v40, on a **copy** of the scratch profile (deleted afterwards). The persisted settings were rewritten as version 39 without
  `queueLyricsOpen`, with one marker (`sidebarPanelOrder` reversed) to prove the reload read this record, and then the app was reloaded.
  Result: version 40, `queueLyricsOpen: false` added, the marker kept, and every other key equal to the original.
- After the walk, the user's queue flag was put back to closed and the strip back to folded, as found. The scratch queue gained one track (from
  the drag test, 21 songs) and now sits at song 17.

Screenshots of every size (queue closed and open, the strip open, the overlay) are in the lane workspace,
`.superpowers/sdd/PLAN-feishin-narrow-windows-2026-10-28/shots/` (`repair-r6-size-*`). Each was read back.

## The seek row (B-211), before and after

The owner's request: shrink the progress slider "so that it looks centered, along with the elements above it". These are VM numbers from the dev
build, with playback paused. Durations were set as DOM text ("1:13" / "3:42" and "1:02:03" / "1:02:03") because the stand-in's tracks are 2 to 4
s long. The transport has six buttons: shuffle and previous on the left of play, and next, repeat and shuffle all on the right. Its button group
is 256 px wide, but it is not symmetric about play: it reaches 106 px to the left of play's centre and 150 px to the right.

| Window | Measure | Before (`9cffcd4f`) | After (`4be2adec`) |
|---|---|---|---|
| 1440 x 900 (centre column 420) | track centre - play centre | 0 px | 0 px |
| | seek row width - button group width | +164 px (420 vs 256) | 0 px (256 vs 256) |
| | track width | 280 px | 116 px |
| | row edges vs the outer buttons (left, right) | -104, +60 | -22, -22 |
| 1100 x 700 (centre column 300) | track centre - play centre | 0 px | 0 px |
| | seek row width - button group width | +44 px (300 vs 256) | 0 px |
| | track width | 160 px | 116 px |
| | row edges vs the outer buttons | -44, 0 | -22, -22 |
| both | "3:42" to "1:02:03" | track unmoved, labels 23.9 to 40.8 px | track unmoved, labels 23.9 to 40.8 px in fixed 56 px columns, tabular numerals |

Both of the plan's criteria hold: the track's centre is on play within 1 px, and the row is as wide as the button group within 2 px. Because the
group is not symmetric, the row hangs 22 px past shuffle on the left and stops 22 px short of shuffle all on the right. For comparison only (not
built), `repair-r6-seek-ALT-edges-not-built-*.png` shows the same row moved to the buttons' edges, so its centre sits 22 px right of play. That
choice belongs to the owner. Screenshots: `repair-r6-seek-before-*` and `repair-r6-seek-after-*` at both widths and both durations, read back.

## Not verified

- The owner's GPU and display scale. All of the above is the VM, with the session locked: frames were throttled to a few per second, so no
  motion quality was judged (the grid tween, the overlay slide-in and the strip's Fold were seen only as start and end states).
- Windows and macOS window bars. Linux ran with the WINDOWS bar style. The macOS native menu item's enabled state cannot be checked here.
- A real window resize. Sizes were emulated; the resize event and `innerWidth` behaved as for a real one.
- A remote queue (another device playing). The scratch hub lists devices, including a real speaker on the LAN, and playback must not move there,
  so none was made active.
- A song with lyrics, and the visualiser drawing (it had no canvas while paused).
- The crash on clearing the queue on R5's tip without R6. Reasoned to be older than R6, not run there.
- The production Electron build (`pnpm build`): not run for this lane. Only `build:web` and `build:remote` were.
