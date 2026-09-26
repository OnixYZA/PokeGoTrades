# OCR worker

Reads the proof screenshots sellers upload with a listing, records the result on each `listing_proofs` row, and
gives a listing the **Guaranteed Lucky** badge when its appraisal proves the Pokémon was caught early. It runs on AWS
Lambda and is deliberately separate from the Expo app: its own
`package.json`, lockfile and `tsconfig.json`, and nothing in `app/`, `components/`, `store/` or `lib/` imports it.
Images stay in Supabase Storage (`listing-proofs` bucket). The worker only ever reads screenshots that trainers
uploaded; it never calls Niantic or any Pokémon GO site.

```
listing_proofs.ocr_status = 'pending'
   │  claim (pending → processing)
   ▼
download from Storage  ──►  tesseract.js  ──►  decide by the proof's kind
                                                    │
 appraisal ── must show "Caught <date>" ────────────┼──► verified {"caughtAt":"2018-11-23"}
     │                                              │        └─ caught before 2019-07-01? ─► listings.lucky = true
     └─ no date ──────────────────────────────────► failed   {"reason":"unreadable"}
 movesets / event_badge ── readable text ───────────┼──► verified {}
     └─ blank, or not an image ───────────────────► failed   {"reason":"unreadable"}
```

## Isolation from the app

| The app's tooling | How this folder is kept out |
| --- | --- |
| TypeScript | `workers` is in the `exclude` list of the root `tsconfig.json`. This folder has its own standalone `tsconfig.json`. |
| Metro / the bundle | `workers/` is in `resolver.blockList` in `metro.config.js`, so it is not crawled, watched or bundled. |
| Secrets | `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and lives only in this worker's environment. Never put it in the app's `.env*` files: anything prefixed `EXPO_PUBLIC_` is bundled into the app. |
| EAS | Not set up in this repo yet (no `eas.json`). When it is, keep `workers/` out of the build upload. |

## Layout

```
src/handler.ts     Lambda entry point (dist/handler.handler)
src/local.ts       local runner: one pass (npm run once) or a polling loop (npm run dev)
src/process.ts     claim → download → OCR → save; the Lucky update; stale-claim recovery
src/parser.ts      what a proof's OCR text amounts to, by kind, and the Lucky cutoff (pure, unit-tested)
src/date.ts        the catch-date regex and validation (pure, unit-tested)
src/ocr.ts         a shared tesseract.js worker, with a per-image timeout
src/env.ts         environment variables and locating the language model
src/try.ts         OCR one local image, no database (npm run try)
test/              unit tests and synthetic screenshot fixtures
scripts/smoke.ts   end-to-end check against the local Supabase stack
scripts/package.sh builds the Lambda zip
```

## Setup

```bash
cd workers/ocr
npm install
cp .env.example .env
```

Fill in `.env`. For the local stack, from the repo root:

```bash
npx supabase start -x logflare,vector     # if it is not already running
npx supabase status -o env                # API_URL and SERVICE_ROLE_KEY
```

`EXPO_PUBLIC_SUPABASE_URL` is `http://127.0.0.1:54321` locally. `.env` is git-ignored.

