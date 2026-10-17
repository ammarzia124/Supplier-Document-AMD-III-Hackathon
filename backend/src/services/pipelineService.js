// backend/src/services/pipelineService.js
// Orchestrates document processing pipeline with webhook and polling fallback. Owned by Ammar

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Document = require('../models/Document');
const PurchaseOrder = require('../models/PurchaseOrder');
const Supplier = require('../models/Supplier');
const { runAllRules } = require('../rules');
const { executeWorkflow, getExecution, runAiTool } = require('./evolusClient');
const logger = require('../utils/logger');
const { generate } = require('../clients/llmClient');
const { extractFromPdf } = require('./localExtractor');

// When EXTRACTION_MODE=local, bypass Evolus and use the local LLM extractor.
const EXTRACTION_MODE = (process.env.EXTRACTION_MODE || 'mock').toLowerCase();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

// 90 attempts x 2s = 180s of real elapsed time.
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 90;

/**
 * Reads a numeric env threshold, falling back when unset or unparseable.
 * A malformed value must never silently disable a control, so NaN is rejected.
 */
function readThreshold(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Builds a collision-proof temp path from a random token rather than from the
 * client-supplied filename, so a name containing separators or ".." cannot
 * escape the OS temp directory.
 */
function makeTempFilePath(documentId, fileBuffer) {
  const token = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `upload-${documentId}-${token}.pdf`);
}

/**
 * Starts processing for a newly uploaded document.
 * @param {object} document - Document mongoose record or plain object
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {object} options
 */
async function start(document, fileBuffer, fileName, options = {}) {
  const startTime = Date.now();
  const documentId = document.id;

  let tempFilePath = null;
  try {
    tempFilePath = makeTempFilePath(documentId, fileBuffer);
    fs.writeFileSync(tempFilePath, fileBuffer);

    // ── LOCAL extraction path ──────────────────────────────────────────────
    // When EXTRACTION_MODE=local, extract directly from the PDF using the
    // local LLM (llama3.2:1b via Ollama) instead of the Evolus cloud workflow.
    if (EXTRACTION_MODE === 'local') {
      logger.info({ documentId, fileName }, 'Local extraction mode: using pdf-parse + local LLM');

      await Document.findOneAndUpdate(
        { id: documentId },
        { status: 'processing' }
      );

      // Run extraction asynchronously so the HTTP response returns immediately.
      setImmediate(async () => {
        try {
          const normalized = await extractFromPdf({
            filePath: tempFilePath,
            fileName,
            language: options.language || 'en',
          });
          await finalizeFromEvolus(documentId, normalized);
        } catch (err) {
          logger.error({ documentId, err: err.message }, 'Local extraction failed');
          await Document.findOneAndUpdate(
            { id: documentId },
            {
              status: 'needs_review',
              ruleExplanation: 'Local extraction could not complete.',
              explanation: `Extraction error: ${err.message}`,
              issues: [{
                type: 'LOW_CONFIDENCE',
                severity: 'low',
                field: 'extraction',
                message: `Local PDF extraction failed: ${err.message}`
              }],
              timing: { totalMs: Date.now() - startTime, modelMs: 0 }
            }
          );
        } finally {
          if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (_) {}
          }
        }
      });

      return { status: 'processing' };
    }

    // ── Evolus / mock path (unchanged) ────────────────────────────────────
    const callbackUrl = `${PUBLIC_BASE_URL}/api/webhooks/evolus?docId=${encodeURIComponent(documentId)}`;

    logger.info({ documentId, callbackUrl }, 'Starting Evolus workflow execution');
    const execResponse = await executeWorkflow({
      filePath: tempFilePath,
      fileName,
      documentId,
      language: options.language || 'en',
      callbackUrl
    });

    const executionId = execResponse.executionId;

    await Document.findOneAndUpdate(
      { id: documentId },
      { executionId, status: 'processing' }
    );

    // Fallback: poll execution in background in case webhook is blocked or in local dev
    pollExecutionFallback(documentId, executionId, startTime, options).catch(err => {
      logger.error({ documentId, err: err.message }, 'Polling fallback encountered an error');
    });

    return { executionId, status: 'processing' };
  } catch (error) {
    logger.error({ documentId, err: error.message }, 'Workflow execution initiation failed');

    // Never crash: set status to needs_review with a LOW_CONFIDENCE issue
    await Document.findOneAndUpdate(
      { id: documentId },
      {
        status: 'needs_review',
        ruleExplanation: 'The Evolus workflow could not be started.',
        explanation: `Processing error: ${error.message}`,
        issues: [
          {
            type: 'LOW_CONFIDENCE',
            severity: 'low',
            field: 'workflow',
            message: `Workflow could not be started: ${error.message}`
          }
        ],
        timing: { totalMs: Date.now() - startTime, modelMs: 0 }
      }
    );

    return { error: error.message };
  } finally {
    // Only clean up in the Evolus path; local path cleans up in setImmediate.
    if (EXTRACTION_MODE !== 'local' && tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (_) {}
    }
  }
}

