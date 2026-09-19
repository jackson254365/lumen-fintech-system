// ============================================================================
// Multi-Bank Statement Parser (CSV & OFX/QFX)
// Intelligently detects delimiters, headers, date formats, and dual debit/credit columns
// ============================================================================

/**
 * Parses raw bank statement content (CSV or OFX)
 */
function parseStatement(fileContent, filename = '') {
  const content = fileContent.toString('utf8').trim();

  if (content.startsWith('OFXHEADER:') || content.includes('<OFX>') || content.includes('<STMTTRN>')) {
    return parseOFX(content);
  }

  return parseCSV(content);
}

/**
 * Robust CSV parser with auto-detected delimiter and header normalization
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  // Detect delimiter: comma, semicolon, tab
  const sample = lines[0];
  const commaCount = (sample.match(/,/g) || []).length;
  const semiCount = (sample.match(/;/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;

  let delimiter = ',';
  if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
  if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

  // Split lines into tokens respecting quotes
  const parseLine = (line) => {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        tokens.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    tokens.push(current.trim());
    return tokens;
  };

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // Header mapping heuristics
  const dateIdx = headers.findIndex(h => /^(date|transactiondate|postingdate|valuedate|bookingdate)$/.test(h));
  const descIdx = headers.findIndex(h => /^(description|payee|merchant|narrative|memo|details|name|transactiondetails)$/.test(h));
  const amountIdx = headers.findIndex(h => /^(amount|transactionamount|value)$/.test(h));
  const debitIdx = headers.findIndex(h => /^(debit|moneyout|paidout|spent|withdrawal|withdrawn)$/.test(h));
  const creditIdx = headers.findIndex(h => /^(credit|moneyin|paidin|deposit|deposited)$/.test(h));
  const categoryIdx = headers.findIndex(h => /^(category|subcategory|type)$/.test(h));
  const refIdx = headers.findIndex(h => /^(reference|ref|transactionid|id|fitid|checknumber)$/.test(h));

  if (dateIdx === -1) {
    throw new Error('Could not identify a date column in CSV. Found headers: ' + rawHeaders.join(', '));
  }
  if (descIdx === -1 && headers.length <= 1) {
    throw new Error('Could not identify description/payee column in CSV');
  }

  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (cols.length <= 1 || cols.every(c => !c)) continue;

    const rawDate = cols[dateIdx];
    const normalizedDate = normalizeDate(rawDate);
    const description = (descIdx !== -1 && cols[descIdx]) ? cols[descIdx] : (cols[1] || 'Unknown Payee');

    let amount = 0;
    if (amountIdx !== -1 && cols[amountIdx]) {
      amount = parseNumber(cols[amountIdx]);
    } else if (debitIdx !== -1 || creditIdx !== -1) {
      const debit = debitIdx !== -1 && cols[debitIdx] ? parseNumber(cols[debitIdx]) : 0;
      const credit = creditIdx !== -1 && cols[creditIdx] ? parseNumber(cols[creditIdx]) : 0;
      amount = credit > 0 ? credit : -Math.abs(debit);
    }

    if (isNaN(amount) || amount === 0) continue;

    const category = categoryIdx !== -1 && cols[categoryIdx] ? cols[categoryIdx] : null;
    const ref = refIdx !== -1 && cols[refIdx] ? cols[refIdx] : null;

    results.push({
      date: normalizedDate,
      description: cleanText(description),
      amount: Number(amount.toFixed(2)),
      category: category ? cleanText(category) : null,
      referenceId: ref ? cleanText(ref) : null,
      rawRow: lines[i]
    });
  }

  return results;
}

/**
 * OFX / QFX XML/SGML statement parser
 */
function parseOFX(text) {
  const transactions = [];
  const stmtRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;

  while ((match = stmtRegex.exec(text)) !== null) {
    const block = match[1];
    const getTag = (tag) => {
      const r = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i');
      const m = block.match(r);
      return m ? m[1].trim() : null;
    };

    const rawDate = getTag('DTPOSTED');
    const rawAmount = getTag('TRNAMT');
    const name = getTag('NAME') || getTag('MEMO') || 'Bank Transaction';
    const fitid = getTag('FITID');
    const trntype = getTag('TRNTYPE');

    if (rawDate && rawAmount) {
      // OFX date format: YYYYMMDDHHMMSS or YYYYMMDD
      const y = rawDate.substring(0, 4);
      const m = rawDate.substring(4, 6);
      const d = rawDate.substring(6, 8);
      const formattedDate = `${y}-${m}-${d}`;

      transactions.push({
        date: formattedDate,
        description: cleanText(name),
        amount: Number(parseFloat(rawAmount).toFixed(2)),
        category: null,
        referenceId: fitid ? cleanText(fitid) : null,
        rawRow: block.replace(/\s+/g, ' ')
      });
    }
  }

  return transactions;
}

function parseNumber(str) {
  if (!str) return 0;
  // Remove currency signs, commas, extra whitespace
  const clean = str.replace(/[$€£\s]/g, '').replace(/,/g, '');
  return parseFloat(clean);
}

function normalizeDate(str) {
  if (!str) return new Date().toISOString().substring(0, 10);
  const clean = str.trim();

  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    return clean.substring(0, 10);
  }

  // DD/MM/YYYY or MM/DD/YYYY
  const parts = clean.split(/[/\-.]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      // DD/MM/YYYY or MM/DD/YYYY
      const p1 = parseInt(parts[0], 10);
      const p2 = parseInt(parts[1], 10);
      const year = parts[2];
      // Heuristic: if p1 > 12, p1 must be day
      if (p1 > 12) {
        return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
      } else {
        return `${year}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
      }
    }
  }

  const d = new Date(clean);
  if (!isNaN(d.getTime())) {
    return d.toISOString().substring(0, 10);
  }

  return new Date().toISOString().substring(0, 10);
}

function cleanText(str) {
  return str.replace(/['"]+/g, '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  parseStatement,
  parseCSV,
  parseOFX
};