## Test it locally

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm test` | The date rules (formats, day/month order, OCR noise, impossible dates), the per-kind rules and the Lucky cutoff. | nothing |
| `npm run try -- path/to/image.png [kind]` | Runs the real OCR on one image and prints the raw text and what the worker would decide for that `kind` (default `appraisal`), including whether it would grant the badge. | nothing |
| `npm run smoke` | Everything end to end: real Storage objects and rows, the Lambda handler, every proof kind, PNG / JPEG / WebP, the Lucky update on the listing (granted, already set, blocked by an offer, refused on an ambiguous date), unreadable and missing files, two workers racing for the same rows, stale-claim recovery, the time budget. | local Supabase + `.env` |
| `npm run typecheck` | Types for `src`, `test` and `scripts`. | nothing |

`npm run smoke` writes only to your **local** stack (it refuses any other host), removes what it created, and, like
any worker, also processes whatever else is `pending` in that database.

**With real uploads from the app.** Run the app with `EXPO_PUBLIC_DATA_SOURCE=supabase`, publish a listing with
proof screenshots, then run the worker:

```bash
npm run once     # one pass over the queue, then exit
npm run dev      # keeps polling every 5 s (--interval <seconds> to change); Ctrl-C to stop
```

Look at the result in Studio (http://127.0.0.1:54323, table `listing_proofs`) or:

```bash
docker exec supabase_db_PokeGoTrades psql -U postgres -c "select kind, ocr_status, ocr_extracted from listing_proofs order by created_at desc"
```

The fixtures in `test/fixtures/` are synthetic screens rendered from text, **not real Pokémon GO screenshots**. To
tune against the real thing, drop screenshots in and use `npm run try -- shot.png appraisal`: it prints what tesseract
read, so a missed date can be told apart from a missed "Caught".

## How it decides

**Status flow.** `pending → processing → verified | failed`. Each step is `update … where ocr_status = <expected>`, so
two runs overlapping (Lambda invocations, or a local worker next to the deployed one) never read the same proof
twice, and a result never overwrites a status someone else set meanwhile (such as a moderator's `rejected`, which
this worker never sets).

| `ocr_status` | `ocr_extracted` | Meaning |
| --- | --- | --- |
| `processing` | `{"claimedAt": "<ISO time>"}` | A run has it. Older than `OCR_CLAIM_LEASE_SECONDS`, it is put back to `pending` (the run died). |
| `verified` | `{"caughtAt": "YYYY-MM-DD"}` | An **appraisal** proof with a believable catch date. |
| `verified` | `{"caughtAt": "YYYY-MM-DD", "ambiguous": true}` | Same, but day and month could be either way round, so `OCR_DATE_ORDER` decided (below). |
| `verified` | `{}` | A **movesets** or **event_badge** proof: OCR read text off it. Nothing is extracted. |
| `failed` | `{"reason": "unreadable"}` | Appraisal: no catch date. Movesets / event_badge: no readable text. Any kind: not a decodable image, the image took too long, or the file is missing from Storage. |

A problem that is not the image's fault (Storage or database hiccup, the OCR engine failing to start) does not fail
the proof: it goes back to `pending`, is logged at `error` level, and the next run tries again.

**By proof kind** (`listing_proofs.kind`).

- **`appraisal`** must show a catch date. Found, it is `verified` with `{ caughtAt }`; not found, it `failed` as `unreadable`. It is the only kind that can earn the Lucky badge.
- **`movesets`** and **`event_badge`** need no date. For the MVP they are `verified` once OCR reads text off the image: at least three words of three or more letters or digits, which a blank image does not give (and a photo usually will not). A date on one of these is ignored. The check is deliberately generic: matching the game's own wording ("Fast Attack" and so on) would need real screenshots to check against. `MIN_TEXT_TOKENS` in `src/parser.ts` is the one place to tighten it.
- Any other kind (the database enum gained a value this worker predates) throws, so the proof stays `pending` and is retried once the worker is updated. It is never guessed at.

**Guaranteed Lucky.** When an `appraisal` is verified with a catch date **before 2019-07-01** (`LUCKY_CUTOFF` in
`src/parser.ts`; 2019-06-30 qualifies, 2019-07-01 does not), the worker runs `update listings set lucky = true where
id = <the proof's listing> and lucky = false`, and the feed card shows the badge from then on.

