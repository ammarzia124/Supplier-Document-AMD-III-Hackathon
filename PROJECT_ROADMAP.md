# PROJECT_ROADMAP.md

<!-- Owned by Ammar -->

## Phase Overview

| Phase | Status |
|-------|--------|
| Repository Skeleton & AI_CONTEXT | ✅ Complete |
| Document Extraction Service | ✅ Complete (mock mode exercised) |
| Evolus Workflow Integration | ✅ Adapter complete; live endpoints unverified |
| Supplier Reply Generation | ✅ Complete |
| Frontend (Moyeon) | 🔴 Not started — see `CONTRACT.md` |
| Evaluation & Metrics | 🔴 Blocked on the ground-truth corpus |
| Deployment & Demo Preparation | 🟡 In progress |

## Current Active Phase

- Frontend build against `CONTRACT.md`.
- Expand the current 8-document evaluation corpus to 30 documents and run
  `npm run eval:run` against the live backend to replace the placeholder
  figures in `docs/submission.md`.
- Verify the five Evolus endpoint paths against the live API reference and clear
  the `TODO` markers in `src/services/evolusClient.js`.
- Run one document end-to-end against a live AMD Developer Cloud vLLM endpoint.

## Milestones

1. Repository skeleton & governance docs ✅
2. Document extraction prototype (mock) ✅
3. Rule engine core logic ✅
4. Evolus workflow connection ✅ (adapter; endpoints unverified)
5. Backend stabilisation: boot, correctness, security, contract ✅
6. **Full end-to-end demo ready before 17 Oct 2026** 🔴 *at risk — frontend not started*

## Key Success Metrics

- **Accuracy:** >95% field extraction confidence. *Not yet measured.*
- **Performance:** <2 s latency per document (GPU‑accelerated). *Mock mode runs ~2 s end to end; the AMD path is unmeasured.*
- **Business Value:** Reduce manual invoice review time by ≥80%. *Not yet measured.*
- **Originality:** Custom rule engine + Evolus workflow orchestration. ✅

## Competitive Advantages

- The rules engine owns every numeric and policy decision, and its verdict is persisted **before** the LLM is called, so the model cannot influence an outcome even by failing.
- Evolus orchestrates extraction and redaction; the open model on AMD writes only human-readable prose.
- Open‑source, MIT‑licensed, easy to self‑host on AMD GPU.
- Deterministic behaviour: seeded reference data and pinned mock services make the seven demo scenarios reproducible and regression‑tested.
