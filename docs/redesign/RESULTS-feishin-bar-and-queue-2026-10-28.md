# Results: R8, the player bar and the side queue

Plan: `PLAN-feishin-bar-and-queue-2026-10-28.md` (kept outside the repo, in `navi-connect/`). Branch `fix/bar-and-queue-2026-10-28`, cut from
`fe25fe05` (the repair stack's tip). Written 2026-10-28 after the walk on the sandbox VM. Covers BACKLOG B-211 (reverted), B-224 (artist links
in the side queue), B-225 (smaller autoplay characters), B-226 (a resizable lyrics area) and B-227 (the folded queue shows what plays next).
Nothing here is confirmed on the owner's machine yet.

One implementer lane (Tasks 1 to 5), one review of the whole lane (spec met; two Important findings, eight Minor), and one fix agent. The fix agent
fixed I-1, I-2, M-1, M-2, M-4, M-5, M-6 and M-8 (M-3 and M-7 were accepted as they are), then walked the branch on the VM. It fixed one defect the
walk found (W-1) and wrote this note.

| Commit | Subject |
|---|---|
| `f40bc0fc` | revert(player): the seek row as upstream draws it (the owner, B-211) (Task 1) |
| `4ea3297c` | fix(player): artist names in the side queue open the artist again (B-224) (Task 2) |
| `ddd96b2b` | fix(player): the autoplay chips at the panel's small size (B-225) (Task 3) |
| `6f28f484` | feat(lyrics): drag the lyrics area to the height you want (B-226) (Task 4) |
| `a7b295b3` | feat(player): the folded queue shows what plays next (B-227) (Task 5) |
| `ef0c02a4` | fix(player): the remote next song follows the session's play order and repeat (B-227) (review I-2) |
| `207aec61` | fix(player): the rail's next title and artist as two columns, each cut on its own (B-227) (review I-1) |
| `073f1a88` | fix(player): the rail's tooltip names the next song without a dangling comma (B-227) (review M-6) |
| `48001074` | fix(player): the rail says Autoplay, not End of queue, when autoplay will continue (B-227) (review M-5) |
| `33043d15` | fix(player): a failed remote song lookup is not retried for a minute (B-224) (review M-1) |
| `ceb8345a` | fix(lyrics): a click on the lyrics handle without dragging keeps the default height (B-226) (review M-2) |
| `1800e399` | fix(lyrics): the lyrics handle announces the range it can reach (B-226) (review M-4) |
| `216f4bc1` | docs(lyrics): the lyrics area's stylesheet height described as the first-frame fallback (review M-8) |
| `274825ad` | fix(lyrics): a drag right after the double-click reset follows the pointer again (B-226) (walk W-1) |

## Gates

| Check | Result |
|---|---|
| `tsc -p tsconfig.web.json` / `-p tsconfig.node.json` (TS6307 filtered) | 0 lines / 0 lines, before every commit |
| eslint, stylelint `--max-warnings=0` on every changed file | clean, before every commit |
| Every harness, `node --test $(git ls-files '*.harness.ts')` | 1027 pass, 0 fail, 82 files (at `274825ad`) |
| The lane's harnesses | `lyrics-height` (8 cases; it failed first because the module did not exist; one case was added for M-4). `remote-next` (6 cases): it failed first because the module did not exist, then failed 3 of 6 against the old `index + 1` rule (shuffle, repeat-all, repeat-one), then passed |
| Harness count | 1015 at `fe25fe05`; -2 (seek-row removed) +7 (lyrics-height) = 1020 at `a7b295b3`; +6 (remote-next) +1 (lyrics-height range) = 1027 |
| `pnpm build:web`, `pnpm build:remote` | both exit 0 (at `274825ad`) |
| `commitlint --from fe25fe05` | exit 0 |
| No em dash added, no attribution in commits | checked over `fe25fe05..HEAD` |

## Walked on the VM

All of this was watched on the VM: production build (`pnpm build` in a worktree `~/src/feishin-r8`), its own profile and CDP port (9244) and a
fresh hub device id. It ran against the stand-in Navidrome and the scratch hub. Sizes were CDP emulations at dpr 1 (`hold-size.mjs`). The GNOME
session was locked, so only positions, counts and requests were measured, no frame times. Screenshots are in the ledger folder's `shots/`
(copied from `~/standins/shots/repair-r8/` on the VM) and were read back.