/**
 * Polls getExecution every 2 seconds for up to 180 seconds (90 attempts).
 */
async function pollExecutionFallback(documentId, executionId, startTime, options = {}) {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    // Check before sleeping so a fast workflow is not delayed by a full interval.
    // If the webhook already finalized the document, there is nothing to do.
    const currentDoc = await Document.findOne({ id: documentId }).lean();
    if (!currentDoc || currentDoc.status !== 'processing') {
      logger.info({ documentId }, 'Document already finalized. Exiting poll loop.');
      return;
    }

    try {
      const execution = await getExecution(executionId);
      const status = (execution.status || '').toUpperCase();

      if (status === 'COMPLETED' || status === 'SUCCESS') {
        logger.info({ documentId, attempt }, 'Poll detected workflow completion');

        const { normalizeEvolusResult } = require('../routes/webhooks.routes');
        const normalized = normalizeEvolusResult(execution);

        await finalizeFromEvolus(documentId, normalized);
        return;
      }

      if (status === 'FAILED' || status === 'ERROR') {
        // A terminal failure is final. Mark the document and stop rather than
        // retrying a dead workflow for the remaining ~3 minutes.
        const reason = execution.error?.message || 'Evolus execution failed';
        logger.error({ documentId, reason }, 'Evolus execution failed');
        await markNeedsReview(
          documentId,
          startTime,
          'execution',
          `Workflow execution failed: ${reason}`,
          'The Evolus workflow reported a terminal failure.'
        );
        return;
      }
    } catch (pollErr) {
      // Transient transport errors are tolerated, but log them: the previous
      // code swallowed them silently for up to 89 iterations.
      logger.warn({ documentId, attempt, err: pollErr.message }, 'Poll attempt failed, retrying');

      if (attempt === POLL_MAX_ATTEMPTS) {
        logger.error({ documentId, err: pollErr.message }, 'Polling gave up after max attempts');
      }
    }

    if (attempt < POLL_MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  // Timeout reached
  logger.warn({ documentId }, 'Workflow polling timed out');
  await markNeedsReview(
    documentId,
    startTime,
    'execution',
    `Workflow processing timed out after ${Math.round((POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000)} seconds`,
    'Workflow timed out waiting for extraction result.'
  );
}

/**
 * Moves a still-processing document to needs_review with a single issue.
 */
async function markNeedsReview(documentId, startTime, field, message, ruleExplanation) {
  await Document.findOneAndUpdate(
    { id: documentId, status: 'processing' },
    {
      status: 'needs_review',
      ruleExplanation,
      explanation: ruleExplanation,
      issues: [
        {
          type: 'LOW_CONFIDENCE',
          severity: 'low',
          field,
          message
        }
      ],
      timing: { totalMs: Date.now() - startTime, modelMs: 0 }
    }
  );
}

/**
 * Looks a supplier up by exact name, case-insensitively.
 *
 * Uses a collation rather than a regex: supplierName originates from an
 * untrusted PDF, and interpolating it into a RegExp both allowed pattern
 * injection (a name like "(Global) Ltd" threw SyntaxError and stranded the
 * document) and false positives ("A.C" matching "ABC").
 */
function findSupplierByName(supplierName) {
  return Supplier.findOne({ name: supplierName })
    .collation({ locale: 'en', strength: 2 })
    .lean();
}

/**
 * Finalizes document processing using normalized extraction results and rules engine.
 *
 * Guarded by an atomic claim so the webhook and the polling fallback cannot
 * both finalize the same document. Without it both paths read the document,
 * call the LLM concurrently, and the later save silently overwrites the other.
 *
 * @param {string} documentId
 * @param {object} normalized
 * @returns {Promise<object|null>} the finalized document, or null if not claimed
 */
async function finalizeFromEvolus(documentId, normalized) {
  const startTime = Date.now();

  // Atomic claim: only one caller can move out of processing.
  const doc = await Document.findOneAndUpdate(
    { id: documentId, status: 'processing', finalizing: { $ne: true } },
    { $set: { finalizing: true } },
    { new: true }
  );

  if (!doc) {
    logger.info({ documentId }, 'Document not claimable for finalization (already done or in progress)');
    return null;
  }

  try {
    const extracted = normalized.extracted || {};
    const confidence = normalized.confidence || {};
    const supplierName = normalized.supplierName || doc.supplierName || 'Unknown';
    const language = normalized.language || doc.language || 'en';

    // 1. Context queries from Database
    const [supplier, purchaseOrder, duplicateDoc] = await Promise.all([
      findSupplierByName(supplierName),
      extracted.poNumber ? PurchaseOrder.findOne({ poNumber: extracted.poNumber }).lean() : null,
      extracted.invoiceNumber ? Document.findOne({
        id: { $ne: documentId },
        'extracted.invoiceNumber': extracted.invoiceNumber
      }).lean() : null
    ]);

    // 2. Rules engine evaluation (CODE does all math and policy decisions)
    const confidenceMin = readThreshold('CONFIDENCE_MIN', 0.90);
    const amountRiskLimit = readThreshold('AMOUNT_RISK_LIMIT', 5000);

    const ruleResult = runAllRules({
      extracted,
      confidence,
      supplierName,
      supplier,
      purchaseOrder,
      isDuplicate: Boolean(duplicateDoc),
      confidenceMin,
      amountRiskLimit
    });

    // 3. PII Redaction.
    // In local mode: mask the bank account field directly in memory.
    //   No external call is made, no mock URL is stored, and no fake
    //   storage.mock.local link appears in the UI.
    // In Evolus/mock mode: delegate to the Evolus AI tool as before.
    let redactedFileUrl = null;
    let redactionError = null;

    if (EXTRACTION_MODE === 'local') {
      // Mask bank account: keep first 4 and last 4 chars, replace middle with ****
      if (extracted.bankAccount) {
        const raw = String(extracted.bankAccount);
        const visible = Math.min(4, Math.floor(raw.length / 3));
        extracted.bankAccount =
          raw.slice(0, visible) + '****' + raw.slice(-visible);
      }
      logger.info({ documentId }, 'Local PII masking applied to bankAccount field');
    } else {
      try {
        const redactionRes = await runAiTool('pii-redaction', {
          documentId,
          supplierName,
          bankAccount: extracted.bankAccount
        });
        redactedFileUrl = redactionRes.redactedFileUrl || null;
      } catch (err) {
        redactionError = err.message;
        logger.warn({ documentId, err: err.message }, 'PII redaction tool execution failed');
      }
    }

    // 4. Persist the deterministic outcome BEFORE calling the LLM.
    //
    // The LLM only writes natural language, but it is a remote dependency that
    // can time out or return malformed JSON. Recording status first means a
    // model failure can never leave a document stuck in "processing" forever,
    // and the audit-grade rule explanation is preserved either way.
    const deterministicExplanation = ruleResult.explanation;

    doc.status = ruleResult.status;
    doc.supplierName = supplierName;
    doc.language = language;
    doc.extracted = extracted;
    doc.confidence = confidence;
    doc.issues = ruleResult.issues;
    doc.ruleExplanation = deterministicExplanation;
    doc.explanation = deterministicExplanation;
    doc.supplierReplyDraft = null;
    doc.redactedFileUrl = redactedFileUrl;
    doc.redactionError = redactionError;
    doc.timing = {
      totalMs: normalized.timing?.totalMs ?? (Date.now() - startTime),
      modelMs: normalized.timing?.modelMs ?? 0
    };
    doc.costEstimate = null;
    // Store local model telemetry for frontend display (AMD Hackathon requirement)
    if (normalized.localModel) {
      doc.localModel       = normalized.localModel;
      doc.tokensPerSecond  = normalized.tokensPerSecond ?? null;
      doc.totalTokens      = normalized.totalTokens ?? null;
    }

    await doc.save();
    logger.info({ documentId, status: doc.status }, 'Document finalized by rules engine');

    // 5. LLM pass: explanation and supplier reply. Best-effort enrichment; the
    //    document is already in its final, auditable state.
    if (ruleResult.issues.length > 0) {
      try {
        const llmResult = await generate({
          language,
          supplierName,
          issues: ruleResult.issues,
          extracted
        });

        await Document.findOneAndUpdate(
          { id: documentId },
          {
            supplierReplyDraft: llmResult.reply || null,
            // Only adopt the model's prose when it actually produced something,
            // so an empty completion cannot erase the rule explanation.
            explanation: llmResult.explanation || deterministicExplanation,
            'timing.modelMs': llmResult.modelMs ?? doc.timing.modelMs,
            costEstimate: llmResult.costEstimate ?? null,
            // Update tokens/sec from the reply-generation call if not already set
            ...(llmResult.tokensPerSecond != null && !doc.tokensPerSecond
              ? { tokensPerSecond: llmResult.tokensPerSecond, totalTokens: llmResult.totalTokens }
              : {})
          }
        );
      } catch (llmErr) {
        logger.error({ documentId, err: llmErr.message }, 'LLM enrichment failed; keeping rule explanation');
      }
    }

    return doc;
  } catch (err) {
    // Release the claim so a later attempt (or the poller's timeout path) can
    // still move the document out of processing.
    logger.error({ documentId, err: err.message }, 'Finalization failed');
    await Document.findOneAndUpdate(
      { id: documentId },
      { $set: { finalizing: false } }
    ).catch(() => {});
    throw err;
  }
}

module.exports = {
  start,
  finalizeFromEvolus,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS
};