- **Never on a guess.** An ambiguous date only counts if *every* reading is before the cutoff. `07/04/2018` is 7 July or 4 April 2018: both early, so it earns the badge. `03/09/2019` is 9 March or 3 September 2019: either side of the cutoff, so the proof is `verified` (with `"ambiguous": true`) but the listing is not touched. The price: in 2019, a genuine catch on the 7th to 12th of January to June is withheld too, because its swapped reading falls in July to December. Years before 2019 are unaffected (both readings are early), and so are dates with a day above 12. To trust `OCR_DATE_ORDER` for these instead, change `checkLuckyCutoff` in `src/parser.ts`.
- **It only ever sets `lucky = true`.** It never clears it, and it leaves an already-Lucky listing alone.
- **Applied before the proof is saved as verified.** If a run dies in between, the proof is still `processing`, so it is released and redone, and the (idempotent) update repeats. The other order could leave a verified proof whose listing never got its badge, which nothing would retry.
- **An offer blocks it.** The database's `guard_listing_update` trigger refuses to change a listing's trade details, `lucky` included, once anyone has made an offer on it, and it has no exception for the service role. The worker treats that as a final answer, not a fault: the proof still verifies, the listing is left as it is, `luckyBlocked` is counted in the run summary, and the log line says `"lucky":"blocked"`. It does not retry.

**The date.** Pokémon GO prints `Caught MM/DD/YYYY` or `DD/MM/YYYY`, depending on the game's language.

- Only a date within about 40 characters **after the word "Caught"** counts. A date elsewhere on the screenshot is ignored.
- Spaces around the separators are fine (`03 / 14 / 2021`), as are `-`, `.`, and `|` or `\` misread for `/`; the letter O is read as 0.
- Each way of reading the two numbers (month first, day first) only counts if it is a real calendar date, not before July 2016 (the game's launch) and not in the future (one day of slack for time zones). That settles most dates: `25/12/2019` can only be day first, `06/07/2016` only July 6, `09/12/2026` (read in September 2026) only September 12.
- When both readings survive (`07/04/2018`), `OCR_DATE_ORDER` decides (default `MDY`) and the result carries `"ambiguous": true`. The other reading is kept only for the Lucky check above; it is not saved.
- If no reading survives it counts as no date: a missing badge beats a wrong one.
- Four-digit years only.

## Configuration

Set in `.env` locally, as function environment variables on Lambda.

| Variable | Default | |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | required | API URL, e.g. `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | required | The service role (or secret) key. Bypasses RLS. |
| `OCR_BATCH_SIZE` | `10` | Proofs handled per run |
| `OCR_DATE_ORDER` | `MDY` | `MDY` or `DMY`, for dates that are ambiguous |
| `OCR_CLAIM_LEASE_SECONDS` | `600` | How long `processing` may last before it is released |
| `OCR_IMAGE_TIMEOUT_SECONDS` | `60` | Give up on one image after this long |
| `OCR_LANG_PATH` | unset | Folder with `eng.traineddata.gz`. Default: `lang/` in the package, else the dev dependency. |

## Deploy to AWS Lambda

The steps below are the standard route with the AWS CLI. Replace the `<…>` values.

### 1. Build the package

```bash
npm ci
npm run package        # needs `zip`; writes build/ocr-worker.zip (about 23 MB, 62 MB unpacked)
```

`package` compiles `src/` to `dist/`, installs production dependencies from the lockfile, and adds the English
model as `lang/eng.traineddata.gz` (only that one file; the dev dependency it comes from is not shipped). The
model ships in the zip because a Lambda cold start should not depend on a CDN, and tesseract.js would otherwise
download it. tesseract.js is WebAssembly, so the same zip runs on `arm64` and `x86_64`. It contains no `.env`.

### 2. Create the function

```bash
aws iam create-role --role-name pokegotrades-ocr-worker \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name pokegotrades-ocr-worker \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws lambda create-function \
  --function-name pokegotrades-ocr-worker \
  --runtime nodejs22.x --architectures arm64 \
  --handler dist/handler.handler \
  --role arn:aws:iam::<account-id>:role/pokegotrades-ocr-worker \
  --memory-size 2048 --timeout 300 \
  --zip-file fileb://build/ocr-worker.zip
```

Set the environment in a file, so the key stays out of your shell history:

```bash
# env.json (do not commit): {"Variables":{"EXPO_PUBLIC_SUPABASE_URL":"https://<ref>.supabase.co","SUPABASE_SERVICE_ROLE_KEY":"<key>"}}
aws lambda update-function-configuration --function-name pokegotrades-ocr-worker --environment file://env.json
```