### The seek row (Task 1, Review Focus 1)

| Width | Seek container | Track | Transport |
|---|---|---|---|
| 1440 x 900 | x 521 to 920 (399 px) | x 605 to 836 (231 px) | six 36 px buttons, x 614 to 870 |
| 1100 x 800 | x 408 to 693 (285 px) | x 492 to 609 (117 px) | six 36 px buttons, x 444 to 700 |

At both widths the row is upstream's: the slider sits under the transport with time columns on both sides (`50-bar-1440`, `51-bar-1100`).

### Artist links in the side queue (B-224, Review Focus 2)

- **Local row** (docked queue, 1440 x 900): a click on "The Long Players" opens `#/library/album-artists/0Do9On6uRclVOmBrh7Gtzj`, and the
  playing song stays the same. A **double-click** on the link also only navigates: the playing song stays "Hits Both 1 1" (13/31), so the row was
  not played. A click on the blank part of the artist line selects the row and plays nothing.
- **The playing row's** artist link opens the same artist.
- **Remote rows** (the session played by a second scratch client, "R8 scratch Navic", which publishes 40 songs with artist names and no ids,
  as Navic does):
  - "Echo Engines 1" by Wywyaegar opens `5jh9QNI0Y1ZACStkLttwxm`, Wywyaegar's own id.
  - The scratch session received no `jump` from any of these clicks.
- **Two-artist row:** the stand-in library has no song with two artists (11,821 songs checked), so a local two-artist row could not be walked.
  The remote queue therefore carries one constructed row with two artist ids ("Torri Zenbelel, Ocean Sisters"). It draws two links, and each
  opens its own artist (`5y3N…` and `2dn2…`).
