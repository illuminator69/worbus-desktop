# Results: the lb-bot boxes and the re-render crash (R12) walked on the VM

Written 2026-10-28 by R12's fix agent. Plan: `navi-connect/PLAN-feishin-boxes-and-crash-2026-10-28.md`. Branch
`fix/boxes-and-crash-2026-10-28`, base `f8790ef3`. All numbers below are **VM numbers** (the sandbox VM, nested, VirGL),
taken with the GNOME session **locked**. They are positions, counts and stages, not frame times.

## Commits

| Commit | What |
|---|---|
| `f07665d5` | Task 1: `nextShown` in `shared/components/image/shown-stack.ts`. A cover that goes away clears the stack once instead of looping (B-229, B-210) |
| `86f0d074` | Task 2: `useKeepTopInView` brings the box's top back under the bar after a change that shrinks it (B-236) |
| `dfcba464` | Task 3: a refused Request shows under its own button, in lb-bot's words, with Search again for a stale list (B-238) |
| `168a7058` | Review F1: the move runs only when part of the box showed below the bar just before the change, so a fill ending while the user is down the tracklist moves nothing |
| `1a1f4c21` | Review F3: the refusal is matched to its card by folder (`sourceKey`), not by index |
| `f2fc412f` | Review F4: the missing album's Search again sends `refresh=1` |

## Gates (workstation, at `f2fc412f`)

- `node --test $(git ls-files 'src/**/*.harness.ts')`: 1120 tests, 1120 pass, 0 fail. That is 1102 at the base, 1115 at
  `dfcba464`, plus one keep-top case, one refusal case and three album-sources cases.
- `tsc --noEmit --composite false`:
  - `tsconfig.web.json`: 0 errors after filtering TS6307 (no TS6307 lines were printed either).
  - `tsconfig.node.json`: 0 errors.
- `eslint --max-warnings=0` on every .ts/.tsx changed since `f8790ef3`: exit 0. `stylelint --max-warnings=0` on the changed css:
  exit 0.
- `pnpm build:web` exit 0, `pnpm build:remote` exit 0. `commitlint --from f8790ef3`: exit 0.
- On the VM, `pnpm build:electron` exit 0 in both walked trees.

### The fixes' harness cases, each watched failing first

| Case | How it failed before the fix |
|---|---|
| `keep-top.harness.ts` `scrolledAwayNeverMoves` | Assertion: `-725` where `null` was expected |
| `source-cards-model.harness.ts` (a refusal stays with the folder it was asked for) | `refusalUnder` was not exported. Before it, the component matched the refusal by card index inline |
| `album-sources-params.harness.ts` `searchAgainAsksAfresh` | Assertion: `undefined` where `'1'` was expected. The params were first moved into a helper with no change in behaviour, and then the test ran |

## Setup

