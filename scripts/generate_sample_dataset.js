// scripts/generate_sample_dataset.js
// Generates authentic corporate PDF invoices in data/documents/ and ground truth in data/ground_truth.json
// Owned by Muawia (AI / Benchmark Lead)

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DOCS_DIR = path.join(DATA_DIR, 'documents');
const TRUTH_FILE = path.join(DATA_DIR, 'ground_truth.json');
const LABELS = {
  en: {
    invoice: 'COMMERCIAL INVOICE',
    supplier: 'SUPPLIER DETAILS:',
    customer: 'BILLED TO (CUSTOMER):',
    invoiceNumber: 'INVOICE #',
    date: 'INVOICE DATE',
    purchaseOrder: 'PURCHASE ORDER',
    terms: 'PAYMENT TERMS',
    currency: 'CURRENCY',
    description: 'ITEM DESCRIPTION',
    quantity: 'QTY',
    unitPrice: 'UNIT PRICE',
    lineTotal: 'LINE TOTAL',
    subtotal: 'Subtotal (Net):',
    tax: 'Tax / VAT (10%):',
    total: 'TOTAL DUE:',
    remittance: 'PAYMENT REMITTANCE INSTRUCTIONS',
    bank: 'Bank Name:',
    account: 'Account No:',
    swift: 'SWIFT / BIC:'
  },
  it: {
    invoice: 'FATTURA COMMERCIALE',
    supplier: 'DATI FORNITORE:',
    customer: 'FATTURATO A:',
    invoiceNumber: 'NUMERO FATTURA',
    date: 'DATA FATTURA',
    purchaseOrder: 'ORDINE DI ACQUISTO',
    terms: 'PAGAMENTO',
    currency: 'VALUTA',
    description: 'DESCRIZIONE ARTICOLO',
    quantity: 'QUANTITA',
    unitPrice: 'PREZZO UNITARIO',
    lineTotal: 'TOTALE RIGA',
    subtotal: 'Imponibile:',
    tax: 'Imposta:',
    total: 'TOTALE:',
    remittance: 'ISTRUZIONI DI PAGAMENTO',
    bank: 'Banca:',
    account: 'Conto:',
    swift: 'BIC / SWIFT:'
  }
};

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

/**
 * Escapes characters for PDF literal string syntax.
 */
