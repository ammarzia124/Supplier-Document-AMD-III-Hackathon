# SYSTEM_LEDGER.md

<!-- Owned by Ammar -->

## Current State

- **Active Phase:** Phase 5 — cleanup, documentation truth, evaluation run.
- **Tests:** 79 passing across 5 suites (`npm test`).
- **Evaluation:** `ai/eval/run_eval.py` runs the 30-PDF synthetic corpus against the backend API; corpus integrity is verified, but no live pipeline evaluation has been recorded.
- **Server:** boots, serves 9 endpoints, healthy without Docker.
- **Database:** MongoDB required for document endpoints; returns an actionable
  503 when unreachable. Orders and metrics degrade gracefully.
- **Version control:** `main` plus `ammar/backend`, `muawia/vllm`,
  `awais/schemas`, `moyeon/frontend`. Remote:
  `github.com/ammarzia124/Supplier-Document-AMD-III-Hackathon`.

## What Works

| Area | State |
|---|---|
| Rules engine (`src/rules/`) | 7 rules + decision gate, minor-unit money math |
| Pipeline (`services/pipelineService.js`) | Upload → Evolus → rules → LLM → redaction → persist, with webhook and polling completion paths |
| Evolus adapter | Mock/live switch, retry with backoff, credential scrubbing |
| vLLM client | Timeout, retry, prompt sanitisation, token accounting |
| Seed data | 8 suppliers, 7 purchase orders, aligned to the demo scenarios |
| Scenarios | All seven mock scenarios reach their documented status, asserted in `tests/scenarios.test.js` |
| M5 evaluation runner | Uploads the ground-truth corpus through the backend API and reports field accuracy, error catch rate, clean-document false alarms, status accuracy, and elapsed time |
| JSON fixtures | Every `.json` file parses; enforced by `tests/fixtures.test.js` |

## Corrections Made

These were found during the stabilisation pass and are now fixed. Recorded here
because each one silently produced wrong behaviour rather than an error.

| Area | Defect | Fix |
|---|---|---|
| Boot | `app.js` never created the Express app; `ReferenceError` on require | Instantiate the app |
| Entrypoint | Root `npm start` ran `index.js`, which only re-exports, so nothing listened | Point at `server.js` |
| Webhook | Unset secret disabled authentication entirely | Fail closed with 503 |
| Finalization | Webhook and poller raced; last write won | Atomic claim on `status=processing` |
| LLM | Unguarded call with no timeout stranded documents in `processing` forever | Persist rules result first; LLM is best-effort |
| Supplier lookup | `new RegExp(supplierName)` from untrusted PDF input | Collation-based exact match |
| Credentials | `new RegExp('')` shredded every Evolus error message | Escape and skip when the key is empty |
| LLM config | Code read `VLLM_ENDPOINT`, docs declared `VLLM_BASE_URL`; LLM stuck in mock | Accept both |
| Export | Path resolved to `backend/backend/metrics/` | Corrected path |
| Seed | Fixture files were `//` comments; `npm run seed` always failed | Valid deterministic JSON |
| Seed (Docker) | Lowercase model paths broke in the Linux container | Correct casing |
| Fixtures | Four JSON files began with `//` and were unparseable | Comments removed; test guards the class |
| Metrics | Fabricated figures returned as measurements | `null` until an evaluation run exists |
| Metrics | `approved_by_human` dropped from live counts | Included |
| PII | Raw bank account and full Evolus payload returned by the API | Masked and stripped |
| Pagination | `cursor` accepted and ignored; `nextCursor` always `null` | Keyset pagination implemented |
| Docker | `curl` absent from alpine, so HEALTHCHECK always failed | `apk add --no-cache curl` |
| Docker | `COPY --from=builder /app .` shipped devDependencies | Copy `src`, `fixtures`, `seed` only |
| Compose | Set `EVOLUS_ENDPOINT` (unread); omitted six variables the code reads | Reconciled with the code |

