// backend/src/services/localExtractor.js
// Extracts structured invoice/delivery-note data from a real PDF using:
//   1. pdf-parse  — reads the raw text layer from the PDF file
//   2. llama3.2:1b via Ollama (OpenAI-compatible) — converts raw text to JSON
//
// The output shape is identical to what evolusClient mock mode returns so that
// the rest of the pipeline (rules engine, LLM reply, PII redaction) is
// completely unaware of the extraction path that was used.
//
// Design rule (inherited from AI_CONTEXT.md): the LLM only converts prose to
// structured data here. All numeric decisions (PO matching, tolerances, fraud
// checks) remain exclusively in the rules engine.

'use strict';

const fs = require('fs');
const axios = require('axios');
const logger = require('../utils/logger');

// ── Config ────────────────────────────────────────────────────────────────────

const OLLAMA_BASE  = (process.env.VLLM_BASE_URL || 'http://localhost:11434/v1')
  .replace(/\/+$/, '');
const OLLAMA_MODEL  = process.env.VLLM_MODEL || 'llama3.2:1b';
const TIMEOUT_MS    = Number(process.env.VLLM_TIMEOUT_MS || 60000);
const ENDPOINT      = OLLAMA_BASE.endsWith('/chat/completions')
  ? OLLAMA_BASE
  : `${OLLAMA_BASE}/chat/completions`;

// ── PDF text extraction ───────────────────────────────────────────────────────

/**
 * Reads the text layer from a PDF buffer using pdf-parse.
 * Returns an empty string (rather than throwing) when the library is absent or
 * the PDF has no text layer, so the caller can surface a friendly error.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>}
 */
async function extractPdfText(pdfBuffer) {
  try {
    // pdf-parse exports the parse function as module.exports directly.
    // require() returns the callable function itself, not an object.
    const pdfParse = require('pdf-parse');
    const parseFn  = typeof pdfParse === 'function' ? pdfParse
      : (pdfParse.default || pdfParse); // fallback for any ESM wrapper
    const result   = await parseFn(pdfBuffer);
    return (result.text || '').trim();
  } catch (err) {
    logger.warn({ err: err.message }, 'pdf-parse failed to read PDF text layer');
    return '';
  }
}

// ── LLM extraction prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a precise data extraction assistant for a purchasing department.
You receive raw text from an invoice or delivery note and return ONLY a valid JSON object.
Never add commentary, markdown, code fences, or any text outside the JSON.
Never perform arithmetic. Never invent data that is not in the text.
If a field is absent, set its value to null.`;

/**
 * Builds the user-turn message from the raw PDF text.
 * @param {string} rawText
 * @returns {string}
 */
function buildExtractionPrompt(rawText) {
  const trimmed = rawText.slice(0, 3000);
  return `Extract the following fields from the invoice/delivery-note text below and return them as a single JSON object.

Required JSON keys:
- "invoiceNumber"  : string  (invoice / document reference number)
- "poNumber"       : string  (purchase order number referenced in the document)
- "supplierName"   : string  (name of the issuing company / supplier)
- "date"           : string  (invoice date, any format present in the document)
- "currency"       : string  (3-letter ISO code, e.g. "USD", "EUR"; default "USD" if absent)
- "lines"          : array of objects, each with:
    "description"  : string
    "qty"          : number
    "unitPrice"    : number
    "lineTotal"    : number
- "subtotal"       : number  (sum of line totals before tax)
- "tax"            : number  (tax / VAT amount)
- "total"          : number  (grand total)
- "bankAccount"    : string  (IBAN, account number, or routing reference; null if absent)

Return ONLY the JSON object. No extra text.