function escapePdfText(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a valid standard PDF 1.4 document buffer with professional corporate styling.
 */
function createInvoicePdf({
  invoiceNumber,
  date,
  dueDate,
  poNumber,
  supplierName,
  supplierAddress,
  supplierEmail,
  supplierTaxId,
  customerName,
  customerAddress,
  currency,
  lines,
  subtotal,
  tax,
  total,
  bankAccount,
  bankName,
  swift,
  watermark,
  language = 'en'
}) {
  const labels = LABELS[language] || LABELS.en;
  const streamLines = [];

  // Helper functions for PDF graphics
  const fillRect = (x, y, w, h, r, g, b) => {
    streamLines.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
    streamLines.push(`${x} ${y} ${w} ${h} re f`);
  };

  const strokeRect = (x, y, w, h, r, g, b, lineWidth = 1) => {
    streamLines.push(`${lineWidth} w`);
    streamLines.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
    streamLines.push(`${x} ${y} ${w} ${h} re S`);
  };

  const drawLine = (x1, y1, x2, y2, r, g, b, lineWidth = 1) => {
    streamLines.push(`${lineWidth} w`);
    streamLines.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
    streamLines.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };

  const writeText = (text, x, y, size = 10, isBold = false, r = 0.1, g = 0.1, b = 0.1) => {
    const font = isBold ? '/F2' : '/F1';
    streamLines.push('BT');
    streamLines.push(`${font} ${size} Tf`);
    streamLines.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
    streamLines.push(`${x} ${y} Td`);
    streamLines.push(`(${escapePdfText(text)}) Tj`);
    streamLines.push('ET');
  };

  // 1. Header Banner (AMD Corporate Dark Slate / Crimson Accent)
  fillRect(40, 720, 532, 45, 0.08, 0.12, 0.20);
  fillRect(40, 716, 532, 4, 0.70, 0.05, 0.10); // AMD Red Accent Bar

  writeText(supplierName.toUpperCase(), 55, 737, 16, true, 1.0, 1.0, 1.0);
  writeText(labels.invoice, 410, 737, 13, true, 0.9, 0.9, 0.9);

  // 2. Supplier & Customer Details Columns
  let y = 690;
  writeText(labels.supplier, 50, y, 9, true, 0.4, 0.4, 0.4);
  writeText(labels.customer, 320, y, 9, true, 0.4, 0.4, 0.4);

  y -= 14;
  writeText(supplierName, 50, y, 10, true, 0.1, 0.1, 0.1);
  writeText(customerName, 320, y, 10, true, 0.1, 0.1, 0.1);

  y -= 12;
  writeText(supplierAddress, 50, y, 9, false, 0.3, 0.3, 0.3);
  writeText(customerAddress, 320, y, 9, false, 0.3, 0.3, 0.3);

  y -= 12;
  writeText(`Email: ${supplierEmail}`, 50, y, 8, false, 0.3, 0.3, 0.3);
  writeText('Attn: Accounts Payable Department', 320, y, 8, false, 0.3, 0.3, 0.3);

  y -= 12;
  writeText(`Tax / VAT ID: ${supplierTaxId}`, 50, y, 8, false, 0.3, 0.3, 0.3);

  // 3. Invoice Metadata Card
  y -= 25;
  fillRect(40, y - 28, 532, 32, 0.96, 0.97, 0.98);
  strokeRect(40, y - 28, 532, 32, 0.85, 0.87, 0.90, 1);

  writeText(labels.invoiceNumber, 55, y - 10, 8, true, 0.4, 0.4, 0.4);
  writeText(invoiceNumber, 55, y - 22, 10, true, 0.1, 0.1, 0.1);

  writeText(labels.date, 170, y - 10, 8, true, 0.4, 0.4, 0.4);
  writeText(date, 170, y - 22, 9, false, 0.1, 0.1, 0.1);

  writeText(labels.purchaseOrder, 290, y - 10, 8, true, 0.4, 0.4, 0.4);
  writeText(poNumber, 290, y - 22, 10, true, 0.7, 0.05, 0.1);

  writeText(labels.terms, 410, y - 10, 8, true, 0.4, 0.4, 0.4);
  writeText(`Net 30 (Due: ${dueDate})`, 410, y - 22, 8, false, 0.1, 0.1, 0.1);

  writeText(labels.currency, 510, y - 10, 8, true, 0.4, 0.4, 0.4);
  writeText(currency, 510, y - 22, 9, true, 0.1, 0.1, 0.1);

  // 4. Line Items Table Header
  y -= 50;
  fillRect(40, y - 16, 532, 20, 0.15, 0.20, 0.28);
  writeText(labels.description, 50, y - 12, 8, true, 1.0, 1.0, 1.0);
  writeText(labels.quantity, 340, y - 12, 8, true, 1.0, 1.0, 1.0);
  writeText(labels.unitPrice, 400, y - 12, 8, true, 1.0, 1.0, 1.0);
  writeText(labels.lineTotal, 490, y - 12, 8, true, 1.0, 1.0, 1.0);

  // 5. Line Items Rows
  y -= 20;
  lines.forEach((line, index) => {
    const isEven = index % 2 === 0;
    if (isEven) {
      fillRect(40, y - 14, 532, 18, 0.98, 0.98, 0.99);
    }
    drawLine(40, y - 14, 572, y - 14, 0.90, 0.90, 0.92, 0.5);

    writeText(line.description, 50, y - 10, 9, false, 0.1, 0.1, 0.1);
    writeText(String(line.qty), 345, y - 10, 9, false, 0.1, 0.1, 0.1);
    writeText(`${currency} ${Number(line.unitPrice).toFixed(2)}`, 400, y - 10, 9, false, 0.1, 0.1, 0.1);
    writeText(`${currency} ${Number(line.lineTotal).toFixed(2)}`, 490, y - 10, 9, true, 0.1, 0.1, 0.1);

    y -= 18;
  });

  // Table bottom border
  drawLine(40, y, 572, y, 0.6, 0.6, 0.6, 1);

  // 6. Summary Totals Box (Right aligned)
  y -= 20;
  const totalsBoxX = 350;
  fillRect(totalsBoxX, y - 65, 222, 65, 0.96, 0.97, 0.98);
  strokeRect(totalsBoxX, y - 65, 222, 65, 0.82, 0.85, 0.88, 1);

  writeText(labels.subtotal, totalsBoxX + 15, y - 16, 9, false, 0.3, 0.3, 0.3);
  writeText(`${currency} ${Number(subtotal).toFixed(2)}`, totalsBoxX + 130, y - 16, 9, false, 0.1, 0.1, 0.1);

  writeText(labels.tax, totalsBoxX + 15, y - 32, 9, false, 0.3, 0.3, 0.3);
  writeText(`${currency} ${Number(tax).toFixed(2)}`, totalsBoxX + 130, y - 32, 9, false, 0.1, 0.1, 0.1);

  drawLine(totalsBoxX + 10, y - 40, totalsBoxX + 212, y - 40, 0.8, 0.8, 0.8, 1);

  fillRect(totalsBoxX, y - 65, 222, 24, 0.08, 0.12, 0.20);
  writeText(labels.total, totalsBoxX + 15, y - 57, 10, true, 1.0, 1.0, 1.0);
  writeText(`${currency} ${Number(total).toFixed(2)}`, totalsBoxX + 130, y - 57, 11, true, 1.0, 1.0, 1.0);

  // 7. Payment Information & Bank Remittance Box (Left aligned)
  const bankBoxY = y - 65;
  fillRect(40, bankBoxY, 280, 65, 0.95, 0.97, 0.95);
  strokeRect(40, bankBoxY, 280, 65, 0.75, 0.85, 0.75, 1);

  writeText(labels.remittance, 50, bankBoxY + 50, 8, true, 0.1, 0.4, 0.1);
  writeText(`${labels.bank}   ${bankName}`, 50, bankBoxY + 36, 8, false, 0.2, 0.2, 0.2);
  writeText(`${labels.account}  ${bankAccount}`, 50, bankBoxY + 24, 9, true, 0.1, 0.1, 0.1);
  writeText(`${labels.swift} ${swift}`, 50, bankBoxY + 12, 8, false, 0.2, 0.2, 0.2);

  // 8. Watermark if flagged (e.g. LOW CONFIDENCE)
  if (watermark) {
    writeText(watermark, 140, 420, 26, true, 0.85, 0.85, 0.85);
  }

  // 9. Footer
  drawLine(40, 50, 572, 50, 0.8, 0.8, 0.8, 0.5);
  writeText('Supplier Document Desk | AMD Hackathon Act III Verification Corpus', 40, 38, 7, false, 0.5, 0.5, 0.5);
  writeText('Verified Deterministic Rule Engine & vLLM Language Layer', 350, 38, 7, false, 0.5, 0.5, 0.5);

  const contentStream = streamLines.join('\n');
  const streamLength = Buffer.byteLength(contentStream, 'utf8');

  // Build standard PDF 1.4 object table
  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj');
  objects.push(`4 0 obj\n<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream\nendobj`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');

  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += objects[i] + '\n';
  }

  const startxref = Buffer.byteLength(body, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'utf8');
}

// ==========================================
// SCENARIOS SPECIFICATION
// ==========================================
const scenarios = [
  {
    fileName: 'invoice-clean-001.pdf',
    supplierName: 'Alpha Supplies',
    supplierAddress: '100 Industrial Parkway, Austin, TX 78701',
    supplierEmail: 'billing@alphasupplies.example',
    supplierTaxId: 'US-TAX-889921',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-1001',
    date: '2026-09-30',
    dueDate: '2026-10-30',
    poNumber: 'PO-2001',
    currency: 'USD',
    lines: [
      { description: 'Industrial Screwdriver Set', qty: 20, unitPrice: 5.00, lineTotal: 100.00 },
      { description: 'Heavy Forged Steel Hammer', qty: 10, unitPrice: 12.00, lineTotal: 120.00 }
    ],
    subtotal: 220.00,
    tax: 22.00,
    total: 242.00,
    bankAccount: '111222333',
    bankName: 'Texas Commerce Bank',
    swift: 'TXCBUS33',
    watermark: null,
    expectedStatus: 'auto_approved',
    issues: []
  },
  {
    fileName: 'invoice-clean-002.pdf',
    supplierName: 'Theta Instruments',
    supplierAddress: '450 Silicon Avenue, San Jose, CA 95110',
    supplierEmail: 'finance@thetainstruments.example',
    supplierTaxId: 'US-TAX-334412',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-5004-C',
    date: '2026-10-02',
    dueDate: '2026-11-01',
    poNumber: 'PO-5004',
    currency: 'USD',
    lines: [
      { description: 'Precision Resistor 100 Ohm', qty: 200, unitPrice: 0.10, lineTotal: 20.00 }
    ],
    subtotal: 20.00,
    tax: 2.00,
    total: 22.00,
    bankAccount: '333444555',
    bankName: 'Silicon Valley Premier Bank',
    swift: 'SVPBUS66',
    watermark: null,
    expectedStatus: 'auto_approved',
    issues: []
  },
  {
    fileName: 'invoice-total-mismatch.pdf',
    supplierName: 'Omega Supplies',
    supplierAddress: 'Via Industrie 42, 20100 Milano, Italy',
    supplierEmail: 'accounts@omegasupplies.example',
    supplierTaxId: 'IT-VAT-9028123',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-2002',
    date: '2026-09-28',
    dueDate: '2026-10-28',
    poNumber: 'PO-3002',
    currency: 'USD',
    lines: [
      { description: 'Shielded Transmission Cable 10m', qty: 50, unitPrice: 2.00, lineTotal: 100.00 }
    ],
    subtotal: 100.00,
    tax: 22.00,
    total: 115.00, // Intentional mismatch: 100 + 22 is 122, PO is 150
    bankAccount: '222333444',
    bankName: 'Banca Nazionale Milano',
    swift: 'BNMIIT22',
    watermark: null,
    expectedStatus: 'rejected',
    issues: [
      { type: 'TOTAL_MISMATCH', severity: 'high', message: 'Total (115.0) does not match subtotal + tax (122.0)' }
    ]
  },
  {
    fileName: 'invoice-price-mismatch.pdf',
    supplierName: 'Theta Instruments',
    supplierAddress: '450 Silicon Avenue, San Jose, CA 95110',
    supplierEmail: 'finance@thetainstruments.example',
    supplierTaxId: 'US-TAX-334412',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-5004',
    date: '2026-10-01',
    dueDate: '2026-10-31',
    poNumber: 'PO-5004',
    currency: 'USD',
    lines: [
      { description: 'Precision Resistor 100 Ohm', qty: 200, unitPrice: 0.15, lineTotal: 30.00 } // PO price is 0.11
    ],
    subtotal: 30.00,
    tax: 3.00,
    total: 33.00,
    bankAccount: '333444555',
    bankName: 'Silicon Valley Premier Bank',
    swift: 'SVPBUS66',
    watermark: null,
    expectedStatus: 'needs_review',
    issues: [
      { type: 'PRICE_MISMATCH', severity: 'medium', message: 'Unit price (0.15) exceeds PO unit price (0.11)' }
    ]
  },
  {
    fileName: 'invoice-qty-mismatch.pdf',
    supplierName: 'Kappa Enterprises',
    supplierAddress: '88 Enterprise Way, Seattle, WA 98101',
    supplierEmail: 'ap@kappaenterprises.example',
    supplierTaxId: 'US-TAX-772819',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-6005',
    date: '2026-10-05',
    dueDate: '2026-11-04',
    poNumber: 'PO-6005',
    currency: 'USD',
    lines: [
      { description: 'Precision Widget Assembly', qty: 12, unitPrice: 10.00, lineTotal: 120.00 } // PO qty is 10
    ],
    subtotal: 120.00,
    tax: 12.00,
    total: 132.00,
    bankAccount: '777888999',
    bankName: 'Pacific Northwest Trust',
    swift: 'PNWTUS44',
    watermark: null,
    expectedStatus: 'needs_review',
    issues: [
      { type: 'QTY_MISMATCH', severity: 'medium', message: 'Quantity (12) exceeds PO quantity (10)' }
    ]
  },
  {
    fileName: 'invoice-duplicate.pdf',
    supplierName: 'Alpha Supplies',
    supplierAddress: '100 Industrial Parkway, Austin, TX 78701',
    supplierEmail: 'billing@alphasupplies.example',
    supplierTaxId: 'US-TAX-889921',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-1001', // Duplicate of clean invoice
    date: '2026-09-30',
    dueDate: '2026-10-30',
    poNumber: 'PO-2001',
    currency: 'USD',
    lines: [
      { description: 'Industrial Screwdriver Set', qty: 20, unitPrice: 5.00, lineTotal: 100.00 },
      { description: 'Heavy Forged Steel Hammer', qty: 10, unitPrice: 12.00, lineTotal: 120.00 }
    ],
    subtotal: 220.00,
    tax: 22.00,
    total: 242.00,
    bankAccount: '111222333',
    bankName: 'Texas Commerce Bank',
    swift: 'TXCBUS33',
    watermark: 'DUPLICATE SUBMISSION',
    expectedStatus: 'rejected',
    issues: [
      { type: 'DUPLICATE_INVOICE', severity: 'high', message: 'Invoice INV-1001 has already been processed' }
    ]
  },
  {
    fileName: 'invoice-bank-changed.pdf',
    supplierName: 'Lambda Supplies',
    supplierAddress: '72 Logistics Blvd, Chicago, IL 60601',
    supplierEmail: 'billing@lambdasupplies.example',
    supplierTaxId: 'US-TAX-556677',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-7006',
    date: '2026-10-08',
    dueDate: '2026-11-07',
    poNumber: 'PO-7006',
    currency: 'USD',
    lines: [
      { description: 'Reinforced High-Pressure Gasket', qty: 30, unitPrice: 3.00, lineTotal: 90.00 }
    ],
    subtotal: 90.00,
    tax: 9.00,
    total: 99.00,
    bankAccount: '999888777', // Fraud check: Vendor master record is 555666777!
    bankName: 'Offshore International Vault',
    swift: 'OIVLUS99',
    watermark: null,
    expectedStatus: 'rejected',
    issues: [
      { type: 'BANK_DETAILS_CHANGED', severity: 'high', message: 'Bank account does not match vendor master record' }
    ]
  },
  {
    fileName: 'invoice-low-confidence.pdf',
    supplierName: 'Sigma Parts',
    supplierAddress: '21 Precision Way, Detroit, MI 48201',
    supplierEmail: 'invoices@sigmaparts.example',
    supplierTaxId: 'US-TAX-445566',
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber: 'INV-4003',
    date: '2026-10-04',
    dueDate: '2026-11-03',
    poNumber: 'PO-4003',
    currency: 'USD',
    lines: [
      { description: 'High-Tensile Steel Washer 1/2"', qty: 50, unitPrice: 1.00, lineTotal: 50.00 }
    ],
    subtotal: 50.00,
    tax: 5.00,
    total: 55.00,
    bankAccount: '444555666',
    bankName: 'Detroit Industrial Bank',
    swift: 'DINDUS33',
    watermark: 'SCAN QUALITY LOW',
    expectedStatus: 'needs_review',
    issues: [
      { type: 'LOW_CONFIDENCE', severity: 'low', message: 'Extraction confidence 0.82 is below threshold 0.90' }
    ]
  }
];

const supplierProfiles = {
  'Alpha Supplies': {
    supplierAddress: '100 Industrial Parkway, Austin, TX 78701',
    supplierEmail: 'billing@alphasupplies.example',
    supplierTaxId: 'US-TAX-889921',
    bankAccount: '111222333',
    bankName: 'Texas Commerce Bank',
    swift: 'TXCBUS33'
  },
  'Omega Supplies': {
    supplierAddress: 'Via Industrie 42, Milano, Italy',
    supplierEmail: 'accounts@omegasupplies.example',
    supplierTaxId: 'IT-VAT-9028123',
    bankAccount: '222333444',
    bankName: 'Banca Nazionale Milano',
    swift: 'BNMIIT22'
  },
  'Sigma Parts': {
    supplierAddress: '21 Precision Way, Detroit, MI 48201',
    supplierEmail: 'invoices@sigmaparts.example',
    supplierTaxId: 'US-TAX-445566',
    bankAccount: '444555666',
    bankName: 'Detroit Industrial Bank',
    swift: 'DINDUS33'
  },
  'Theta Instruments': {
    supplierAddress: '450 Silicon Avenue, San Jose, CA 95110',
    supplierEmail: 'finance@thetainstruments.example',
    supplierTaxId: 'US-TAX-334412',
    bankAccount: '333444555',
    bankName: 'Silicon Valley Premier Bank',
    swift: 'SVPBUS66'
  },
  'Kappa Enterprises': {
    supplierAddress: '88 Enterprise Way, Seattle, WA 98101',
    supplierEmail: 'ap@kappaenterprises.example',
    supplierTaxId: 'US-TAX-772819',
    bankAccount: '777888999',
    bankName: 'Pacific Northwest Trust',
    swift: 'PNWTUS44'
  },
  'Lambda Supplies': {
    supplierAddress: '72 Logistics Blvd, Chicago, IL 60601',
    supplierEmail: 'billing@lambdasupplies.example',
    supplierTaxId: 'US-TAX-556677',
    bankAccount: '555666777',
    bankName: 'Midwest Commercial Bank',
    swift: 'MCBKUS44'
  },
  'Omega Banking': {
    supplierAddress: '500 Finance Street, Austin, TX 78702',
    supplierEmail: 'invoices@omegabanking.example',
    supplierTaxId: 'US-TAX-880077',
    bankAccount: '111000999',
    bankName: 'Central Commerce Bank',
    swift: 'CCBKUS11'
  }
};

const purchaseOrders = {
  'PO-2001': {
    supplierName: 'Alpha Supplies', total: 242, lines: [
      { description: 'Screwdriver', qty: 20, unitPrice: 5, lineTotal: 100 },
      { description: 'Hammer', qty: 10, unitPrice: 12, lineTotal: 120 }
    ]
  },
  'PO-3002': {
    supplierName: 'Omega Supplies', total: 150, lines: [
      { description: 'Cable', qty: 30, unitPrice: 5, lineTotal: 150 }
    ]
  },
  'PO-4003': {
    supplierName: 'Sigma Parts', total: 55, lines: [
      { description: 'Washer', qty: 50, unitPrice: 1.1, lineTotal: 55 }
    ]
  },
  'PO-5004': {
    supplierName: 'Theta Instruments', total: 22, lines: [
      { description: 'Resistor', qty: 200, unitPrice: 0.11, lineTotal: 22 }
    ]
  },
  'PO-6005': {
    supplierName: 'Kappa Enterprises', total: 110, lines: [
      { description: 'Widget', qty: 10, unitPrice: 10, lineTotal: 100 }
    ]
  },
  'PO-7006': {
    supplierName: 'Lambda Supplies', total: 99, lines: [
      { description: 'Gasket', qty: 30, unitPrice: 3, lineTotal: 90 }
    ]
  },
  'PO-8007': {
    supplierName: 'Omega Banking', total: 550, lines: [
      { description: 'Service Fee', qty: 1, unitPrice: 500, lineTotal: 500 }
    ]
  }
};

const additionalSpecs = [
  { kind: 'clean', poNumber: 'PO-2001', language: 'en' },
  { kind: 'clean', poNumber: 'PO-6005', language: 'it' },
  { kind: 'clean', poNumber: 'PO-3002', language: 'en' },
  { kind: 'total', poNumber: 'PO-2001', language: 'it' },
  { kind: 'total', poNumber: 'PO-6005', language: 'en' },
  { kind: 'total', poNumber: 'PO-7006', language: 'it' },
  { kind: 'total', poNumber: 'PO-8007', language: 'en' },
  { kind: 'quantity', poNumber: 'PO-2001', language: 'en', amount: 1 },
  { kind: 'quantity', poNumber: 'PO-2001', language: 'it', amount: 2 },
  { kind: 'quantity', poNumber: 'PO-2001', language: 'en', amount: 3 },
  { kind: 'price', poNumber: 'PO-2001', language: 'it', amount: 0.25 },
  { kind: 'price', poNumber: 'PO-2001', language: 'en', amount: 0.5 },
  { kind: 'price', poNumber: 'PO-2001', language: 'it', amount: 1 },
  { kind: 'missing_po', poNumber: 'PO-3002', language: 'en' },
  { kind: 'missing_po', poNumber: 'PO-6005', language: 'it' },
  { kind: 'duplicate', poNumber: 'PO-2001', language: 'en' },
  { kind: 'duplicate', poNumber: 'PO-2001', language: 'it' },
  { kind: 'unknown_supplier', poNumber: 'PO-3002', language: 'en' },
  { kind: 'unknown_supplier', poNumber: 'PO-2001', language: 'it' },
  { kind: 'bank_change', poNumber: 'PO-4003', language: 'en' },
  { kind: 'bank_change', poNumber: 'PO-7006', language: 'it' },
  { kind: 'low_confidence', poNumber: 'PO-4003', language: 'en' }
];

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function makeAdditionalScenario(spec, offset) {
  const purchaseOrder = purchaseOrders[spec.poNumber];
  const lines = purchaseOrder.lines.map(line => ({ ...line }));
  const subtotal = () => roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  let supplierName = purchaseOrder.supplierName;
  let poNumber = spec.poNumber;
  let invoiceNumber = `INV-EVAL-${String(offset).padStart(3, '0')}`;
  let total = purchaseOrder.total;
  let tax = roundMoney(total - subtotal());
  let bankAccount = supplierProfiles[supplierName].bankAccount;
  let watermark = null;
  let expectedStatus = 'auto_approved';
  let issues = [];

  if (spec.kind === 'total') {
    total = roundMoney(total + 5);
    expectedStatus = 'rejected';
    issues = [{ type: 'TOTAL_MISMATCH', severity: 'high' }];
  } else if (spec.kind === 'quantity') {
    lines[0].qty += spec.amount;
    lines[0].lineTotal = roundMoney(lines[0].qty * lines[0].unitPrice);
    tax = roundMoney(total - subtotal());
    expectedStatus = 'needs_review';
    issues = [{ type: 'QTY_MISMATCH', severity: 'medium' }];
  } else if (spec.kind === 'price') {
    lines[0].unitPrice = roundMoney(lines[0].unitPrice + spec.amount);
    lines[0].lineTotal = roundMoney(lines[0].qty * lines[0].unitPrice);
    tax = roundMoney(total - subtotal());
    expectedStatus = 'needs_review';
    issues = [{ type: 'PRICE_MISMATCH', severity: 'medium' }];
  } else if (spec.kind === 'missing_po') {
    poNumber = null;
    expectedStatus = 'needs_review';
    issues = [{ type: 'MISSING_PO', severity: 'medium' }];
  } else if (spec.kind === 'duplicate') {
    invoiceNumber = 'INV-1001';
    watermark = 'DUPLICATE SUBMISSION';
    expectedStatus = 'rejected';
    issues = [{ type: 'DUPLICATE_INVOICE', severity: 'high' }];
  } else if (spec.kind === 'unknown_supplier') {
    supplierName = `Unregistered Sample Supplier ${offset}`;
    expectedStatus = 'needs_review';
    issues = [{ type: 'UNKNOWN_SUPPLIER', severity: 'medium' }];
  } else if (spec.kind === 'bank_change') {
    bankAccount = `888${String(offset).padStart(6, '0')}`;
    expectedStatus = 'rejected';
    issues = [{ type: 'BANK_DETAILS_CHANGED', severity: 'high' }];
  } else if (spec.kind === 'low_confidence') {
    watermark = 'SCAN QUALITY LOW';
    expectedStatus = 'needs_review';
    issues = [{ type: 'LOW_CONFIDENCE', severity: 'low' }];
  }

  const issuedDate = new Date(Date.UTC(2026, 9, 10 + offset)).toISOString().slice(0, 10);
  const due = new Date(`${issuedDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  const supplier = supplierProfiles[purchaseOrder.supplierName];

  return {
    fileName: `invoice-${spec.kind.replace(/_/g, '-')}-${String(offset).padStart(3, '0')}.pdf`,
    supplierName,
    ...supplier,
    customerName: 'Global Manufacturing Corp',
    customerAddress: '500 Technology Drive, San Jose, CA 95134',
    invoiceNumber,
    date: issuedDate,
    dueDate: due.toISOString().slice(0, 10),
    poNumber,
    currency: 'USD',
    language: spec.language,
    lines,
    subtotal: subtotal(),
    tax,
    total,
    bankAccount,
    watermark,
    expectedStatus,
    issues
  };
}

scenarios.push(...additionalSpecs.map((spec, index) =>
  makeAdditionalScenario(spec, scenarios.length + index + 1)
));

// Generate missing files only; preserve existing local corpus files.
console.log('Generating Phase 1 PDF dataset in data/documents/...');
scenarios.forEach((sc) => {
  const filePath = path.join(DOCS_DIR, sc.fileName);
  if (fs.existsSync(filePath)) {
    console.log(`↷ Preserved existing ${sc.fileName}`);
    return;
  }
  const pdfBuffer = createInvoicePdf(sc);
  fs.writeFileSync(filePath, pdfBuffer);
  console.log(`✅ Created ${sc.fileName} (${pdfBuffer.length} bytes)`);
});

// Append new labels without changing any existing ground-truth records.
const existingGroundTruth = fs.existsSync(TRUTH_FILE)
  ? JSON.parse(fs.readFileSync(TRUTH_FILE, 'utf8'))
  : [];
if (!Array.isArray(existingGroundTruth)) {
  throw new Error(`Ground truth must be a JSON array: ${TRUTH_FILE}`);
}
const existingTruthNames = new Set(existingGroundTruth.map(entry => entry.fileName));
const addedGroundTruth = scenarios
  .filter(sc => !existingTruthNames.has(sc.fileName))
  .map((sc) => ({
  fileName: sc.fileName,
  supplierName: sc.supplierName,
  language: sc.language || 'en',
  type: 'invoice',
  extracted: {
    invoiceNumber: sc.invoiceNumber,
    poNumber: sc.poNumber,
    currency: sc.currency,
    subtotal: sc.subtotal,
    tax: sc.tax,
    total: sc.total
  },
  expectedStatus: sc.expectedStatus,
  issues: sc.issues
  }));
const groundTruth = [...existingGroundTruth, ...addedGroundTruth];

fs.writeFileSync(TRUTH_FILE, JSON.stringify(groundTruth, null, 2), 'utf8');
console.log(`\n✅ Created ground truth dataset at: ${TRUTH_FILE}`);
console.log(`Total benchmark test files: ${groundTruth.length}`);
