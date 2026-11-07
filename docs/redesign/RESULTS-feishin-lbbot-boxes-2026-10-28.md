# Results: R11, lb-bot's two boxes as Navic has them

Plan: `PLAN-feishin-lbbot-boxes-like-navic-2026-10-28.md` (outside the repo, in the umbrella's `navi-connect/`). Branch
`fix/lbbot-boxes-like-navic-2026-10-28`, local only, never pushed to GitHub. Written 2026-10-28 by the lane's fix agent,
after the review's fixes and the walk on the sandbox VM. The owner's ask: the missing album's sources and download in one
box, with Download under the chosen source (B-222), and a gaps box on the owned album page (B-223).

**Base.** Rebased by the controller onto R10's final tip `f5ce414b` (R8 + R9 + R10). Sixteen commits on top: three by the
implementer, thirteen by the fix agent (twelve for the review, one for a finding of this walk).

| Commit | What |
|---|---|
| `021daeb8` | One source-cards component: radio cards, the chosen card's listing and action under it (B-222) |
| `80d489a7` | The missing album's sources and download in one box (B-222) |
| `18223875` | The album page's gaps box, after Navic's `GapBox` / `GapStage`; the gap modal retired (B-223) |
| `cfba4e8c` | Review I1, I2: no blind "Pick the best source" on the missing album; Search again only after a failed or empty search |
| `d44cded2` | Review I3: the gaps box stays for the visit once shown (`gapBoxGroup`) |
| `05ab404c` | Review 4: a gap's safe source by Navic's three terms (lb-bot's gap sources carry no coverage) |
| `34030743` | Review 7: a sources view restored with nothing asked shows the tracks |
| `0ca50481` | Review 12: attention without lb-bot's sentence says why in the old modal's words, per cause |
| `0f490d63` | Review 6: `gapPolls` (poll only while something moves); failed reads give up after 120 s |
| `f789b422` | Review 8: the stage union's comments |
| `5a925c41` | Review 5: the landing re-reads survive later polls |
| `2f46bb1a` | Review 10: the context menu's ask is taken once per history entry and never takes the box off the sources |
| `ac429c0c` | Review 11: gap listings kept by folder, not by index |
| `0469af0a` | Review 9: the boxes' words in en.json, `common.cancelled` shared again |
| `b3e72922` | Review 13: comments naming the deleted modal |
| `c3e7fd67` | Walk finding: the result row holds from the landing the box saw, not from the ledger settle |

## Gates

Run on the workstation at `c3e7fd67` (the tip).

| Gate | Command | Result |
|---|---|---|
| tsc, renderer and main | both configs, `--composite false`, TS6307 filtered | exit 0, no output |
| eslint, stylelint | `--max-warnings=0` on every changed file | exit 0 (no CSS changed by the fix agent) |
| harnesses | `node --test $(git ls-files 'src/**/*.harness.ts')` | 1102 pass, 0 fail (1101 before the walk's fix) |
| builds | `pnpm build:web`, `pnpm build:remote` | exit 0, exit 0 |
| commitlint | `./node_modules/.bin/commitlint --from f5ce414b` | exit 0 |

## The walk (sandbox VM, production build)

**Setup.** A worktree `~/src/feishin-r11` of the VM's `~/src/feishin` (branch `tmp-r11`, `pnpm build`), a copy of the
production scratch profile with a fresh hub device id, CDP 9261. The shared stand-ins were left alone: the walk ran its
own **fake lb-bot on 4907** (a copy of `fake_lbbot.py` / `f7_fake.py` in `~/standins/run/r11/fake/` with the gap fixtures
below) behind its own **scratch hub on 4909** (health 4908, `LBBOT_URL` 4907, state `~/standins/run/r11/hub.json`), and the
shared stand-in Navidrome (4533), read only. The GNOME session was locked, so frames were not measured; every timing below
is a CDP poll of the DOM every 200 to 250 ms (a stage change can read up to 0.25 s late). All numbers are VM numbers.
Everything started for the walk was stopped at the end; the shared 4897 / 4899 / 9222 stayed up.

**What was added to the stand-in** (all in the copy, `~/standins/run/r11/fake/`; the shared `~/standins/tools` is unchanged):

- `r11_gaps.py`, new: two review groups from f7_data's index rows, `g-hollow-undertow` (Hollow Orchard / Undertow, 9 of 12
  held) and `g-lp-0` (The Long Players / Studio 1, 1 of 10, two discs of five); lb-bot's paths `GET /api/gaps/{gid}`,
  `POST /api/groups/{gid}/sources` (a search task, timer only), `GET /api/groups/{gid}/sources/{idx}/files`,
  `POST /api/gaps/{gid}/fetch|auto|cancel|rescan`, the gap summaries in `/api/fills`, `POST /lb/fill` gap frames to the
  scratch hub on every transition, the index row flipped to `complete` (and pushed) when a fill is placed; modes on
  `GET /__r11` (`gsdelay`, `gsources` ok/empty/fail, `gsafe`, `gfill` ok/fail/stalled/awaiting, `gdetail`, `greads`
  ok/503, `gstep`, `reset`, `reads` with timestamps). Gap sources carry no `coverageFull`, as lb-bot's `_source_view`.
- `f7_fake.py` (copy): three marked `R11` hooks (GET and POST dispatch, `/api/fills` gaps) and the music path made absolute.
- `fake_lbbot.py` (copy): gap reads still counted while the stand-in answers 503 to everything.
- Nothing reaches slskd or any real service: a "search" and a "transfer" are timers in the stand-in. No file was written
  to the stand-in library (`gland` stayed 0), so the tracklist keeps its 9 songs after a fill.

### The gaps box (Hollow Orchard / Undertow unless said)

| Stage | Watched | Shot |
|---|---|---|
| folded | "3 tracks missing / Click to see which", Fill gaps beside it, the chevron | `01-folded` |
| tracks | the 3 missing rows with Missing pills, "Measured against ... Undertow (12 tracks). Wrong edition?", Re-check, Open in lb-bot | `02-tracks` |
| searching | the press shows "Find sources / For the 3 missing tracks only" and lb-bot's `current` line at once | `03-searching` |
| choosing, safe | 12 s search; card #1 (recommended, verified, album match) preselected, "Request 3 tracks" 8 px under it; Search again and Pick the best source for me under the cards | `04-choosing-safe` |
| choosing, a pick | card #2 tapped: its listing fetched once (1 `source-files` request), Request moves under it | `05-choosing-picked2` |
| active | Request: active at 0.9 s, "Getting 3 tracks / FLAC · from ...", bar, the five steps, "1 of 3", Cancel request | `06-active` |
| done (I3) | lb-bot's record went complete and the index row flipped to `complete` at 13.1 s; the box stayed mounted and showed "In your library / 3 tracks added / 12 of 12" at 14.0 s, held 7.3 s, then folded away (wrapper 0 px). The ledger row settled `done` at 94 s and nothing came back | `07-done`, `08-after-done` |
| choosing, none safe (Focus 2) | `gsafe=0`: no card checked, no Request button anywhere, "Choose a source: none is safe to pick for you..." | `10-nosafe` |
| noSources | `gsources=empty`: lb-bot's sentence, Allow MP3 for this request (from `mp3WouldHelp`), Search again; Allow MP3 posted `allow-mp3` once and searched once, then the cards | `11-nosources`, `12-after-mp3` |
| failed (Focus 3) | `gfill=fail`: "Couldn't get these tracks", lb-bot's sentence ("Peer 'velvetcrate' went offline after 1 of 3 tracks."), Search again and Dismiss (no MP3: the record said it would not help); Dismiss folded the box. Shown 96 s after Request, see the findings | `13-failed` |
| attention, stalled | "Downloaded, but needs sorting out in lb-bot", lb-bot's `failDetail`, Open in lb-bot and Re-check only | `14-stalled` |
| attention, no sentence (review 12) | `gdetail=0`: the fallback sentence for a stalled placement | `15-stalled-nodetail` |
| attention, awaiting match | `gfill=awaiting`: "lb-bot needs a decision in its own match workspace for this album." | `16-awaiting` |
| cancelled | Cancel request in active: the rows read Downloaded / Cancelled / Cancelled (`common.cancelled`) | `17-cancelled` |
| auto | Pick the best source for me: `POST /gaps/.../auto`, active at once, done after 11.5 s | (none) |
| unreachable (review 6) | `greads=503` with the box opened: loading, then "Can't reach lb-bot to read the missing tracks. / Try again" at 113 s (patience counted from the first failed read, on page open); Try again with reads back: tracks | `22-unreachable` |
| can't-reach line | a fill started elsewhere, then reads failing while the hub still calls lb-bot up: the line under the active stage at 124.7 s; its Try again cleared it | `23-cant-reach` |

**Review Focus.**

1. *A fill started on another client:* with this device's ledger empty and the box folded and idle, a search and a fetch
   posted straight to the stand-in turned the box `active` 0.26 s after the fetch (the hub's `fill` frame), then done 4.9 s
   later, then gone 6.1 s after that. Shot `20-other-client-active`.
2. *No safe preselection:* as `10-nosafe` above; the album box the same way (below).
3. *A failed fill and one that needs lb-bot:* failed, stalled (with and without lb-bot's sentence) and awaiting match, each
   with its ways chosen from the record's fields (`data-gap-way`: `search,dismiss`; `lbbot,recheck`).
4. *Multi-disc:* Studio 1 unfolds to "1-2 ... 1-5, 2-1 ... 2-5". Shot `21-multidisc`.
5. *Leaving mid-search and coming back:* a 40 s search pressed, the artist link clicked, the window's Back clicked: the box
   came back on "searching", then the cards 25 s later; **one** search was posted.

**The context-menu entry.** On the artist page, right-click Undertow: "Find 3 missing tracks". It opened the album with the
box on the tracks, in view (top 431 px of 900). Folded by hand, away to the artist page, the window's Back: the box stayed
folded. With the box on the sources, the entry again: the box stayed on the sources. Shot `24-menu-opened`.

**Polling** (`GET /api/gaps/g-hollow-undertow` as the stand-in received it, so it counts every client of that group; only
this app was on it):

| Stage | Reads |
|---|---|
| folded, idle | 0 in 60 s |
| tracks open, idle | 0 in 30 s |
| searching (12 s search) | 5 to 6 (page reads plus one per `fill` frame) |
| on the cards after the search | 5, 1, 0 per minute: the search's ledger row stays running for its 90 s settle grace, then settles `needsPick` and the box stops |
| active (13 s transfer) | 5 (one per frame plus the 5 s poll) |
| after the result, until the ledger settles | 3 at 5 s steps, then 3 more over the next minute, then 0 |
| reads failing, open box with no record | 7, 4, 0 per minute (gave up at 113 s) |
| reads failing, a transfer shown | 8, 4, 1, 0 per minute (gave up at 124.7 s) |
| lb-bot down entirely while searching | 8 in the first minute, then the hub's probe called lb-bot unavailable at 54.5 s and the box unmounted (fail-soft); it came back on the search when lb-bot did |

**The landing re-reads (review 5).** After the fill the album was read from Navidrome at 13.1 s (the library refresh on
`complete`), then at 18.1, 33.1 and 58.2 s: the 5 / 20 / 45 s re-reads all fired although the gap was read again at 18,
23 and 28 s in between. (The stand-in wrote no files, so all three ran: the tracklist kept 9 songs against lb-bot's 12.)

### The missing album's box (Hollow Orchard / Low Country, lb-bot only)

From the artist page's Albums chip, the Missing tile. Find sources: the stated wait (`30-album-waiting`), then four cards
with #1 preselected (recommended, verified, album match, full coverage) and its listing, "Download from here" 8 px under
it with the fallback line beside it; under the cards only the Preferred quality select: **no Search again, no Pick the best
source for me** (review I1, I2). Shot `31-album-cards`. Card #2 tapped, Download from here under it (`32-album-picked2`):
the stand-in received `sourceUsername: harbourlight`, `sourceFolder: Music\Low Country (2013) [FLAC]`,
`release_mbid: 8fa353f2-...` and the `rgid`, `artist`, `title`, `total_tracks`. The same box then showed the steps
(Source chosen, Queued done; Downloading "0 of 8"; `33-album-steps`); Cancel request posted `album/cancel` with that
`release_mbid` and the box read Cancelled (`34-album-cancelled`).

### Beside Navic

The VM's AVD was not up and was not started, so this is against Navic's code, not a screen. Navic's `GapBox` and the
Feishin box have the same stages and the same pieces in the same places: the line with Fill gaps beside the title and a
chevron; the missing rows with pills and the "Measured against" note with Wrong edition?; the sources with Request under
the chosen card and Search again / Pick the best source as quiet buttons under the cards; the active stage's steps, bar
and Cancel request; the result row; the recovery card with one row per way on. Navic's `RequestBox` keeps the quality
preference as one quiet line under the cards, as Feishin now does; the one deliberate difference is Download under the
chosen card on the missing album (Navic has it under the cards), which is the owner's ask.

## Findings of the walk

- **Fixed (`c3e7fd67`):** the result row depended on this device's ledger settling `done`, and the ledger settles a gap
  only after a 90 s grace from the row's start. Before the fix: active until 14.08 s, the box folded away, then at 94.14 s
  the "3 tracks added" row came back for 6.3 s on a box that had gone. After: the row from 14.0 s to 21.3 s, nothing at the
  settle. The hold now starts when the box saw the fill land (`landedAt`, harness case); a fill started elsewhere shows
  its result the same way.
- **Not fixed, a follow-up:** the `failed` stage waits for the same ledger settle. With the stand-in's 6 s failure the box
  showed the tracks with their Failed pills, and the "Couldn't get these tracks" card only 96 s after Request. Real gap
  fills run longer than the grace, so it shows sooner there, but a quick failure (a refused fetch, an offline peer) reads
  like this. Navic's `GapStage` takes `done` and `failed` from its ledger row too; whether its settle has the same grace is
  not checked.
- **Not fixed, a follow-up:** when only `/lb/gap` fails and `/lb/fills` answers, the app-root watcher rewrites the gap's
  cache entry from its summary on each tick, which resets the box's failing clock, so the box never gives up and keeps
  polling (9 to 10 reads a minute for 4 minutes while searching, with this device's ledger row open). The give-up works
  when lb-bot is wholly down (the hub then hides the box) and when no local ledger row exists.
- The album page's pinned header overlaps the hero's "ALBUM" kicker at small scroll offsets in some shots (R9's bar, not
  this lane).

## Not verified

- A real slskd search and download, and lb-bot's real gap view (the stand-in mimics its fields from `_source_view` and
  `_group_source_task_view`); a real landing in Navidrome (no files were written, so the tracklist growing after a fill
  was not seen, only the re-reads that would show it).
- The owner's library and the owner's machine; frames and motion (the session was locked); narrow widths.
- Navic beside it on a screen (the AVD was down).
- B-231 (ruled by the controller): the attention stage offers Open in lb-bot and Re-check for both causes, as Navic, while
  PROTOCOL 15.2 says a pending match still offers search, fetch and Auto for the tracks still missing.

## English still in code (outside the review, left as found)

`extraFilesView` in `utils/album-download.ts` ("Download all M files" and its line), the "lb-bot's default" quality label
in `find-sources-section.tsx`, `use-album-request.ts`'s toasts ("lb-bot could not start the download", "Already
downloading this album"); units (kbps, MB, Mbps) stay in code.
