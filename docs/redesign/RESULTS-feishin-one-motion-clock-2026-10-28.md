# Results: R5, one motion clock per gesture

Plan: `PLAN-feishin-one-motion-clock-2026-10-28.md` (kept outside the repo, in `navi-connect/`). Branch `fix/one-motion-clock-2026-10-28`, cut from
R4's tip `9d153337` (after the controller's rebase the code commits are `340b9913`, `a9da3ef0`, `c69f8748`, `c1092707`, `103b3d91`). Written
2026-10-28 after the walk on the VM. Closes the motion half of audit A-06 and BACKLOG B-206 (fixed-unverified until the owner's GPU judges it).

One implementer lane (Tasks 1 to 4, one commit each), one whole-lane review (spec OK, Review Focus 1 to 4 held, one Important and two Minor
findings), one fix commit (`103b3d91`: I-1 the bar's cover fade, M-1 the `--motion-ease` guard, M-2 the `tableBody` rename), then this walk.

## Gates

| Check | Result |
|---|---|
| `tsc -p tsconfig.web.json` / `-p tsconfig.node.json` (TS6307 filtered) | clean / clean |
| eslint, stylelint `--max-warnings=0` on every changed file | clean |
| Every harness, `node --test $(git ls-files 'src/**/*.harness.ts')` | 998 pass, 0 fail (R4's tip had 988 plus the lane's guard cases and R4's later cases) |
| `one-clock.harness.ts` | 6 cases; each guard was watched failing on the base before its change (the bar guard again for I-1) |
| `pnpm build:web`, `pnpm build:remote` | both exit 0 |
| `pnpm build` (production Electron build on the VM, both before and after) | exit 0 |
| `commitlint --from 2302d69a --to HEAD` (R4's base to the tip; `--from 13c57c84` after the rebase reports the same) | 0 errors, 1 warning: `footer-leading-blank` on R4's `fix(ui): a forward push opens a page at its top (B-208)` (a line of its body reads as a footer). Not this lane's commit; left alone. The lane's own six commits are clean |

## Rulings (from the lane ledger)

- Read the CSS variables through `readMotionClock()` (parsed once, cached, fallback equal to the `global.css` values, parser covered by the harness)
  rather than move the crossfade to CSS. The crossfade needs AnimatePresence exit handling and the generation-keyed nodes (the blank-sidebar fix); a
  CSS version would need its own exit mechanism, more code and a regression risk on that fix, while reduced motion stays handled by the existing
  `useReducedMotion` branch. Cost if wrong: if the variables were ever changed at runtime the crossfade would keep the first-read value until reload
  (they are static today).
- The carousel's curve is the arrival's (`--arrive-ease`, `cubic-bezier(0.2, 0.7, 0.2, 1)`), not `--fold-ease`: the plan says "whichever
  arrival.module.css uses for the rise", and a page slide is a rise; the same curve both ways (no easeIn on exit). Cost if wrong: a page flip feels
  slightly less front-loaded; one token change (`KIT_EASE`).
- Reduced motion makes the carousel page change instant (duration 0 via `useReducedMotion` in the variants' custom). `MotionConfig
  reducedMotion="user"` only drops transforms and would have left a 240 ms opacity fade, contradicting Review Focus 5. Cost if wrong: none visible;
  one extra prop in the custom object.
- The player cover's AnimatePresence slide (-50 px, 200 ms easeOut, toggled by `hideImage`) snaps instead of being retimed: the plan says children
  keep their fade only if it is the kit's timing. Cost if wrong: the cover appears and disappears without a slide when the sidebar image is toggled;
  restoring is a few lines.
- The implementer's open choices stand (`readMotionClock` read once with a fallback equal to the CSS; arrival curve for the carousel;
  `enableEntranceAnimation` removed, no other caller). The review verified each. Cost if wrong: small.

## Deferred minors

None. M-1 and M-2 were fixed in `103b3d91`. The pre-existing em dash in a comment of `left-controls.tsx` (not this lane's) is left alone.

## Review Focus, answered

| # | Focus | Answer |
|---|---|---|
| 1 | Sidebar toggled twice quickly: crossfade and grid tween in step, no label half-faded | Two toggles 60, 120, 200 and 290 ms apart, looked at 2.5 s later: one live layer, 47 labels, minimum label opacity 1, width 232, in both builds. Clocks: see "Watched running". Not verified: a label sampled mid-flight between the two toggles (only the settled state was read) |
| 2 | Carousel, five clicks in a second: never two pages, direction follows | Clicks next, next, prev, next, prev, 200 ms apart, all executed, 307 samples every 8 ms: at most one page in the DOM, exits slid to -8 px, entries came in from +8 px for next and -8 px for prev (before: the same shape at +-100 px); final page one layer, opacity 1, offset 0 |
| 3 | Track change while the favourite or rating appears: no flicker or overlap | Three track changes and three favourite toggles, rect of cover, title block, favourite and title line sampled every 6 ms: no overlap (0 px of intersection between any pair), the cover never moved (0 px), the title block moved 15.4 px once, to its new width, and stayed (identical before and after). No animation in the bar subtree |
| 4 | Empty list, refetching list | Refetch seen: Tracks "Recently added" to "Top rated" (11,790 to 400 songs) sampled every 200 ms for 2.4 s on the dev build: 90 rows throughout, table opacity 1 throughout, no flash. Not seen: an empty item list (the stand-in library gave none to filter to; the Library page's no-match state was seen, but it is not an item list) |
| 5 | Reduced motion: carousel, crossfade, page instant | Emulated through CDP with the page reloaded afterwards (see the table below). All instant after, none before except the crossfade |

## Watched running

Where: the sandbox VM, the production Electron build of the clone (`pnpm build`, launched on the scratch profile, stand-in Navidrome, scratch hub,
fake lb-bot), viewport 1440 x 900 by CDP emulation, driven over CDP with `r5-walk.mjs` (kept on the VM in `~/standins/run/`, results as JSON lines in
`~/standins/run/r5-out/`). Navigation by clicking links and chips (never by assigning `location.hash`). Before is R4's tip `9d153337`, after is
`103b3d91`; same build kind, same VM boot, same profile, same stand-ins. **All numbers are VM numbers** (nested VM, VirGL on a UHD 630): they show
direction and size, not the owner's speed.

**Frame numbers.** The GNOME session was locked (`LockedHint=yes`), which throttles the app to about 2 fps. Both production builds were therefore
launched with `--disable-gpu-vsync --disable-frame-rate-limit` (a copy of the launch script in `~/standins/run/`), which restored frames. The frame rate
is uncapped, so "dropped" counts intervals over 16.7 ms and is not comparable with earlier lanes' figures; TaskDuration, RecalcStyle and Layout are
frame-free. Frames still move to the workstation walk. The dev-build profile (below) is frame-free and ran without the flags.

### The clock of the collapse

The production CSS carries `--motion-duration: .3s` and `--motion-ease: cubic-bezier(.3, .7, .2, 1)` (minified forms); `parseCssTime('.3s')`
gives 300 and `parseCssBezier('cubic-bezier(.3, .7, .2, 1)')` gives `[0.3, 0.7, 0.2, 1]` (run under node against the real module). On the dev build the
real `readMotionClock()` returned `{ ms: 300, ease: [0.3, 0.7, 0.2, 1] }`. The production build exposes no handle, so the function was not
logged there; what was watched is its effect.

Sidebar toggles (6 collapse and 6 expand per build, sampled every 3 ms): time from the click until the grid width has settled, and until the
entering layer reached opacity 0.999.

| Toggle | Width settled | Entering layer full | Fade minus width, median (range) |
|---|---|---|---|
| Collapse, before | 314 ms (292 to 332) | 262 to 297 ms | -31 ms (-60 to -29): the fade ended early, on its own 250 ms clock |
| Collapse, after | 318 ms (291 to 360) | 291 to 360 ms | 0 ms (0 to +29): the two end together |
| Expand, before | 291 to 359 ms | 567 to 580 ms | +258 ms (215 to 280) |
| Expand, after | 320 to 341 ms | 643 to 671 ms | +334 ms (316 to 348) |

Collapse is the clean case and shows one clock. Expand is dominated by something else in both builds: the full sidebar mounts late, so the layer
that fades in is not in the DOM until about 540 ms after the click (sampled every 5 ms: one layer fading out, a 300 ms stretch with no samples from
the main thread, then the new layer rising 0.17 to 0.99 over about 195 ms). After is about 75 ms later than before there, which fits the 50 ms longer
duration plus the VM's noise; this is not a clock difference and is not claimed as one. See "Found".

### Pushes, sidebar toggles and the carousel (production, VM, medians; 10 rounds, 4 toggles each way, 10 flips)

| Scenario | Dropped (before / after) | Worst frame ms | TaskDuration ms | RecalcStyle ms | Layout ms | Time to content ms |
|---|---|---|---|---|---|---|
| Home to Library | 6 / 6 | 87.7 / 89.9 | 525 / 532.5 | 86.5 / 85 | 19.5 / 19 | 129 / 128.5 |
| Library to Albums (list) | 11.5 / 11 | 155.9 / 155.2 | 625.5 / 563.5 | 156 / 112 | 30 / 28 | 317.5 / 309 |
| Albums to album | 10 / 10.5 | 137.5 / 129.7 | 546 / 545 | 102 / 101.5 | 24 / 24.5 | 163 / 162 |
| Album to Home | 11.5 / 11.5 | 112.8 / 108.3 | 535 / 533.5 | 99.5 / 100 | 21 / 19.5 | 111 / 112 |
| Sidebar collapse | 7 / 7 | 52.2 / 54.8 | 586.5 / 591.5 | 148 / 154.5 | 45.5 / 47.5 | |
| Sidebar expand | 4 / 5 | 35.4 / 44.6 | 552 / 618.5 | 139 / 149.5 | 44 / 45.5 | |
| Carousel page flip (10) | 0 / 0 | 18.1 / 18.1 | 665.5 / 591 | 61 / 31 | 3 / 3 | settled 625.5 / 496 |

Reading it: the list push drops 44 ms of RecalcStyle and 62 ms of TaskDuration (the list's own second fade is gone); the carousel flip is 130 ms
shorter (496 ms with the 240 ms out and 240 ms in, from 625) and does half the style work; pushes elsewhere and the collapse are unchanged. Sidebar expand
is 66 ms higher in TaskDuration after, with four samples each: within the noise of this VM, and the longer fade (300 ms where 250 ms was) is the
expected direction. Nothing here is claimed as an improvement beyond the list push and the carousel.

### The list fade

Effective opacity of the grid container and the table container (own opacity times its ancestors') sampled every 4 ms after the click, 3 rounds:

| List | Before, full opacity at | After |
|---|---|---|
| Albums grid | 391, 420, 453 ms | 134, 148, 144 ms (the page's own fade) |
| Tracks table | 205, 160, 162 ms | 100, 100, 62 ms |

`getAnimations()` during a list-page push shows the page's animation (`page-push` on `main`, or `page-tab-rise` and `page-tab-fade`), the arrival
rise on rows and the image fades. Before, the list's motion fade was a JS animation that appears as an anonymous entry and cannot be told apart by
name; the opacity samples above are what separate the two builds. No CSS or transition animation named for a list exists after.

### Reduced motion (CDP `prefers-reduced-motion: reduce`, page reloaded after emulating, as motion reads it at mount)

| What | Before | After |
|---|---|---|
| Carousel flip, time to a settled single page (3 flips) | 604, 607, 608 ms | 17, 21, 24 ms |
| Sidebar crossfade (two layers present, or dimmed, at any sample) | none (already instant) | none |
| Albums grid fade to full opacity | 430, 457, 425 ms | 0 ms (opacity 1 from the first sample) |
| Tracks table fade to full opacity | 199, 174, 160 ms | 0 ms |
| Page push animations (`getAnimations()`) | only the OverlayScrollbars one | only the OverlayScrollbars one |
| Bar's cover on sidebar collapse | CSS `fadein` 200 ms ran (opacity 0 to full at 185 ms) | no animation, opacity 1 and offset 0 at the first sample |

An earlier pass emulated reduced motion without reloading and showed the carousel at about 500 ms and the crossfade still running in both builds:
motion's `useReducedMotion` reads the preference when the component mounts, so a live OS change reaches a mounted carousel or sidebar only after it
remounts. That is upstream behaviour and not changed here; the reload version above is the real check.

### The bar's cover (I-1)

Sidebar image shown in the sidebar (the cover's toggle clicked), then the sidebar collapsed, so the bar's cover mounts. Sampled every 4 ms:

| | Before | After |
|---|---|---|
| Cover's CSS animation | `fadein`, 200 ms; opacity 0 at the first sample, full at 277 ms; slide from -47 px | none; opacity 1 and offset 0 at the first sample |
| Same with reduced motion emulated | the fade still ran (185 ms) | none |

### Layout reads (dev build, CPU profiler plus a counter on `getBoundingClientRect`)

`Element.prototype.getBoundingClientRect` was wrapped to count calls (those with motion, framer or projection in the stack counted separately), and
the CPU profile was taken around each action. Dev build, frame-free, same boot.

| Action | Calls before (all / from motion) | Calls after |
|---|---|---|
| Album to artist push (10 rounds) | 2 / 1 each | 2 / 1 each (the profiler's `getBoundingClientRect` self time 5.5 to 7.7 ms before, 5.5 to 6.6 ms after: that one call is not the bar's) |
| Favourite toggled five times (3 rounds) | 55 / 55 each | 7 / 7, then 0, then 0 |
| Track changed twice (3 rounds, reloaded between) | 22 / 22 each | 0 each |

The bar's per-render layout reads from motion's projection are gone. (The 7 in the first "after" round is the page's first render of the heart.)

## Found, not fixed (for the register)

- **A stale exiting sidebar layer.** In the production build of R4's tip and of this branch, collapsing the sidebar leaves the exiting full sidebar
  mounted at opacity 0 (pointer events off) for at least 6 s, until the next toggle; expanding does not. Rapid toggling piles layers up (17 layers,
  466 labels counted in one run). Harmless to look at, wasteful in DOM. Cause not found; suspect the exit of a lazy, nested-motion subtree not
  completing. Present before this lane.
- **`BaseImage` "Too many re-renders" in the dev build.** Changing track five or more times in a row from the bar's next button crashed the app to
  the error boundary (R4's tip: 3 of 3 runs, at the third or fourth change; this branch: 1 of 2 runs, at the fifth). The stack is a render-phase
  `setShown` in `src/shared/components/image/image.tsx` (from `70406953`, 2026-10-21). Not seen in the production build (not tried past two changes
  there). Present before this lane; the walk reloaded the page between track-change rounds to stay clear of it.
- **Expand's late mount** (see the clock section): the entering full sidebar appears about 540 ms after the click on the VM, in both builds, so on
  expand the fade does not overlap the width tween.
- **Frames while locked.** The session lock throttles Electron to 2 fps; `--disable-gpu-vsync --disable-frame-rate-limit` restores frames on this
  VM but uncaps them. Worth recording in `README-repair.md`.

## Not verified

- On the owner's GPU or any real display: all numbers are VM numbers, and frame counts are uncapped-rate counts.
- `readMotionClock()` was not logged in the production build (no handle there); its inputs and effect were.
- A label sampled mid-flight between two quick toggles (Review Focus 1): only the settled state.
- An empty item list (Review Focus 4).
- The bar's favourite and track-change checks used the stand-in library, played locally with no audio device; nothing was cast.
- `pnpm build:web` and `build:remote` were only built, not opened.
- The Navic or hub sides: not touched.
