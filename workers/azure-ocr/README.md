# OCR worker

Reads proof screenshots and records the result on the matching row, for two queues:

- **`listing_proofs`** — the proof screenshots sellers upload with a listing, giving a listing the **Guaranteed
  Lucky** badge when its appraisal proves the Pokémon was caught early.
- **`profile_proofs`** — a trainer's "My Trainer Code" screenshot (their name and a 12-digit friend code, usually
  beside a QR block), writing their handle and friend code into `profiles` / `profile_private` so they never have
  to type either by hand.

It runs as an **Azure Function App** (Node.js, TypeScript, the `@azure/functions` v4 programming model) and is
deliberately separate from the Expo app: its own `package.json`, lockfile and `tsconfig.json`, and nothing in
`app/`, `components/`, `store/` or `lib/` imports it. Images stay in Supabase Storage (`listing-proofs` /
`profile-proofs` buckets). The worker only ever reads screenshots trainers uploaded themselves; it never calls
Niantic or any Pokémon GO site.

```
listing_proofs.ocr_status = 'pending'                    profile_proofs.ocr_status = 'pending'
   │  claim (pending → processing)                           │  claim (pending → processing)
   ▼                                                          ▼
download from Storage ─► tesseract.js ─► decide by kind    download ─► tesseract.js + QR scan ─► interpretProfile
                                             │                                                       │
 appraisal ── "Caught <date>" ───────────────┼─► verified {"caughtAt":"2018-11-23"}      handle + code found ──┼─► apply_profile_proof(...)
     │                                       │      └─ before 2019-07-01? ─► listings.lucky = true             │      (writes profiles.handle,
     └─ no date ──────────────────────────► failed {"reason":"unreadable"}                                     │       profile_private.friend_code,
 movesets / event_badge ── readable text ────┼─► verified {}                                                    │       and settles the proof —
     └─ blank, or not an image ────────────► failed {"reason":"unreadable"}              missing either ─────► failed  all inside one RPC)
                                                                                          {"reason": "no_handle" | "no_friend_code", ...}
```

