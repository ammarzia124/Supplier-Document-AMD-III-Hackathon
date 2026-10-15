# Supplier Document Desk

**AI-powered invoice & delivery-note validation for small businesses.**

A Node.js service that extracts data from supplier PDFs, validates it
deterministically against purchase orders, flags errors, masks PII, and drafts
multilingual supplier replies — escalating uncertain cases to a human.

The design principle: **the code does the math.** A deterministic rules engine
performs 100% of the arithmetic, tolerance checks, PO cross-matching and
duplicate detection. The LLM is only ever asked to write prose, and its output
can never change a document's status.

---

## Quick start

```bash
npm install
npm test                 # 79 tests, no external services required

# With Docker (MongoDB + backend)
docker compose up -d mongodb
npm run seed             # loads suppliers and purchase orders
npm start                # http://localhost:3000
```

Without MongoDB the server still starts: `/api/health`, `/api/orders` and
`/api/metrics` respond, and document endpoints return an actionable `503`
rather than hanging.

```bash
curl http://localhost:3000/api/health
```

---

## Configuration

Copy `.env.example` to `.env`. Everything has a working default; `EVOLUS_MODE`
defaults to `mock`, so no credentials are needed for local development.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MONGODB_URI` | `mongodb://localhost:27017/supplier-docs` | Database |
| `EVOLUS_MODE` | `mock` | `mock` replays fixtures; `prod` calls the live API |
| `EVOLUS_BASE_URL` | `https://api.evolus.ai/api/v1` | Evolus API root |
| `EVOLUS_WEBHOOK_SECRET` | — | **Required in prod.** Webhook fails closed with 503 when unset |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Must be reachable by Evolus for callbacks |
| `VLLM_BASE_URL` | `http://localhost:8000/v1` | AMD vLLM endpoint; `/chat/completions` is appended |
| `VLLM_MODEL` | `meta-llama/Llama-2-70b-chat-hf` | Model served on ROCm |
| `CONFIDENCE_MIN` | `0.90` | Below this, a field forces human review |
| `AMOUNT_RISK_LIMIT` | `5000` | At or above this total, a document is held for review |

---

## How a document is processed

```
Upload → Evolus Document Extractor → normalise → RULES ENGINE
                                             ↓
                              deterministic status persisted
                                             ↓
                          LLM writes prose (best effort, cannot fail the doc)
                                             ↓
                            Evolus PII redaction → save
```

Completion arrives by webhook, with a 2-second polling fallback (180s max) if
the callback is blocked. Both paths contend for an atomic claim on the document,
so exactly one finalises it.

### Status outcomes

| Status | Cause |
|---|---|
| `auto_approved` | No issues, confidence ≥ threshold, known supplier, total under the risk limit |
| `needs_review` | Medium-severity issue, low field confidence, unknown supplier, or total ≥ `AMOUNT_RISK_LIMIT` |
| `rejected` | Any high-severity issue, a duplicate invoice number, or changed bank details |
| `approved_by_human` | A reviewer explicitly approved a flagged document |

---

## Project layout

```
backend/
  src/
    app.js              Express app and route registration
    server.js           Startup and MongoDB connection
    routes/             Six routers
    controllers/        Request orchestration only
    services/           Pipeline, Evolus adapter, metrics
    clients/llmClient   AMD vLLM OpenAI-compatible client
    rules/              Deterministic validation engine
    models/             Mongoose schemas
    middleware/         Upload, validation, CORS, rate limit, auth, DB guard
  seed/                 Deterministic demo data
  tests/                79 tests across 5 suites
  fixtures/             Mock Evolus responses
mocks/                  Frontend fixtures and an offline mock API
scripts/                Batch runner and evaluation harness
docs/                   Architecture, submission, team rules
CONTRACT.md             API contract for the frontend
SYSTEM_LEDGER.md        Current state, corrections, known gaps
```

---

## Documentation

| Document | Purpose |
|---|---|
| [`CONTRACT.md`](CONTRACT.md) | API reference for frontend integration — start here |
| [`docs/architecture.md`](docs/architecture.md) | Architecture with Mermaid sequence diagram |
| [`docs/submission.md`](docs/submission.md) | Hackathon submission, demo script, judge Q&A |
| [`SYSTEM_LEDGER.md`](SYSTEM_LEDGER.md) | Current state, corrections made, known gaps |
| [`docs/team_rules.md`](docs/team_rules.md) | Ownership and branching |

---

## Testing

```bash
npm test                  # everything
npm run test:coverage
npm run test:watch
```

Runs from the repo root or from `backend/`. No external services are required:
Evolus and vLLM are pinned to mock mode and the webhook secret is pinned by
`backend/tests/setupEnv.js`, so results do not depend on a local `.env`.

| Suite | Covers |
|---|---|
| `rules.test.js` | The seven validation rules and the decision gate |
| `scenarios.test.js` | All seven demo scenarios reach their documented status |
| `fixtures.test.js` | Every JSON file parses; schema matches the Mongoose model |
| `api.test.js` | Routes, error envelope, webhook auth, upload rejection |
| `exportController.test.js` | Batch-results export |

---

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Run the backend |
| `npm run dev` | Run with file watching |
| `npm run seed` | Load suppliers and purchase orders |
| `npm test` | Run the test suite |
| `npm run mock` | Offline mock API for frontend work |
| `npm run batch` | Upload a document corpus and record results |
| `npm run eval` | Compute accuracy metrics against ground truth |
| `npm run eval:run` | Upload the full PDF corpus to the live backend and compare results with ground truth |
| `npm run eval:test` | Run the offline tests for the M5 evaluation runner |
| `npm run check:evolus` | Verify Evolus credentials |
| `npm run check:vllm` | Verify the vLLM endpoint |

`npm run eval:run` requires the backend, MongoDB, and a live extraction workflow.
It uploads documents and writes to the backend database, so use it only when
those services are ready. Set `BACKEND_URL` if the backend is not at
`http://localhost:3000`. To save the full report, run
`npm run eval:run -- --output ai/eval/evaluation-report.json`.

---

## Known limitations

The API has **no authentication** — only the Evolus webhook is authenticated.
Do not expose it publicly without a gateway.

Evolus endpoint paths and the AMD vLLM integration are configured and
implemented but have only been exercised in mock mode; all five Evolus paths
carry a `TODO: verify against Evolus API reference`. Money comparisons use a
zero-cent tolerance and there is no currency cross-check.

See [`SYSTEM_LEDGER.md`](SYSTEM_LEDGER.md) for the full list.

---

## License

MIT