- **Requests** (the app asks Navidrome's native `/api/song/<id>`; there are no `getSong` calls), counted from the network log over CDP from a
  fresh renderer:
  - 8 when the panel first shows the remote queue.
  - 39 after scrolling the 40-song queue to the bottom, back up and down again. That is every row without ids exactly once; the row that
    carries ids asked nothing. The second pass added 0.

### The autoplay characters (B-225, Review Focus 5)

In the overlay queue at 1100 x 800 (panel 360 px, control 332 px):

- The three characters measure **28 px** tall.
- Each label is **22 px** tall at **12.5 px**, 109 px wide, with no overflow, on one line.
- The Up next / Related tabs stay at 34 px.

See `61-overlay-queue-1100-chips`.

### The lyrics area (B-226, Review Focus 3)

Rows are counted at scroll 0. The grouped queue shows a 32 px caption ("Earlier") above the rows. Header heights are measured.

| Window | Panel | Header | Lyrics | Area | Song rows fully visible |
|---|---|---|---|---|---|
| 1440 x 900 | 720 | 196 | closed | n/a | 9, plus the caption and 0.4 of a row |
| 1440 x 900 | 720 | 196 | default | 155 px | 6, plus the caption |
| 1440 x 900 | 720 | 196 | dragged to max | 299 px (ARIA max 299) | 3, plus the caption |
| 1280 x 600 | 420 | 80 | closed | n/a | 5, plus the caption |
| 1280 x 600 | 420 | 80 | default | 120 px (the floor) | 3, plus the caption |
| 1280 x 600 | 420 | 80 | after a max drag at 1440, then shrunk | 153 px (clamped; ARIA max 153) | 2 rows plus the caption at scroll 0; the space left is 146 px, 3.04 rows without the caption |

- **Header heights** (M-3): 134 to 196 px in the local states. The fullest header, with the "Playing from" block, the status line, the
  characters, the tabs and the count line, measured **230 px** (the remote session). `clampLyricsHeight` uses 236. At 1280 x 600 the short header
  is 80 against the constant's 82. As the M-3 ruling accepts, a caption costs about two thirds of a row. So at 1280 x 600 the maximum leaves two
  song rows plus the caption, not three songs.
- **Persistence:** the dragged height (198 px) survived a restart of the app: the setting read 198 and the area was 198 px.
- **Double-click** sets the setting back to null. A plain click on the handle without moving now keeps null (M-2, watched).
- **ARIA range:** the separator says 120 to 299 at 1440 x 900 and 120 to 153 at 1280 x 600 (M-4).
- **W-1, found and fixed in the walk:**
  - After the double-click reset, the next drag stopped after its first move (155 to 198 px; reproduced twice).
  - The event log showed `pointercancel` right after the first `pointermove`. The double-click had left a text selection (`"\n"`) in the strip,
    and the press began a native drag of it.
  - Fixed in `274825ad`: the handle does not select, and a press clears any selection before it captures the pointer.
  - Re-walked on the rebuilt app: after the double-click the selection is empty, and the drag reaches 299.

### The rail (B-227, Review Focus 4)

Each claim is checked by pressing Next, or by the hub's `next` for the remote session, and reading what became current.

**Local queue** (rail at 1440 with the queue collapsed, and at 1100 folded):

| Case | The rail said | Then playing |
|---|---|---|
| Queue order | Score 3 1 | Score 3 1 |
| Shuffle, three steps | Live Tagged 1 1, Hits Both 1 1, Live Plain 5 1 | the same three |
| Last song, repeat off | "End of queue", no cover | n/a |
| Last song, repeat-one | Hits Type 1 1 (itself) | Next stays on 21/21 |
| Last song, repeat-all | Live Plain 5 1 (song 1) | 1/21 Live Plain 5 1 |
| Last song, Autoplay switched on (M-5) | label recorded by a MutationObserver: "End of queue", then "Autoplay" for 117 ms, then "Up next: Disc 1 Song 1" once Auto DJ had appended 5 songs | n/a |

**Remote session** (rail at 1100, the session played by the scratch client):

| Case | The rail said | The session went to |
|---|---|---|
| Queue order | Logar Loel 2 | index 2, Logar Loel 2 |
| Shuffle on, order 2, 18, 21, 1, 3…; three steps | Lobelwy 2, Velvet Signals 1, Paper Garden 1 | 18, 21, 1: the same three. The old `index + 1` would have said Denquinönste 1 at the first step |
| Last in play order (queue index 24 of 40), repeat off | "End of queue" | n/a |
| The same, repeat-all | Logar Loel 2 (order[0] = 2) | index 2 |
| The same, repeat-one | Rator Belste 1 (itself) | n/a |
| Shuffle off, 40/40, repeat off | "End of queue" | n/a |
| Shuffle off, 40/40, repeat-all | Echo Engines 1 | index 0 |

**Layout (I-1):**

- Title and artist are two 16 px columns (x 1412 and x 1392 at 1440), title bold on the right. Each column carries its own ellipsis.
- With a 77-character title at 1100 x 560, both columns stop at 214 px: the title's full length is 433 px, the artist's 289 px. Both end in "…".
  See `94-rail-long-title-short-window`.
- The tooltip and aria-label read "Up next: title, artist".

**Covers:** a song Auto DJ appended ("Studio 10 1") showed the placeholder in the rail. The queue's own row for that song has no cover either,
so that song has no image at all; this is not a rail defect.

### Seen once and not reproduced

- At 1100 x 800, after five Next clicks 400 ms apart on the local queue, the whole app fell to its error page with **React error #301**: a state
  update during render looped.
- Three attempts to reproduce failed: the same clicks, with and without the overlay queue scrolled to its end first.
- No render-time state update was added in this lane: every setter in `fe25fe05..HEAD` is in an effect or a handler.
- Render-time setters elsewhere that could loop: `window-wash.tsx:96` (`setTones`) and `mood-section.tsx:29-30`. Both are unconfirmed.
- The production build gave no component stack. Recorded in BACKLOG as a new bug.

## Reasoned from code, not watched

- The full-screen player's Up next reads the same `useRemoteAwareNextSong`. Only the rail was watched, so its remote shuffle and repeat answers
  are by construction.
- M-1's negative cache: a lookup that fails or returns nothing is not asked again for 60 s. The stand-in never failed a lookup, so no failure was
  watched.
- The rail's "Autoplay" label for a remote session uses the same playing-from state; only the local case was watched.
- A two-artist row from real data: there was none on the stand-in.

## Not verified

- The owner's machine: GPU, display scale (the owner's screenshot is at about 1.15), real window sizes (only CDP emulation here) and the real
  library. Real libraries have two-artist songs and longer titles.
- A real Navic publishing the queue. The scratch client sends the same shape: names without ids.
- Frame times: the VM session was locked.
- The React #301 crash above has no known cause.