## Known Gaps

These are real and not yet addressed. None blocks the demo.

1. **No authentication on the API.** All nine endpoints are open. The webhook
   is the only authenticated route. Deploy behind a gateway or add auth before
   exposing this beyond a demo.
2. **No end-to-end test against a live MongoDB in the unit suite.** The Docker
   CI job does cover this path: it starts MongoDB, boots the backend, waits for
   the container healthcheck, runs the seed script and asserts the seeded data
   is served. Adding `mongodb-memory-server` would bring it into `npm test`.
3. ~~No CI pipeline~~ **Done.** `.github/workflows/ci.yml` runs the suite and a
   boot check on every push and pull request, plus a Docker job covering the
   containerised path.
4. **Evolus endpoints are unverified.** All five paths in `ENDPOINTS` carry a
   `TODO: verify against Evolus API reference`. Mock mode is the only exercised
   path.
5. **Zero-cent money tolerance.** A 1¢ rounding difference between invoice and
   PO is a high-severity `TOTAL_MISMATCH` and rejects the document.
6. **No currency cross-check.** An invoice in EUR is compared against a USD
   purchase order without conversion.
7. **No PDF content verification.** `assertPdfMagic` is exported but not yet
   wired into the upload route.
8. **Evaluation metrics not generated.** Thirty synthetic PDFs and matching
   ground truth now exist, and `npm run eval:run` can submit them to a running
   backend. A live evaluation report is still outstanding; use a live
   extraction workflow because Evolus mock mode returns the same fixture for
   every upload.
9. **Frontend not implemented.** Owned by Moyeon; `CONTRACT.md` is the
   reference. `docker-compose.yml` still has the frontend service commented out.
10. **`Supplier.isApproved` is never consulted.** A supplier flagged
    `isApproved: false` is still treated as known.

## Removed

Deleted as dead code. All are recoverable from git history.

| Path | Reason |
|---|---|
| `src/routes/documents.js` | Orphaned duplicate of `documents.routes.js`; also required `uuid` (not a dependency) and `src/validation/` (did not exist), so it could not load |
| `src/services/ruleEngine.js` | Superseded second rule engine with conflicting severities and tolerances |
| `src/services/llmClient.js` | Empty stub; the real client is `src/clients/llmClient.js` |
| `src/services/redactionService.js` | Empty stub |
| `src/utils/ids.js` | Empty stub |
| `src/config/env.js` | Never imported by any module |
| `src/services/evolusClient.js` → `chatWithAgent` | Exported with zero callers; its presence implied an Evolus sub-agent integration that is not wired |
| `backend/scripts/run_batch.js` | Empty stub duplicating `scripts/run_batch.js` |

## Next Actions

1. Build the frontend against `CONTRACT.md`.
2. Generate a test corpus and run `npm run eval` to replace the placeholder
   metrics in `docs/submission.md`.
3. Verify the Evolus endpoint paths against the live API reference and remove
   the `TODO` markers.
4. Run one document end-to-end against a live AMD Developer Cloud vLLM endpoint.
5. Introduce a cents tolerance configurable via `MONEY_TOLERANCE_MINOR`.
6. Add authentication in front of the public endpoints.

## File Ledger

| Timestamp | Change |
|---|---|
| 2026-10-14 | Imported baseline; repository initialised with full history |
| 2026-10-14 | `app.js` boot fix, CORS/rate-limit ordering, error envelope |
| 2026-10-14 | Webhook auth fail-closed; upload validation and limits |
| 2026-10-14 | Pipeline atomic claim, LLM isolation, regex injection fix |
| 2026-10-14 | Evolus credential scrubbing, 429/408 retry, LLM endpoint unification |
| 2026-10-14 | Seed fixtures replaced; scenario replay tests added |
| 2026-10-14 | `CONTRACT.md`; pagination, PII masking, metrics truthfulness |
| 2026-10-14 | Dead code removed; this ledger rewritten |