| | Tree | Commit | CDP | Profile |
|---|---|---|---|---|
| before | `~/src/feishin-r12-base` (a detached worktree made for this walk) | `f8790ef3` | 9272 | `~/standins/run/r12/cfgprod-base`, a copy of R11's production profile with a fresh `hub.deviceId` |
| after | `~/src/feishin-r12` (the implementer's worktree, moved to `tmp-r12`) | `f2fc412f` | 9271 | `~/standins/run/r12/cfgprod-after`, made the same way |

- **Builds.** Production builds (`electron .` on `out/`), one window at a time. The shared app on 9222 and R14's 9281 were never
  driven. The stand-ins on 4533, 4897 and 4899 were never restarted.
- **lb-bot.** R11's private stand-in, a fake lb-bot on 4907 behind its own scratch hub on 4909, was started with `stack-r11.sh`
  and stopped at the end. It carries two hooks, both marked R12 in the files, so that it refuses the way real lb-bot does
  (read from `listenbrainz_bot.py`):
  - `r11_gaps.py`, `grefuse=1`: the next gap fetch answers 400 `{code: "bad_source", error: "Source index out of range", ...}`,
    which is `_api_error_payload`'s shape. The existing "source not in the list" branch now answers the same way, instead
    of its old 200 `{ok: false}` with no code.
  - `f7_fake.py`, `drefuse=1`: the next album download answers 400 `{error: "Could not resolve album"}`. Real lb-bot's
    `/api/album/download` sends no code.
  - Both hooks are one-shot.
- **Window.** CDP emulation: 1440 x 900, and 800 x 600. The bar's real bottom is the sum of the shell's three variables, 147 px
  here, so the target line is 155.
- **Frames.** In the locked session the renderer gets about one frame a second. The crash counts and positions do not need
  frames. For the motion checks (B-236 B and D) the after app was relaunched with
  `--disable-gpu-vsync --disable-frame-rate-limit` so the motion runs over many frames.
- **Navigation.** By clicking only: Home, album tiles, the search palette, the artist link, the Albums chip and release tiles.
  Page positions were set by writing the scroller's `scrollTop`; the user's scroll was CDP wheel input.
- **Playback.** Local playback only, never transferred, no `cast-*` device touched.
- **The bar's cover.** This profile showed the sidebar's large cover, which hides the bar's cover. The sidebar cover was put away
  with its own button in both profiles, so that the component that looped (the bar's `<BaseImage>`) is on screen.
- **Passwords.** The stand-in password was read from `stack.sh` only. The implementer's `login.mjs` default and
  `dev.log` held it, and both were redacted in place.

## The crash (B-210, B-229): error pages per path, per build

All runs at 1440 x 900, production builds, the bar's cover shown. An error page is the root boundary's "An error occurred
Minified React error #301".

| Path (rounds) | before `f8790ef3` | after `f2fc412f` |
|---|---|---|
| Clear the queue with a song playing: Play "Two Disc Set", the queue's Clear, Confirm (10) | **10 of 10** | 0 of 10 |
| Five Nexts 400 ms apart: Play "Two Disc Set", then 5 x Next (10) | 0 of 10 | 0 of 10 |
| Auto DJ end of queue: Autoplay on, Play "Short Three" (3 songs), Next twice to song 3, Auto DJ appends 5, then two Nexts (10, and 10 more on the after build) | **6 of 10** | 0 of 20 |
| A Next onto a song with no cover: as above, paused on song 3 with its cover shown and the queue's Up next row showing no cover, then one Next (24 rounds; the Auto DJ pick decides whether a round qualifies) | **9 of the 9 qualifying rounds** (16 of 24 in all) | 0 of the 14 qualifying rounds (0 of 24); the bar then shows the empty-cover icon |
| One Next onto a song whose album has no art but which has a cover id, so Navidrome's placeholder shows (10) | 0 of 10 | 0 of 10 |

### How the "no cover" song came about

Nothing was made or written on the stand-in. No album on it has art: 8,816 album folders, no image files, and no embedded
APIC frame in 523 sampled files. What differs is the API path:

- Navidrome's native API gives each song a cover id anyway (Feishin's `imageId` is the song id), so those songs show
  Navidrome's placeholder.
- Its Subsonic `getRandomSongs` omits `coverArt` for 199 of 200 songs; only R9's two albums carry one.
- Auto DJ appends songs through that path. Those songs have no cover id, so the bar's `src` becomes undefined while the last
  image is still held.

That is the review's `left-controls.tsx:177-192` lead, and it is what B-229's "a Next near the end of a queue Auto DJ just
extended" does. The before build crashed on every qualifying round. The after build showed the empty-cover icon.

## B-236: the box's top after Request (after build)

The gaps box is Hollow Orchard / Undertow (`g-hollow-undertow`). The missing album's box is Hollow Orchard / Low Country.

| Box, size | Case | Before the press | After |
|---|---|---|---|
| gaps, 1440 x 900 | A: top in view | top 171 (line 155) | No move: scrollTop 296 throughout; top 171; stage active |
| gaps, 1440 x 900 | B: top under the bar, Request visible | top 27 | One move, scrollTop 440 to 312, top 155 on the line. With frames: 440, 403, 352, 328, 318, 314, 312, one direction |
| gaps, 1440 x 900 | C: Request, then the user wheels the box out of view (top -429, bottom -122) | stage active | Done at 10.3 s, folded away at 16.4 s; the element in the middle of the view moved 0 px. scrollTop changed 896 to 675 to 619 only by the browser's scroll anchoring as the box above shrank |
| gaps, 1440 x 900 | D: a wheel during the motion (frames on) | top 27 | The motion's writes ran 440 down to 347 and stopped at the wheel, with no write after it; top left at 120, not pulled to 155 |
| gaps, 800 x 600 | A | top 171 | No move (scrollTop 400) |
| gaps, 800 x 600 | B | top 31 | One move, 540 to 416, top 155. Locked: two frames about 1 s apart. With frames: 517 to 416 in 7 steps |
| gaps, 800 x 600 | C | | Done at 12.4 s, folded at 18.5 s, 0 px under the view's middle |
| gaps, 800 x 600 | D | top 31 | Stopped at the wheel at 456; top 115 |
| missing album, 1440 x 900 | A | top 171 | No move (scrollTop 267), view fill/active, box 974 to 281 px |
| missing album, 1440 x 900 | B | top 70 | One move, 368 to 283 in 6 steps (frames on), top 155 |
| missing album, 800 x 600 | B (two runs) | top 74; top -80 | One move each, to top 155 (481 to 400; 635 to 400) |

- **Before build at 1440 x 900, gaps B:** the top stayed at 27, under the bar, with scrollTop 440 unchanged. That is the bug
  as the workstation measured it (35 to 78 against 147).
- **Missing album's box, case A at 800 x 600:** not reachable. Its sources view is 998 px tall, so Download is only on screen
  once the top is under the bar.

## B-238: a refused Request (after build)

| Box, size | Refusal | Search again | A second press |
|---|---|---|---|
| gaps, 1440 x 900, card #2 picked (not the first card) | "Source index out of range" at 472..490, 12 px under that card's Request (424..460), same left edge (334). The only visible alert in the box. The box stays on the cards | At 496..590 x 468..494, on the sentence's centre line, 12 px to its right (`bad_source`). Pressed: searching, then the cards; the refusal is gone | Request: stage active |
| gaps, 800 x 600 | 12 px under the button, left 182 = 182 | Beside it, 344..438 | Active |
| missing album, 1440 x 900 | "Could not resolve album", 6 px under the pressed Download, same left (340) | None. lb-bot's album route sends no code, so the rule shows none | Download: fill/active |
| missing album, 800 x 600 | 6 px under Download, left 188 | None | fill/active |

The 1440 x 900 shot of the gaps box (`~/standins/shots/repair-r12-b238-gap-refused-1440x900.png`) was read back. It shows the
sentence and the Search again button under card #2's Request.

## Review Focus, item by item

1. **Every way an image goes away.**
   - Watched: the queue cleared with a song playing (above), and an image whose source goes to none on a Next (the no-cover
     path). The after build shows the empty-cover icon, with no loop.
   - Harness only: an image that errors, a request that changes to none and back, a recycled grid cell, the last song
     removed.
2. **Quick track changes.** Watched: five Nexts, the Auto DJ end of queue, and the no-cover Next all gave no error page on the
   after build, and the queue position ended where the presses put it.
   - Whether the covers end on the right song cannot be seen here: every stand-in cover is the same placeholder.
3. **Request on a box in view, and on one half under the bar.** Watched: the first does not move, the second lands once on the
   line, and a wheel during the motion wins. A fill ending while the user is away moves nothing.
4. **A refusal on both boxes.** Watched: the sentence is next to the pressed button in lb-bot's words (from the lb-bot-shaped
   stand-in), and a second press after Search again works.