The role only needs CloudWatch Logs; the worker talks to Supabase over HTTPS with the key, not to any AWS service.
Lambda encrypts environment variables at rest, but anyone who can read the function's configuration can read the
key. For production, keep it in Secrets Manager or SSM Parameter Store and fetch it at startup, and rotate it if
it ever leaks.

**Sizing.** OCR is CPU-bound and Lambda's CPU scales with memory, so 2048 MB is a starting point to tune, not a
measurement. With the defaults a run handles up to 10 proofs; it stops starting new ones when less than the image
timeout plus 5 s remains, so a run never dies mid-image.

### 3. Run it on a schedule

```bash
aws events put-rule --name pokegotrades-ocr-worker-tick --schedule-expression 'rate(1 minute)'
aws lambda add-permission --function-name pokegotrades-ocr-worker --statement-id tick \
  --action lambda:InvokeFunction --principal events.amazonaws.com \
  --source-arn arn:aws:events:<region>:<account-id>:rule/pokegotrades-ocr-worker-tick
aws events put-targets --rule pokegotrades-ocr-worker-tick \
  --targets 'Id=1,Arn=arn:aws:lambda:<region>:<account-id>:function:pokegotrades-ocr-worker'
```

Overlapping invocations are safe (claims are compare-and-swap). Optionally cap it with
`aws lambda put-function-concurrency --function-name pokegotrades-ocr-worker --reserved-concurrent-executions 1`
to avoid two runs contending for the same rows.

### 4. Try it, watch it, update it

```bash
aws lambda invoke --function-name pokegotrades-ocr-worker --payload '{}' --cli-binary-format raw-in-base64-out out.json && cat out.json
aws logs tail /aws/lambda/pokegotrades-ocr-worker --follow

# after a change
npm run package
aws lambda update-function-code --function-name pokegotrades-ocr-worker --zip-file fileb://build/ocr-worker.zip
```

The handler returns what it did: `{"claimed":3,"verified":2,"failed":1,"released":0,"lostClaim":0,"recovered":0,"luckyGranted":1,"luckyBlocked":0,"outOfTime":false}`.

Logs are one JSON object per line. Useful CloudWatch Logs Insights queries: `filter level = "error"` (alarm on
this), `filter msg = "verified"`, `filter msg = "failed" | stats count() by cause` (`no_date`, `decode_error`,
`file_missing`, and `no_text` for a movesets or event_badge proof). A `verified` line for an appraisal also carries `catchVsCutoff` (`early`, `late`, `unclear`) and `lucky` (`granted`, `unchanged`, `blocked`); `filter luckyBlocked > 0` on `run finished` finds listings that missed out because of an offer. OCR text is never logged: a screenshot can show a trainer name or a friend code. A line
`Error in pixReadStream: Unknown format` in the logs just means someone uploaded a file that is not an image.

## Known limits

- **Tuned on synthetic images only.** Real Pokémon GO screenshots (font, scaling, dark or light backgrounds) have not been run through it. Use `npm run try` on real ones before relying on the recall.
- **`verified` is not "the screenshot is genuine".** For an appraisal it means a believable catch date was read; for movesets and event_badge only that there was readable text. It is not fraud detection.
- **A listing that already has an offer cannot be given the badge** (see above), so an appraisal that is verified late, for instance after the worker was down, may leave a deserving listing without it. Letting the worker through would need an exception for the service role in `guard_listing_update`, a change to the database's bait-and-switch rule that is not made here.
- **The badge is not tamper-proof yet.** The worker sets `listings.lucky`, but the database's column grants also let a seller set it themselves through the API on their own open listing (the app's own form sends `false`).
- English digits and four-digit years only. An ambiguous date is flagged, not resolved.
- The worker only picks up `pending` rows. Replacing an image at the same storage path does not reset an existing row: to have it read again, set that row back to `pending`.
