# Results: R4, arrivals once per history entry

Plan: `PLAN-feishin-arrivals-once-2026-10-28.md` (outside the repo, in the umbrella's `navi-connect/`). Branch
`fix/arrivals-once-2026-10-28`, local only, never pushed to GitHub. Written 2026-10-28. Cut from R3's tip `193e26ae`; the base for
every "before" number below.

| Commit | What |
|---|---|
| `78138c72` | The arrived-entries record: which (history entry, list) pairs showed their arrivals |
| `09062bcd` | `useArrival` leaves a pair that already arrived at rest (B-204) |
| `9887afd1` | Fix round: marks follow `location.key` across a replace (review I-1) |
| `5f5271f2` | A forward push opens a page at its top (B-208) |
| `d3ea15cd` | A mood chosen on Home arrives every time it opens (found by the walk) |

## What changed

- React Router remounts a page on Back, so every arrival replayed. The record (`arrivedEntries`, 200 entries) remembers the pair
  (`location.key`, list key); a mount that finds its pair already shown opens no window. Two lists that share a key on one page
  (Home's shelves) still all arrive on the first visit: a list that opened a window holds its pair while mounted (`hold`).
- The record is written in an effect through `settleVisit`, for every decided mount (opened or skipped), under the CURRENT
  `location.key`. A replace that keeps the page mounted (the Library writing its search or sort into the URL, a click on Home while
  on Home) therefore marks the entry that is really in history.
- `useArrival(ready, key?, { once: false })` opts a list out of the record. The mood body uses it: a mood is opened in place by a
  gesture, never remounted by history, and it must arrive each time it opens.
- B-208: the scroll store ignores a key that names no entry (`default`, empty). See "B-208" below.

## Gates

Run on the final branch at `d3ea15cd` (before this note's commit), workstation.

| Gate | Command | Result |
|---|---|---|
| Web build | `pnpm build:web` | exit 0 |
| Remote build | `pnpm build:remote` | exit 0 |
| tsc, renderer and main | both configs, `--composite false`, TS6307 filtered | no output |
| eslint | `--max-warnings=0` over the 6 changed ts/tsx files | exit 0 |
| Harnesses | `node --test $(git ls-files 'src/**/*.harness.ts')` | 76 files, 992 pass, 0 fail |
| commitlint | `--from 2302d69a` | clean |
| Em dash | added lines in `193e26ae..HEAD` | 0 |

Harness count: 74 files at `193e26ae`; this branch adds `arrived-entries.harness.ts` (17 cases) and `scroll.store.harness.ts` (3), so
972 before, 992 after. The new cases were each watched failing before the code existed.

## Rulings

- Ruling: Task 3 (B-208) moves from the implementer to the fix agent: it starts with a reproduction on the VM, which R3's walk holds now - cost if wrong: B-208 lands one agent later.
- Ruling: the record gains hold(entry, list) and arrives(entry, list) beyond the plan's has/mark/size - the plan's pair (location.key, key ?? '') is identical for every unkeyed list on one page (Home's shelves, 33 tiles), so the first shelf's mark would have suppressed its siblings on the first visit (Review Focus 4); a hold counts mounted lists from the visit that opened a pair and a late-filling sibling still arrives while any holder is mounted - cost if wrong: a shelf that fills after its sibling unmounted would not arrive, or siblings could replay if holds leak.
- Ruling: the record is written in a useEffect (mark + hold, released on cleanup), only read in render - keeps same-pass siblings both arriving and StrictMode double render from marking - cost if wrong: a render between a list's open and its effect sees the pair unmarked (concurrent rendering only).
- Ruling: a mount that finds its pair arrived stays closed for the life of that mount and key (skippedRef), as the plan says - cost if wrong: none seen.
- Ruling: lane review runs before the rebase onto R3's final tip (R4 touches no R3 file) - cost if wrong: a re-check after the rebase.
- Ruling: the hold/arrives departure from the plan stands (review judged it necessary for Focus 4) - cost if wrong: a simpler record later.
- Fix round: the rule "mark the current entry for every decided mount, hold only for an opened window" is a pure helper (`settleVisit`) so the harness can pin it; the hook itself is not rendered in a harness (the repo has no React test setup), so a source guard pins its effect.
- Task 3: the cause lives in the scroll store, so the fix is there (one place covers the native scroll area, the item list and the Library place) - cost if wrong: a page that wants a place saved under a stateless entry gets none.
- Walk finding: the mood body opts out of the record with `{ once: false }` rather than keying by mood id (a key would still show a re-opened mood at rest) - cost if wrong: a mood chosen again on the same entry replays, which is what it did before R4.

## Deferred minors

- Discography Back after a filter change with search text set finds the pair (K2, view key) unmarked and replays (rare).
- Side effect (review M-2): an entry whose list first showed rows after the user had already left it is marked by the visit; judged invisible to a person.
- A history entry React Router did not create (a hash assigned from code, `location.replace` as lb-bot's leave path does) has no state, so it reads back with the key `default`, and every such entry shares one record pair: after the first, they open at rest. Real app paths are few (the lb-bot leave path; the audit and test scripts that assign `location.hash`), found by reading, not measured. It is the price of keying by `location.key`; the alternative (always arrive on `default`) would replay the first entry of a session on Back, the most common case.
- Typing the same term again on an entry whose pair (entry, term) is marked shows it at rest (same shape as the discography minor).
- `heldPlaces` in `use-library-place.ts` is also keyed by `location.key`, so a text or sort held under `default` is shared too. Not changed here; B-208's fix covers scroll offsets only.

## Review Focus: where each item is answered

| # | Item | Answered |
|---|---|---|
| 1 | Cold launch arrives once | Walk (a): the cold Home had 3 arrival elements, 3 animations started, on the base and on the branch alike. Back to it: 0 on the branch, 3 on the base. |
| 2 | Library search: a new term arrives, Back to an older term is at rest | A fresh term (`moon`) with visible external rows: 1 arrival; open an artist, Back: 0 started, Forward then Back: 0. Typing `the` gave 0 on base and branch (its lookup was cached, no external row on screen), so that term alone proves nothing. |
| 3 | Refetch or page flip animates nothing | Unchanged rule (the window closes 900 ms after it opens, `arrival.ts` untouched); not re-measured. |
| 4 | Two lists on one page: each arrives on the first visit, none on Back | Home via Link: 32 started on the branch (dev), 23 with eight shelf requests held 3.5 s (late shelves arrive: the same 23 as the base), Back to either Home: 0 (base: 3 and 3). |
| 5 | Memory bounded | Harness `thousandEntriesStayBounded` (1,000 entries, size 200) passes; not watched in a long session. |

## Watched running on the VM

Sandbox VM, the clone `~/src/feishin-repair`: the base `193e26ae` (detached) for "before", the branch at `5f5271f2` and `d3ea15cd`
for "after". Dev app (CDP 9222, profile `cfg`), then a production build of `d3ea15cd` (CDP 9223, profile `cfgprod`) for one repeat
of the walk. Viewport 1440 x 900, a CDP emulation. The stand-ins were the README's, plus a stand-in AudioMuse on loopback :4880
(stats say CLAP is loaded, searches answer empty) that I pointed the scratch hub at so Home's mood chips show; the scratch hub and
fake lb-bot were restarted for that. Navigation is by Link clicks (a PUSH with a fresh key), `history.back()` and
`history.forward()`.

**Metric.** A counter on `animationstart` for elements carrying `data-arrive`, reset before each step, read 6 s after (16 to 20 s for
the slow-shelf step). "Started" below is that count. A second figure (elements that ever carried the attribute) also appears
as `x/0` on a step that leaves a page; it is the page being left, and the started count is the one to read.
**The session was locked (`LockedHint=yes`), so the window ran at about 2 fps: counts are timing-sensitive, frame numbers are not
quoted.** Counts that appear late (the cold Home's start events come at about 11 s) were read after a long enough wait.

| Step | Base `193e26ae` dev | Branch dev | Branch production |
|---|---|---|---|
| a cold launch Home | 3 | 3 | 3 |
| b Home to album (Link) | 0 | 0 | 0 |
| c Back to Home | **3** | **0** | **0** |
| d Forward to the album | 0 | 0 | 0 |
| c2 Back to Home again | **3** | **0** | **0** |
| b2 album to artist (new) | 6 | 6 | 6 |
| c3 Back to the album | 0 | 0 | 0 |
| c4 Back to Home | **3** | **0** | **0** |
| d2 Forward x2 to the artist | **6** | **0** | **0** |
| e1 Home to Library (Artists) | 13 | 13 | 13 |
| e3 open an artist (new entry) | 6 | 6 | 6 |
| e4 (a) Back to the Library with a term | **14** | **0** | **0** |
| e5 Forward to the artist | **6** | **0** | **0** |
| e6 Back again | **14** | **0** | **0** |
| e7 change the sort | 0 | 0 | 0 |
| e8 open an artist after the sort | 3 | 3 | 3 |
| e9 (a) Back after the sort change | **14** | **0** | **0** |
| f2 click Home while on Home (a replace) | 0 | 0 | 0 |
| f4 (b) open an album, Back to Home | **3** | **0** | **0** |
| i1 slow shelves, Library to Home | 23 | 23 | 18 |
| i3 Back to the slow Home | **3** | **0** | **0** |
| g1 to g3 moods on a Back-restored Home | 6, 4, 6 | **0, 0, 0** at `5f5271f2`; 4, 4, 4 at `d3ea15cd` | 4, 4, 4 |
| h1 to h3 moods on a cold Home | 6, 4, 6 | 6, 4, 6 | 4, 4, 4 |

Bold rows are the ones R4 exists to change. The branch's first Home visit by Link after a cold start counted 3 (dev) or 6
(production, and the base once) and 32 on every later visit in a repeat of four (3, 32, 32, 32); that is the
page's own warm-up on this VM, the same on every build, and is why f1 is left out of the table. The step "typed a term" (e2) is
left out because its count depends on whether the lookup's external rows are on screen (see Review Focus 2).

The two review cases: (a) a term typed or the sort changed in the Library, an artist opened, Back: 14 started on the base, 0 on the
branch. (b) Home clicked while on Home, an album opened, Back: 3 on the base, 0 on the branch. Both are the replace cases of
review I-1: before `9887afd1` the entry in history was never marked.

Not measured, as the plan asked: the audit's `run.mjs` push scenario (dropped frames and main-thread ms, before and after). Frames
are invalid under a locked session, and the scenario assigns `location.hash`, so all its entries share the key `default` and the
record would hide arrivals from the second on: the numbers would flatter the branch for a reason that is not the fix. Frames move
to the workstation walk, and that walk should use Link clicks.

## B-208, a forward push opening mid-scroll

**Reproduced, with direct hash pushes; not with Link clicks.** Path: Home, "Hits Flag 2", its artist ("The Long Players"), the artist
page scrolled to the bottom (the scroller is the page's OverlayScrollbars viewport, scrollTop 2145 of 2865), Home, then the same
path again.

| Way of going forward | Base `193e26ae` | Branch |
|---|---|---|
| Link clicks, 4 rounds on the base, 10 on the branch | opened at 0 (4 of 4) | opened at 0 (10 of 10) |
| `location.hash = ...`, 4 rounds on the base, 10 on the branch | restored 2145 about 1 to 1.5 s after arrival (4 of 4) | stayed at 0 (10 of 10) |
| Two pages, artist at 1500 then its discography at 400, then the artist by a hash push | opened at **400** (the other page's offset) | opened at 0, dev and production |

**Cause.** `use-native-scroll-persist.ts` saves the offset per `location.key` and restores it on a POP. An entry React Router did
not create has `history.state` null, so it is read back with the key `default`; a hash change arrives as a POP. Every such entry
shares one key, so the offset another page left under `default` is restored onto the next one. The third row shows it: the artist
page opened at the discography's 400, not its own 1500, and `history.state` was `null` on all of them while a Link click carried
`{usr, key, idx}`. The restore itself was read in `use-native-scroll-persist.ts` (it applies only on POP and polls up to 2 s);
I did not add logging to the restore path, the write was shown by the experiment above and by the zero after the fix.
The audit's A-09 (6,036 left by an earlier visit) came from its `run.mjs`, which assigns `location.hash`. Real paths to a stateless
entry exist too (lb-bot's `location.replace` leave path), so the fix is kept.

**Fix.** `scroll.store.ts`: a key that names no entry (`default`, empty) is never stored and never read (`hasEntryIdentity`). One place
covers the native scroll area, the item list's persist and the Library place. Harness `scroll.store.harness.ts` (3 cases) failed on
the missing export first. Back to a Link-pushed artist page still restores its own offset, dev build of `d3ea15cd`: scrolled to 1500, Home, Back gave 1500; scrolled to 1800,
Home, Back gave 1800 (a third round did not scroll and is not counted); the page opened at 0 each time it was reached by a click.

## Not verified

- Frame rate, dropped frames, main-thread time, the owner's GPU: the VM session was locked. Workstation walk, with Link clicks.
- The audit's `run.mjs` push scenario before and after (see above).
- Review Focus 3 (refetch, page flip) and 5 (a long session) were not watched; the first rests on `arrival.ts` being untouched, the
  second on the harness.
- Back with a restored offset on the discography page and on the item lists after the B-208 fix (two rounds on the artist page were walked, dev only).
- The `default` entries (hash-assigned, lb-bot leave path): the effect on arrivals is by reading, not watched.
- Reduced motion: not walked (the hook still returns nothing under it, code unchanged).
- Window sizes other than 1440 x 900.