--- DOCUMENT TEXT START ---
${trimmed}
--- DOCUMENT TEXT END ---`;
}

// ── JSON parser with fence-stripping ─────────────────────────────────────────

/**
 * Strips markdown code fences and parses JSON produced by the model.
 * Returns null on failure.
 * @param {string} raw
 * @returns {object|null}
 */
function parseModelJson(raw) {
  const stripped = String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ── Confidence scoring ────────────────────────────────────────────────────────

/**
 * Assigns a naive confidence score per extracted field.
 * 1.0 = field present; 0.70 = field absent (model could not find it).
 *
 * @param {object} extracted
 * @returns {object} confidence map
 */
function scoreConfidence(extracted) {
  const fields = [
    'invoiceNumber', 'poNumber', 'supplierName', 'date',
    'currency', 'subtotal', 'tax', 'total', 'bankAccount'
  ];
  const conf = {};
  for (const f of fields) {
    conf[f] = (extracted[f] != null) ? 1.0 : 0.70;
  }
  const lines = Array.isArray(extracted.lines) ? extracted.lines : [];
  const hasCompleteLines = lines.some(
    l => l.qty != null && l.unitPrice != null && l.lineTotal != null
  );
  conf.lines = hasCompleteLines ? 1.0 : 0.70;
  return conf;
}

// ── Normalise extracted payload ───────────────────────────────────────────────

/**
 * Coerces the model's raw JSON into the exact shape the pipeline expects.
 * @param {object} raw
 * @returns {object}
 */
function normalise(raw) {
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(l => ({
    description: l.description   ?? null,
    qty:         typeof l.qty        === 'number' ? l.qty        : null,
    unitPrice:   typeof l.unitPrice  === 'number' ? l.unitPrice  : null,
    lineTotal:   typeof l.lineTotal  === 'number' ? l.lineTotal  : null,
  }));

  return {
    invoiceNumber:  raw.invoiceNumber  ?? null,
    date:           raw.date           ?? null,
    currency:       raw.currency       ?? 'USD',
    poNumber:       raw.poNumber       ?? null,
    lines,
    subtotal:       typeof raw.subtotal === 'number' ? raw.subtotal : null,
    tax:            typeof raw.tax      === 'number' ? raw.tax      : null,
    total:          typeof raw.total    === 'number' ? raw.total    : null,
    bankAccount:    raw.bankAccount    ?? null,
  };
}

// ── Main extraction function ──────────────────────────────────────────────────

/**
 * Extracts structured invoice data from a PDF file using the local LLM.
 *
 * @param {object}  params
 * @param {string}  params.filePath     - Absolute path to the uploaded PDF.
 * @param {string}  [params.fileName]   - Original filename (for logging).
 * @param {string}  [params.language]   - Document language hint (ISO code).
 * @returns {Promise<object>}
 */
async function extractFromPdf({ filePath, fileName, language = 'en' }) {
  const wallStart = Date.now();

  // 1. Read PDF bytes and extract text layer
  const pdfBuffer = fs.readFileSync(filePath);
  const rawText   = await extractPdfText(pdfBuffer);

  if (!rawText) {
    logger.warn({ fileName }, 'No text layer found in PDF; LLM will receive empty input');
  }

  logger.info(
    { fileName, chars: rawText.length, model: OLLAMA_MODEL },
    'Sending PDF text to local LLM for extraction'
  );

  // 2. Call llama3.2:1b via Ollama OpenAI-compatible endpoint
  const payload = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildExtractionPrompt(rawText) }
    ],
    temperature: 0.0,
    max_tokens:  1200,
    stream:      false,
  };

  const apiKey  = process.env.VLLM_API_KEY;
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  let response;
  const modelStart = Date.now();
  try {
    response = await axios.post(ENDPOINT, payload, { headers, timeout: TIMEOUT_MS });
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    logger.error({ fileName, err: msg }, 'Local LLM call failed during extraction');
    throw new Error(`Local LLM extraction failed: ${msg}`);
  }
  const modelMs = Date.now() - modelStart;

  // 3. Parse response
  const data            = response.data || {};
  const rawContent      = data?.choices?.[0]?.message?.content ?? '';
  const totalTokens     = data.usage?.total_tokens ?? null;
  const tokensPerSecond = (totalTokens && modelMs > 0)
    ? Math.round((totalTokens / modelMs) * 1000)
    : null;

  logger.info(
    { fileName, modelMs, totalTokens, tokensPerSecond },
    'Local LLM extraction response received'
  );

  // 4. Parse JSON from model output
  const parsedJson = parseModelJson(rawContent);
  if (!parsedJson) {
    logger.warn({ fileName, rawContent }, 'LLM returned non-JSON output; using empty extraction');
  }

  const raw        = parsedJson || {};
  const extracted  = normalise(raw);
  const confidence = scoreConfidence(extracted);
  const totalMs    = Date.now() - wallStart;

  return {
    supplierName:    raw.supplierName ?? null,
    language,
    type:            'invoice',
    extracted,
    confidence,
    timing:          { modelMs, totalMs },
    localModel:      OLLAMA_MODEL,
    tokensPerSecond,
    totalTokens,
  };
}

module.exports = { extractFromPdf, extractPdfText, parseModelJson, normalise, scoreConfidence };
