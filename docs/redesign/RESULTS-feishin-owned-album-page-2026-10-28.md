# Results: R3, the owned album page

Plan: `PLAN-feishin-owned-album-page-2026-10-28.md` (outside the repo, in the umbrella's `navi-connect/`). Branch
`fix/owned-album-page-2026-10-28`, local only, never pushed. Written 2026-10-28 by the lane's fix agent, after the fixes and
the walk on the sandbox VM.

**Base.** Cut from R2's final tip `a63260a8` (`fix/short-artist-page-2026-10-28`). The branch has six commits on top.

| Commit | What |
|---|---|
| `2bcb3a43` | The album header as drawn: 184 px cover, 48 px title, kicker, meta line, labelled actions |
| `245ab0bd` | About beside the tags and links, the tracklist toolbar, credits and carousels below the tracklist |
| `cf5da9be` | The pinned table header and disc row on the shell's variables (L5-01) |
| `32bf2f19` | A name-only album artist stays on the meta line |
| `dbd3ca9f` | Fix I-1: the mobile layout defines the three heights the pin reads |
| `2a112a39` | Fixes M-2, M-3, M-5: the About clamp, the search ring, the order chip's name |

## What changed

- The album header uses R2's `LibraryHeader` hero (184 px cover, 48 px title) and R2's `HeroActions`: Play, Play next, Add to
  queue, Album radio (outlined, busy while it works), then rating, favourite and more. The kicker is the release type. The meta
  line is the album artist in the accent, the release date, songs and minutes, size and plays, each only when known.
- Under the header sits the board's two column row: About on the left (three lines, a toggle when it overflows, the open state
  kept per album for the session), genres, tags, the record label and links on the right. One column when only one side has
  anything, nothing when neither does.
- The tracklist has the board's toolbar: a 240 px "Search tracks" field, a "Sort: <field>" chip, an order chip beside it, and
  the table settings button at the right. lb-bot's credits and the carousels follow the tracklist.
- The pinned table header and the pinned disc row sit at window bar + top bar + page title row, read from the shell's CSS
  variables (`--window-bar-height`, `--top-bar-height`, `--page-header-height`), not from the old 65 / 95 px.
- Fixes after the lane review: the mobile layout (window width 768 px or less) now defines the three variables, so the pin is
  not at 0 there (I-1); the clamped About shows three whole lines when a paragraph break falls inside them (M-2); the search
  field shows the board's focus ring, an inset 2 px of the accent (M-3); the order chip is named "Sort order: Ascending" or
  "Sort order: Descending" (M-5).

## Gates

Run on the finished branch at `2a112a39`, on the workstation.

| Gate | Command | Result |
|---|---|---|
| Web build | `pnpm build:web` | exit 0 |
| Remote build | `pnpm build:remote` | exit 0 |
| tsc, renderer | `tsc --noEmit -p tsconfig.web.json --composite false`, TS6307 filtered | no output |
| tsc, main | `tsc --noEmit -p tsconfig.node.json --composite false`, TS6307 filtered | no output |
| eslint | `--max-warnings=0` over the 11 ts/tsx files changed since `a63260a8` | exit 0 |
| stylelint | `--max-warnings=0` over the 6 CSS files changed since `a63260a8` | exit 0 |
| Harnesses | `node --test $(git ls-files 'src/**/*.harness.ts')` | 74 files, 972 pass, 0 fail |
| commitlint | `commitlint --from 2302d69a --to HEAD` | clean, no warnings |
| Em dash | added lines in `a63260a8..HEAD` | 0 |

The 8 new harness cases: 5 in `album-page-layout.harness.ts` (the About row rule), 3 in `sticky-offset.harness.ts` (the
source guard, the arithmetic, and both layout stylesheets defining the three variables). The last one was watched failing
first: `the mobile layout's .layout does not define --window-bar-height`.

The VM builds: `pnpm build` of `a63260a8` and of `2a112a39` in the VM clone, both exit 0.

## Rulings

From the lane ledger, as recorded:

- The meta separator is ` · ` (R2's artist header), not the board's ` - `. Kept at review: one separator across the hero pages.
- The kicker is the album's release type (Album / EP / Single, else "Album") plus its edition, unlinked. Kept at review: more
  accurate than the plan's literal "Album".
- The meta line drops the original date, the track-year range and the explicit status; explicit stays among the tags.
- Album radio is busy on `isPlayerFetching` or a local pending flag around the whole handler, because the station path runs
  outside the player's fetch key.
- More's accessible name reuses `page.library.more` ("More").
- Commit scopes: the plans' `albums` / `table` were not in commitlint's scope-enum; R2 and R3 were reworded to `library` / `ui`
  (controller ruling).
- The sort chip names the id order "Track number" on this page only.
- The order toggle is a 30 px chip beside the sort chip, not inside the menu.
- lb-bot's prose is rendered inside the About clamp, its attribution and links in a footer outside it, not through `MetaAbout`.
- lb-bot's own links stay under its prose, not in the right column (they arrive late).
- Tag group titles are gone: chips only, the record label as "Record label: X".
- The About row is one column below the `sm` container breakpoint even when both sides have content.
- The About open state is a module-level set per album id, for the session only.
- The page title row's height is the shell variable `--page-header-height: 65px`, read by `page-header.module.css`.
- The pinned top is 117 px (Linux / web bar) and 147 px (Windows / macOS bars), read with `getComputedStyle` and re-read on a
  window bar style change.
- The in-view margins are minus (pinned top + the table header's height).
- `use-sticky-table-group-rows.tsx` carried the same offsets and is fixed and guarded too.
- `useShellPinnedTop` reads in a passive effect, not a layout effect.
- The dead `.header-window-bar` rule is deleted; `.header-fixed` takes the calc of the three variables.

## Deferred minors

- M-1: the "Album" tag chip repeats the kicker.
- M-4: `.header-fixed` is unreferenced by any TSX (kept, the guard holds it).
- Collapsing a long About that was opened needs a scroll back up to the toggle.
- The original date, Shuffle and the long-press play variants are not on the hero.

## Review Focus

1. **No About, no tags, no links.** The pure rule returns `none` (harness `emptyAboutRowRendersNothing`). On the VM no stand-in
   album lacks links (the settings-enabled services always add them), so `none` was not seen; `side-only` was: "Signal Fires"
   with lb-bot's meta set to `empty` shows one column of chips and links, no "About" label, first track row at 504.
2. **A long About.** Watched with a 2,343 character About (below): three lines and the toggle; open pushes the toolbar down by
   647 px and the toggle stays at 318; closed returns the toolbar to 431.
3. **The pinned header.** Watched at 800 x 600 with the queue closed and open, and at 760 x 600 (mobile layout): its top equals
   the title row's bottom each time. The VM draws the Windows window bar (30 px), so 147 px was watched; the Linux / web 117 px
   and the macOS bar were not.
4. **Multi-disc and 40-track albums.** Not watched: the stand-in library's longest album has 11 tracks and none has a second
   disc. Search, sort, order and table settings were watched on a 9-track album.
5. **Album radio busy.** Watched: disabled and `aria-busy` in the same tick as the press, a second press lands on a disabled
   button, one `getSimilarSongs` request. See the crash below, which is not R3's.

## Watched running on the VM

Production builds, CDP emulation 1440 x 900 at dpr 1 unless stated, stand-in Navidrome, fake lb-bot, scratch hub. Local
playback only: the app was not connected to any device (the hub logged "Feishin" itself as the active device throughout).

**"Hits Flag 4" at 1440 x 900, before (`a63260a8`) and after (`2a112a39`):**

| | Before | After |
|---|---|---|
| First track row top | 845.2 | 529.1 (target at most 560) |
| Cover | 225 x 225, radius 5 px, top 165 | 184 x 184, radius 8 px, top 110 |
| Title | 33.96 px | 48 px |
| About row | none (About, Credits, tags and links stacked) | `two`, columns 744 px + 300 px, 318 to 431 |
| Toolbar | a full-width search bar at 757 | 58 px row at 431; search 240 x 34; "Sort: Track number" 175 x 30; order chip 30 x 30; Table settings 36 x 36 |
| Actions | icon buttons | Play 52, "Play next" 89 x 36, "Add to queue" 115 x 36, "Album radio" 131 x 36, favourite, More |

**About on a long text.** No stand-in album has a `comment` tag (all 8,814 albums checked in the stand-in database), and none of
the albums opened showed Navidrome notes. A long About was made to appear through the fake lb-bot: a new mode `meta=long` in `~/standins/tools/f7_fake.py`
(the original kept as `~/standins/run/r3/f7_fake.py.orig`) answers `/api/meta/album` with six paragraphs, 2,343 characters,
the first one a single line. Shown on "Undertow" (an album whose meta the app had not cached). Collapsed: text box 65.1 px (3
x 21.7 px line height), toggle "Expand" at 318, toolbar at 431.1, first row at 529.1. Open: text 712.3 px, toggle "Collapse"
still at 318, toolbar at 1078.3, first row at 1176.3. Closed again: back to 65.1 / 431.1 / 529.1. Opened, left for the Albums
list and came back: still open (session memory).

**M-2, the clamp at a paragraph break.** On that text the break falls after line 1. While clamped the paragraph gap is 0 px
(open, 8 px). The screenshot shows three whole lines: the one-line first paragraph, then two lines of the second ending in an
ellipsis; a pixel scan of the About column finds no text between the text box's bottom (407) and the attribution footer (417).

**Toolbar.** Search focused: computed `box-shadow` is `rgb(193, 217, 255) 0px 0px 0px 2px inset`, the accent, and the pixels at
the field's edge read the accent while the inside reads the field's fill. Typing a term with no match leaves 0 rows; clearing
brings back 9. The order chip reads "Sort order: Ascending", then after a press "Sort order: Descending" with rows 9, 8, 7. The
sort chip opens the sort menu (19 fields, "Track number" first); picking "Name" relabels the chip "Sort: Name", picking "Track
number" returns it. Table settings opens the existing settings modal (size, header, borders, columns); a click outside closes it.
The VM's locked session leaves the window unfocused, so `:focus` needed CDP's focus emulation to match.

**Play next / Add to queue** on "Undertow" (9 tracks), with the side queue open: Up next 18, then 27 after Play next with Undertow
1 to 4 straight after the current track, then 36 after Add to queue. Nothing was played.

**Album radio.** Pressed twice in one task: the first press makes the button disabled with `aria-busy="true"` in the same tick,
the second press lands on the disabled button, and the radio made one `getSimilarSongs` request; busy for 124 ms, then the app's
"Discard the current queue?" dialog. While the dialog was open the queue was unchanged (Up next 36).

**Pinned header, "Small Hours" (11 tracks), scrolled until it pins:**

| Size | Layout | Before: pinned top / title row bottom | After: pinned top / title row bottom |
|---|---|---|---|
| 800 x 600, queue closed | default | 95 / 147 (52 px under the title row) | 147 / 147 |
| 800 x 600, queue open | default | not measured | 147 / 147 |
| 760 x 600, queue closed | mobile | 95 / 95 | 95 / 95 (variables 30 + 0 + 65) |

Before the I-1 fix the mobile layout defined none of the three variables, so R3's pin would have read 0 there; the guard shows
it, the 760 px row shows the fix.

**A no-About album** ("Signal Fires", meta `empty`): row `side-only`, one 1076 px column, first track row at 504.

### Found on the walk: Album radio, then Confirm, crashes the app (not R3)

Album radio, then Confirm in "Discard the current queue?", replaces the queue with the radio's songs and then the whole app
shows "An error occurred": React's "Too many re-renders", thrown in `<BaseImage>` (`src/shared/components/image/image.tsx`).
It reproduces on R2's tip `a63260a8` with R2's own album radio button, so it is older than R3. Play (replace the queue with
the album) and the artist page's Artist radio, each through the same dialog, did not crash. A likely cause, read and not
proven: `BaseImage` sets state during render, adding `displaySrc` to `shown` when it is not the top entry and clearing `shown`
when `gone` (`!src || isError`); while `displaySrc` is still set and `gone` is true the two branches undo each other on every
render. Not fixed here: it is shared image code outside R3, and the reload restores the app.

## VM numbers (not the owner's GPU)

The VM's GNOME session was locked (`LockedHint` yes) for the whole walk, so every frame number is invalid (`valid: false`, the
window runs at about 2 fps). Only frame-free numbers are compared. Frames move to the workstation walk.

`Albums > "Hits Flag 4"` x 10, one warm-up round, production builds, 1440 x 900, same VM boot, script
`~/standins/run/r3/album-push.mjs` (CDP `Performance.getMetrics` deltas over 2,000 ms; ttc polled with `setTimeout(1)` to the
first track row inside the viewport):

| Median (range) | Before `a63260a8` | After `2a112a39` |
|---|---|---|
| TaskDuration, ms | 284 (274 to 300) | 282.5 (240 to 310) |
| ScriptDuration, ms | 165 (151 to 175) | 156 (116 to 175) |
| RecalcStyleDuration, ms | 41 (39 to 46) | 36.5 (35 to 38) |
| LayoutDuration, ms | 20.5 (18 to 21) | 23 (20 to 26) |
| DOM nodes in `main` | 421 | 400 |
| Time to first row, ms (frame-free) | 174.5 (164 to 180) | 155 (115 to 176) |
| First row top | 845.2 | 529.1 |

The push costs the same; the page has 21 fewer nodes. The before run used lb-bot's `ok` About; the after run used the same
text from the app's cache (the fake was switched to `long` only for "Undertow").

## Not verified

- The owner's GPU and library, real covers, and every frame number (the VM session was locked).
- The Linux / web window bar (117 px pin) and the macOS bar: the VM shows the Windows bar only. The guard and the arithmetic
  are the proof for the other two.
- An album with no About, no tags and no links (`none`) on screen; a multi-disc album's pinned disc row; a 40-track album.
- An About from Navidrome `notes` or a `comment` tag with HTML markup: only lb-bot's paragraphs were shown.
- Album radio's queue after Confirm, because of the crash above.