Both queues share one claim/settle engine (`src/core/process.ts`'s `QueueSpec` / `processQueue` / `processOne`);
`src/functions/ocrSweep.ts` (a timer) sweeps both, and `src/functions/profileOcr.ts` (an HTTP endpoint) handles
the profile queue on a database-triggered nudge, for reasons explained below.

## Isolation from the app

| The app's tooling | How this folder is kept out |
| --- | --- |
| TypeScript | `workers` is in the `exclude` list of the root `tsconfig.json`. This folder has its own standalone `tsconfig.json`. |
| Metro / the bundle | `workers/` is in `resolver.blockList` in `metro.config.js`, so it is not crawled, watched or bundled. |
| Secrets | `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and lives only in this Function App's application settings. Never put it in the app's `.env*` files: anything prefixed `EXPO_PUBLIC_` is bundled into the app. |

## Layout

```
src/core/env.ts          environment variables and locating the tesseract language model
src/core/log.ts          one JSON object per log line; never OCR text, a handle, or a friend code
src/core/ocr.ts          a shared tesseract.js worker, with a per-image timeout
src/core/date.ts         the catch-date regex and validation (pure, unit-tested)
src/core/parser.ts       what a proof's OCR text amounts to — interpretProof (listing) and interpretProfile (profile)
src/core/qr.ts           decodes a QR code out of a profile screenshot, if there is one (pure-ish: only reads pixels)
src/core/process.ts      the shared claim → download → OCR → decide → settle engine (QueueSpec), plus both queues' specs
src/functions/ocrSweep.ts    timer trigger: sweeps both queues once a minute
src/functions/profileOcr.ts  HTTP trigger: the profile queue's insert-triggered nudge, and its own catch-up sweep
src/try.ts                OCR one local image, no database (npm run try)
test/                     unit tests and synthetic screenshot fixtures
scripts/smoke.ts          end-to-end check against the local Supabase stack
```

## Setup

```bash
cd workers/azure-ocr
npm ci
cp local.settings.json.example local.settings.json
```

Fill in `local.settings.json` (git-ignored — `func start` loads its `Values` into the process environment, the
same role Application Settings play once this is deployed):

```bash
npx supabase status -o env      # from the repo root, if the local stack is running: prints API_URL and SERVICE_ROLE_KEY
```

Azurite (the local Azure Storage emulator, needed for the `AzureWebJobsStorage` the Functions runtime itself
uses to track the timer trigger's schedule — nothing this worker's own code reads) is expected to already be
running in Docker on ports 10000-10002. `AzureWebJobsStorage: UseDevelopmentStorage=true` in
`local.settings.json.example` points at it.

## Run it locally

```bash
npm start        # npm run build, then func start
```

`OCR_SWEEP_ON_STARTUP=true` (the example settings) makes `ocrSweep` run immediately instead of waiting for its
first minute mark, so `npm start` alone drains whatever is `pending` right away. **This processes the HOSTED
queues** — Supabase is a hosted, linked project (`sqhvurpokqemdaxckcrt`), not a local stack this worker starts
of its own — including any real pending `listing_proofs` rows, exactly as the Lambda worker did.

**Why the hosted database can't just call `localhost` for you.** `private.notify_profile_ocr` (migration
`20260926000100_profile_proofs.sql`) fires an HTTP call to whatever URL is in the `azure_ocr_url` Vault secret
right after a `profile_proofs` row is inserted — but that call comes from Supabase's own servers via `pg_net`,
which cannot reach a `localhost` port on your machine. Two consequences:

- **Leave `azure_ocr_url` unset while developing locally**, or point it only at a deployed Function App.
  `notify_profile_ocr` simply returns without doing anything when it is unset (see the migration's header
  comment) — it is not an error state.
- **Local testing of the profile queue therefore depends entirely on the timer sweep** (`ocrSweep`, or manually
  invoking `profileOcr`) rather than the insert-triggered nudge. Upload a profile proof, then either wait for the
  next minute mark or:

  ```bash
  curl -X POST http://localhost:7071/api/profile-ocr -d '{}'
  ```

  The empty body is fine — `proofId` is only ever a hint (see `src/functions/profileOcr.ts`); with none, it just
  sweeps the whole queue.

**With real uploads from the app.** Run the app with `EXPO_PUBLIC_DATA_SOURCE=supabase`, publish a listing with
proof screenshots or upload a profile proof, then either wait for `ocrSweep`'s next tick or `curl` the endpoint
above. Look at the result in the Supabase dashboard's table editor, or:

```bash
docker exec supabase_db_PokeGoTrades psql -U postgres -c \
  "select kind, ocr_status, ocr_extracted from listing_proofs order by created_at desc"
```

(That specific `docker exec` target is for a *local* Supabase stack; against the hosted project, use the
dashboard's SQL editor instead.)

## Test it locally

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm test` | The date rules, the per-kind listing rules and the Lucky cutoff, and the profile parser (handle extraction, friend-code OCR-noise correction, QR precedence, ambiguity). | nothing |
| `npm run try -- path/to/image.png [kind]` | Runs the real OCR on one image and prints the raw text and what the worker would decide for that `kind` (`appraisal` default, `movesets`, `event_badge`, or `profile`). For `profile`, also runs the QR scan and prints the handle it found — safe here because this command's output is local-only, unlike `src/core/log.ts`, which must never carry one. | nothing |
| `npm run smoke` | Everything end to end: real Storage objects and rows, `processQueue`, every listing-proof kind, PNG / JPEG / WebP, the Lucky update (granted, already set, blocked by an offer, refused on an ambiguous date), unreadable and missing files, two workers racing for the same rows, stale-claim recovery, the time budget — plus the profile queue, on throwaway trainer accounts it creates and deletes itself: a clean read, a handle collision (`handle_taken`, leaving the losing trainer's own profile untouched), and the same unreadable/missing-file failures as the listing queue. | local Supabase + `.env` (see `.env.example` — this script runs under `tsx`, not `func start`, so it does not see `local.settings.json`) |
| `npm run typecheck` | Types for `src`, `test` and `scripts`. | nothing |

`npm run smoke` writes only to your **local** stack (it refuses any other host), removes what it created, and,
like any worker, also processes whatever else is `pending` in that database.

The fixtures in `test/fixtures/` are synthetic screens rendered from text, **not real Pokémon GO screenshots**
(the profile queue's smoke-test images are rendered the same way, inline in `scripts/smoke.ts`). To tune against
the real thing, drop screenshots in and use `npm run try -- shot.png appraisal` (or `profile`): it prints what
tesseract read, so a missed date, handle, or friend code can be told apart from a missed anchor word.

## How it decides

**Status flow**, for both queues. `pending → processing → verified | failed`. Each step is
`update ... where ocr_status = <expected>`, so two overlapping runs (the timer trigger firing again before the
last invocation finished, an HTTP-triggered sweep alongside it, a retry) never read the same row twice, and a
result never overwrites a status someone else set meanwhile (such as a moderator's `rejected`, which this worker
never sets).

### Listing proofs (`listing_proofs.kind`)

| `ocr_status` | `ocr_extracted` | Meaning |
| --- | --- | --- |
| `processing` | `{"claimedAt": "<ISO time>"}` | A run has it. Older than `OCR_CLAIM_LEASE_SECONDS`, it is put back to `pending` (the run died). |
| `verified` | `{"caughtAt": "YYYY-MM-DD"}` | An **appraisal** proof with a believable catch date. |
| `verified` | `{"caughtAt": "YYYY-MM-DD", "ambiguous": true}` | Same, but day and month could be either way round, so `OCR_DATE_ORDER` decided (below). |
| `verified` | `{}` | A **movesets** or **event_badge** proof: OCR read text off it. Nothing is extracted. |
| `failed` | `{"reason": "unreadable"}` | Appraisal: no catch date. Movesets / event_badge: no readable text. Any kind: not a decodable image, the image took too long, or the file is missing from Storage. |
| `failed` | `{"reason": "image_too_large"}` | More pixels than `MAX_PIXELS` (`src/core/process.ts`) — rejected from its header alone, before decoding. |

A problem that is not the image's fault (Storage or database hiccup, the OCR engine failing to start) does not
fail the proof: it goes back to `pending`, is logged at `error` level, and the next run tries again.

- **`appraisal`** must show a catch date. Found, it is `verified` with `{ caughtAt }`; not found, it `failed` as
  `unreadable`. It is the only kind that can earn the Lucky badge.
- **`movesets`** and **`event_badge`** need no date. For the MVP they are `verified` once OCR reads text off the
  image: at least three words of three or more letters or digits, which a blank image does not give (and a photo
  usually will not). A date on one of these is ignored. `MIN_TEXT_TOKENS` in `src/core/parser.ts` is the one
  place to tighten it.
- Any other kind (the database enum gained a value this worker predates) throws, so the proof stays `pending`
  and is retried once the worker is updated. It is never guessed at.

**Guaranteed Lucky.** When an `appraisal` is verified with a catch date **before 2019-07-01** (`LUCKY_CUTOFF` in
`src/core/parser.ts`; 2019-06-30 qualifies, 2019-07-01 does not), the worker runs
`update listings set lucky = true where id = <the proof's listing> and lucky = false`, and the feed card shows
the badge from then on.

- **Never on a guess.** An ambiguous date only counts if *every* reading is before the cutoff.
- **It only ever sets `lucky = true`.** It never clears it, and it leaves an already-Lucky listing alone.
- **Applied before the proof is saved as verified**, inside the listing queue's `handle` step
  (`src/core/process.ts`'s `listingProofsQueue`) — if the run dies in between, the proof is still `processing`,
  so it is released and redone, and the (idempotent) update repeats.
- **An offer blocks it.** `guard_listing_update` refuses to change a listing's trade details once anyone has made
  an offer on it, service role included. The worker treats that as a final answer: the proof still verifies, the
  listing is left as it is, `luckyBlocked` is counted in the run summary.

**The date.** Pokémon GO prints `Caught MM/DD/YYYY` or `DD/MM/YYYY`, depending on the game's language. See
`src/core/date.ts`'s doc comment for the exact rules (the 40-character window after "Caught", OCR noise
tolerance, how an ambiguous reading is settled by elimination or by `OCR_DATE_ORDER`).

### Profile proofs

| `ocr_status` | `ocr_extracted` | Meaning |
| --- | --- | --- |
| `processing` | `{"claimedAt": "<ISO time>"}` | Same meaning as the listing queue. |
| `verified` | `{"handle": "AshKetchum123"}` | The handle and friend code were both read and applied. The friend code is not repeated here — it already lives in `profile_private`, which is owner-only readable; this row is too, but this worker's own rule (never write a handle or a friend code where a shared log could pick it up) is followed here as well, out of caution. |
| `failed` | `{"reason": "no_handle", "friendCode"?: "..."}` | No line of the OCR text was unambiguously just a trainer name. If a friend code WAS read, it is included so the app's manual fallback form can prefill it. |
| `failed` | `{"reason": "no_friend_code", "handle"?: "..."}` | No 12-digit code was found (or two different ones were, which is treated as neither: never a guess). |
| `failed` | `{"reason": "handle_taken" \| "friend_code_taken" \| "invalid_handle", "handle": "...", "friendCode": "..."}` | Both were read, but writing them lost to another trainer's row, or failed the database's own format rules. See `apply_profile_proof` in the migration. |
| `failed` | `{"reason": "unreadable" \| "image_too_large"}` | Same meaning as the listing queue. |

**Reading the screen** (`interpretProfile`, `src/core/parser.ts`):

- **Handle.** Anchored on one of the two landmarks the screen actually prints the name next to — never just the
  first handle-shaped line anywhere in the OCR text, which could as easily be a menu label or, on the wrong
  screen entirely (an appraisal, say), a Pokémon's name:
  1. If the OCR text has a friend-code-shaped line, the handle is the nearest candidate line **above** it
     (`HANDLE_LOOKBACK_LINES`, currently 3) — the game always prints the name directly above its own code.
  2. Otherwise, if a "TRAINER CODE" / "FRIEND CODE" header line is present, the handle is the first candidate
     within `HANDLE_LOOKAHEAD_LINES` (4) lines **after** it. This is also how a handle is found when the friend
     code came only from the QR scan and never showed up in the OCR text at all.
  3. Otherwise there is no handle — nothing on the screen anchors the search, so nothing is guessed at.

  A "candidate" line is, after trimming whitespace and surrounding punctuation, exactly one token matching the
  shape the database requires (`^[A-Za-z0-9]{3,15}$`), not all digits, not the reserved `Trainer\d{8}` placeholder
  shape, and not one of a stop-list of UI words (FRIEND, CODE, SCAN, SETTINGS, and so on — see
  `HANDLE_STOP_WORDS`). No fuzzing or scoring beyond that: the handle is printed once, plainly, on its own line.
- **Friend code.** A decoded QR payload wins outright when `friendCodeFromQr` can read one out of it (below).
  Otherwise, the OCR text is scanned for `dddd<sep>dddd<sep>dddd`, where `<sep>` is 0 to 2 separator characters
  (space, `·`, `.`, or `-`) — the game always prints exactly one, but tesseract sometimes drops it entirely (two
  groups run together with no gap) or doubles it up — correcting the letters tesseract commonly confuses with a
  digit (O/o→0, I/l/|→1, S→5, B→8) inside each candidate group only. The match is fenced on both ends so it can
  never be a 12-character slice out of a longer run of digit-like characters: a 13-digit number never yields a
  false code. At least 8 of the 12 characters must already be real digits (`MIN_REAL_DIGITS`) before the
  confusion fixes apply: the QR block OCRs into runs of `|`, `l` and `I`, which would otherwise read as
  `111111111111` and either invent a code or make the real one look ambiguous. Two different 12-digit readings
  on the same screen is treated as ambiguous (`no_friend_code`), never resolved by picking one.
- **The QR payload.** The current game's QR encodes a deep link, not bare digits:
  `https://pokemon-go.onelink.me/<id>?af_dp=pokemongo://&deep_link_value=dl_action%3DAddFriend%2CDlId%3D<12
  digits>` — escaped twice over (the query string, then `deep_link_value` inside it), so `friendCodeFromQr`
  first runs the payload through `decodeURIComponent` repeatedly (stopping once a pass changes nothing, capped
  at 3 passes; an undecodable string is used raw rather than thrown away), then tries, in order: a
  `DlId=(\d{12})` match (case-insensitive); failing that, exactly one standalone 12-digit run in the decoded
  string; failing that, the old bare-digit rule (the payload's digits, and only its digits, total exactly 12) for
  a QR code with nothing but the code in it.
- **The QR scan** (`src/core/qr.ts`) runs after the same `MAX_PIXELS` guard the listing queue uses, downscaled to
  at most 1600 px on the long side, and never throws: a screen with no QR block (or one that fails to decode) is
  routine, not an error, and just falls back to the OCR-read code.

**Applying a read** (`public.apply_profile_proof`, the migration): the worker never writes `profiles` or
`profile_private` directly. It calls this service-role-only RPC, which claims the row, writes both columns, and
settles the proof to its terminal status, all inside one transaction — see the migration's header comment for
why (a trainer's own handle changing mid-flight, or colliding with someone else's, needs the two tables' own
constraints as referee, atomically).

## Configuration

Set in `local.settings.json` locally (see `local.settings.json.example`), as Application Settings once deployed.

| Variable | Default | |
| --- | --- | --- |
| `SUPABASE_URL` | required | API URL, e.g. `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | required | The service role (or secret) key. Bypasses RLS. |
| `OCR_BATCH_SIZE` | `10` | Rows handled per run, per queue |
| `OCR_DATE_ORDER` | `MDY` | `MDY` or `DMY`, for listing-proof dates that are ambiguous |
| `OCR_CLAIM_LEASE_SECONDS` | `600` | How long `processing` may last before it is released |
| `OCR_IMAGE_TIMEOUT_SECONDS` | `60` | Give up on one image after this long |
| `OCR_LANG_PATH` | unset | Folder with `eng.traineddata.gz`. Default: resolved from the `@tesseract.js-data/eng` dependency. |
| `OCR_RUN_BUDGET_SECONDS` | `540` | `ocrSweep`'s own time budget, shared across both queues (profile first, then listing) |
| `OCR_SWEEP_ON_STARTUP` | `false` | `true` runs `ocrSweep` immediately when the Function App starts, instead of waiting for the next minute mark |

## Deploy to Azure

Flex Consumption, Node 22 (the standard route with the Azure CLI and Core Tools; replace the `<…>` values):

```bash
az group create --name pokegotrades-ocr --location <region>
az storage account create --name <storageaccount> --location <region> \
  --resource-group pokegotrades-ocr --sku Standard_LRS
az functionapp create --resource-group pokegotrades-ocr --name <app-name> \
  --storage-account <storageaccount> --flexconsumption-location <region> \
  --runtime node --runtime-version 22
```

Set the application settings (do this in the portal, or from a file that stays out of your shell history and is
never committed — do not put `SUPABASE_SERVICE_ROLE_KEY` in a command line):

```bash
az functionapp config appsettings set --name <app-name> --resource-group pokegotrades-ocr --settings \
  SUPABASE_URL="https://<project-ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

Publish (a **remote build**, so `sharp` gets Linux x64 binaries rather than whatever platform you built on
— the same reason `scripts/package.sh` used to hand-pick `sharp`'s platform for the Lambda zip; here Azure's own
build server does that for free, which is also why `@tesseract.js-data/eng` had to move to `dependencies`):

```bash
func azure functionapp publish <app-name>
```

Because `tesseract.js` OCR is CPU-bound and a single tesseract worker per process is reused across invocations
(`src/core/ocr.ts`), set the HTTP trigger's per-instance concurrency to 1 — otherwise two overlapping requests on
the same instance queue behind one CPU-bound `recognize()` call instead of scaling out:

```bash
az functionapp config appsettings set --name <app-name> --resource-group pokegotrades-ocr --settings \
  FUNCTIONS_WORKER_PROCESS_COUNT=1
```

(Flex Consumption's per-instance concurrency for HTTP triggers is otherwise set via the `http` section of the
plan's scale settings in the portal — set it to 1 for the same CPU-bound reason.)

Get the function key `notify_profile_ocr` needs to call `profileOcr` (`authLevel: 'function'`):

```bash
az functionapp function keys list --name <app-name> --resource-group pokegotrades-ocr --function-name profileOcr
```

Then, in the Supabase SQL editor, point the trigger at the deployed endpoint:

```sql
select vault.create_secret('https://<app-name>.azurewebsites.net/api/profile-ocr', 'azure_ocr_url');
select vault.create_secret('<function key>', 'azure_ocr_key');
```

Watch it:

```bash
func azure functionapp logstream <app-name>
```

Logs are one JSON object per line (`src/core/log.ts`). Useful filters: `level = "error"` (alarm on this),
`msg = "verified"`, `msg = "failed"` grouped by `cause` (`no_date`, `decode_error`, `file_missing`, `no_text`,
`no_handle`, `no_friend_code`, `handle_taken`, `friend_code_taken`, `invalid_handle`). OCR text, a handle, and a
friend code are never logged — only that a row was verified or failed, and why.

## Known limits

- **The profile parser has been checked against a small number of real screenshots**, which is how the deep-link
  QR format, the 0-2 separator rule, and the anchored handle search in this document came about — not a large
  corpus. `interpretProfile`'s handle stop-word list is still built from the game's documented "My Trainer Code"
  layout more than from real screenshots read through tesseract. Use `npm run try -- shot.png profile` on real
  ones before relying on the recall further, and extend `HANDLE_STOP_WORDS` in `src/core/parser.ts` as false
  positives turn up.
- **The QR deep-link format is Niantic's current one, not a guaranteed-stable contract.** `friendCodeFromQr`'s
  fallback rules (a standalone 12-digit run, then the old bare-digit rule) exist so a future onelink parameter
  rename doesn't immediately regress recall to zero, but a genuinely different QR payload shape would still need
  a new rule added.
- **Tuned on synthetic images only**, same caveat as the listing queue always had for appraisal / movesets /
  event_badge.
- **`verified` is not "the screenshot is genuine".** It means a believable value was read, not fraud detection.
- **A listing that already has an offer cannot be given the Lucky badge** (see above), so an appraisal verified
  late may leave a deserving listing without it.
- **The badge is not tamper-proof.** The worker sets `listings.lucky`, but the column's own grants also let a
  seller set it themselves through the API on their own open listing (the app's own form sends `false`).
- English digits and four-digit years only, for the listing queue's dates. An ambiguous date is flagged, not
  resolved.
- Neither queue picks up a settled row again. Replacing an image at the same storage path does not reset an
  existing row; to have it read again, set that row back to `pending`.