5. **800 x 600 with the queue open.** Measured at 800 x 600 with the queue as its rail only. At this width the side queue opens
   over the page, and the scripted press could not reach the box under it.

## Not verified

**Watched only on the VM:**

- The owner's GPU and real 60 Hz frames. Every number here is from a locked VM session. Cases B and D were re-run with frames
  forced on.
- A real lb-bot refusal. The stand-in answers in lb-bot's shape, read from `listenbrainz_bot.py`, not from a running lb-bot.

**Reasoned, not watched:**

- **B-229 has the same cause as B-210.** The workstation's own path (Auto DJ end of queue) was reproduced here and fixed here
  (6 of 10 to 0 of 20), and so was the no-cover Next (9 of 9 to 0 of 14). The owner's workstation was not re-run.
- **Review F1** was walked on `f2fc412f` only. That `dfcba464` would have pulled the page back in case C is the review's
  reading; no build of `dfcba464` was walked.
- **Review F3** (refusal keyed by folder) is harness only. Walking it needs a search started elsewhere to replace the cards
  under an open box.
- **Review F4** (`refresh=1` on the missing album's Search again) is harness and code only:
  - Real lb-bot's album route never answers with a stale-list code, so the button does not appear with it.
  - The hub's `LB_ROUTES` entry for `GET /lb/album/sources` does not list `refresh`, so the hub drops it today. A backlog
    line asks the hub to add it.
- **R5's cross-fade** (the last image stays under the next until it has faded in) was not looked at frame by frame. It rests on
  `shown-stack.harness.ts` and an unchanged `showNext`.
- **Review Focus 5 with the queue open** at 800 x 600. The line comes from the shell's CSS variables, which do not depend on
  the queue.

## Left on the VM

- Worktrees and branch: `~/src/feishin-r12` (detached at `tmp-r12`, `f2fc412f`), `~/src/feishin-r12-base` (detached at
  `f8790ef3`, made by this walk), and the branch `tmp-r12` in `~/src/feishin`.
- `~/standins/run/r12/`:
  - the profiles `cfgprod-after` and `cfgprod-base`
  - the scripts `plib.mjs`, `blib.mjs`, `crash.mjs`, `b236gap.mjs`, `b238gap.mjs`, `balbum.mjs`, `launch-prod.sh`, `ss.py`
  - the logs `crash-*.log` and `b236-*.log`
- The R12 hooks in R11's fake (`~/standins/run/r11/fake/r11_gaps.py`, `f7_fake.py`), both off by default.
- Shots: `~/standins/shots/repair-r12-*`.
- Nothing of this walk is still running: 4907, 4909, 9271 and 9272 are closed.
