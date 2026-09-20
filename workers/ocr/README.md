# OCR worker

Reads the **catch date** from the proof screenshots sellers upload with a listing, and records the result on the
`listing_proofs` row. It runs on AWS Lambda and is deliberately separate from the Expo app: its own
`package.json`, lockfile and `tsconfig.json`, and nothing in `app/`, `components/`, `store/` or `lib/` imports it.
Images stay in Supabase Storage (`listing-proofs` bucket). The worker only ever reads screenshots that trainers
uploaded; it never calls Niantic or any Pokémon GO site.

```
listing_proofs.ocr_status = 'pending'
   │  claim (pending → processing)
   ▼
download from Storage  ──►  tesseract.js  ──►  find "Caught <date>"
                                                    │
                          date found ───────────────┼─────────────── no date / unreadable image
                               ▼                                            ▼
              verified   {"caughtAt":"2021-03-14"}              failed   {"reason":"unreadable"}
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
src/process.ts     claim → download → OCR → save; stale-claim recovery
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
| `npm test` | The date rules: formats, day/month order, OCR noise, impossible dates. | nothing |
| `npm run try -- path/to/image.png` | Runs the real OCR on one image and prints the raw text and the result. | nothing |
| `npm run smoke` | Everything end to end: real Storage objects and rows, the Lambda handler, PNG / JPEG / WebP, unreadable and missing files, two workers racing for the same rows, stale-claim recovery, the time budget. | local Supabase + `.env` |
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
tune against the real thing, drop screenshots in and use `npm run try -- shot.png`: it prints what tesseract read,
so a missed date can be told apart from a missed "Caught".

## How it decides

**Status flow.** `pending → processing → verified | failed`. Each step is `update … where ocr_status = <expected>`, so
two runs overlapping (Lambda invocations, or a local worker next to the deployed one) never read the same proof
twice, and a result never overwrites a status someone else set meanwhile (such as a moderator's `rejected`, which
this worker never sets).

| `ocr_status` | `ocr_extracted` | Meaning |
| --- | --- | --- |
| `processing` | `{"claimedAt": "<ISO time>"}` | A run has it. Older than `OCR_CLAIM_LEASE_SECONDS`, it is put back to `pending` (the run died). |
| `verified` | `{"caughtAt": "YYYY-MM-DD"}` | A believable catch date was read. |
| `verified` | `{"caughtAt": "YYYY-MM-DD", "ambiguous": true}` | Same, but day and month could be either way round, so `OCR_DATE_ORDER` decided (below). |
| `failed` | `{"reason": "unreadable"}` | No catch date in the image, not a decodable image, the image took too long, or the file is missing from Storage. |

A problem that is not the image's fault (Storage or database hiccup, the OCR engine failing to start) does not fail
the proof: it goes back to `pending`, is logged at `error` level, and the next run tries again.

**The date.** Pokémon GO prints `Caught MM/DD/YYYY` or `DD/MM/YYYY`, depending on the game's language.

- Only a date within about 40 characters **after the word "Caught"** counts. A date elsewhere on the screenshot is ignored.
- Spaces around the separators are fine (`03 / 14 / 2021`), as are `-`, `.`, and `|` or `\` misread for `/`; the letter O is read as 0.
- A part above 12 must be the day, which fixes the order (`25/12/2019`, `03/14/2021`).
- When both parts could be the month (`07/04/2018`), `OCR_DATE_ORDER` decides (default `MDY`) and the result carries `"ambiguous": true`, because a swap changes the month, and a "caught before July 2019" rule reads the month.
- It must be a real calendar date, not before July 2016 (the game's launch) and not in the future (one day of slack for time zones). Anything else counts as no date: a missing badge beats a wrong one.
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

The handler returns what it did: `{"claimed":3,"verified":2,"failed":1,"released":0,"lostClaim":0,"recovered":0,"outOfTime":false}`.

Logs are one JSON object per line. Useful CloudWatch Logs Insights queries: `filter level = "error"` (alarm on
this), `filter msg = "verified"`, `filter msg = "failed" | stats count() by cause` (`no_date`, `decode_error`,
`file_missing`). OCR text is never logged: a screenshot can show a trainer name or a friend code. A line
`Error in pixReadStream: Unknown format` in the logs just means someone uploaded a file that is not an image.

## Known limits

- **Tuned on synthetic images only.** Real Pokémon GO screenshots (font, scaling, dark or light backgrounds) have not been run through it. Use `npm run try` on real ones before relying on the recall.
- **`verified` means "a believable catch date was read", not "the screenshot is genuine".** It is not fraud detection.
- **All three proof kinds are treated alike.** A `movesets` or `event_badge` screenshot that shows no catch date ends `failed` / `unreadable`.
- English digits and four-digit years only. An ambiguous date is flagged, not resolved.
- The worker only picks up `pending` rows. Replacing an image at the same storage path does not reset an existing row: to have it read again, set that row back to `pending`.
