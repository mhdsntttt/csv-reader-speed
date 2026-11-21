// solve.js - a faster drop-in for csv-reader 1.0.0, make.fun's reference CSV reader.
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the same {text, header}: the same
// {columns, rows, errors}, the same strings code unit for code unit, the same errors in the same order. The
// policy is make.fun's own (see the reference): a U+FEFF at the very start is dropped; a record ends at LF or
// CRLF and a characterless line is no record; a CR outside quotes not followed by LF is dropped (stray_cr);
// a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote and each
// CRLF or lone CR inside it read as LF, and what follows its closing quote up to the next comma or line break
// is appended as it stands (quote_junk); a quote that never closes is a literal and the text after it is read
// again as unquoted (unterminated_quote); a quote inside an unquoted field is a literal; fields stay strings.
//
// The gain over the reference is mechanical, not a different reading: the reference walks one character at a
// time through closures and builds every field a character at a time, while this walks runs of ordinary
// characters with the native indexOf and hands over whole slices, and it scans a quoted field's content only
// when that content holds an escape. Every branch here is the reference's branch, so the answers agree.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The three characters that can end an unquoted run, in one native scan. */
const SPECIAL = /[,\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let i = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the field just read ended, and how many characters that read kept (for quote_junk).
  let ended = END;
  let added = 0;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is
  // dropped (stray_cr). Leaves how it ended in `ended` and its kept count in `added`.
  function readUnquoted(value) {
    let kept = 0;
    while (i < n) {
      // The nearest of the three characters that can end an unquoted run.
      SPECIAL.lastIndex = i;
      const hit = SPECIAL.exec(text);
      const p = hit ? hit.index : -1;
      const ch = p >= 0 ? text.charCodeAt(p) : 0;
      if (p < 0) {
        kept += n - i;
        value = value.length === 0 ? text.slice(i) : value + text.slice(i);
        i = n;
        ended = END;
        added = kept;
        return value;
      }
      if (p > i) {
        const run = text.slice(i, p);
        kept += run.length;
        value = value.length === 0 ? run : value + run;
      }
      if (ch === 44) {
        i = p + 1;
        ended = COMMA;
        added = kept;
        return value;
      }
      if (ch === 10) {
        i = p + 1;
        line += 1;
        ended = LINE_BREAK;
        added = kept;
        return value;
      }
      if (text.charCodeAt(p + 1) === 10) {
        i = p + 2;
        line += 1;
        ended = LINE_BREAK;
        added = kept;
        return value;
      }
      // A CR outside quotes that no LF follows is dropped, and the field goes on without it.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      i = p + 1;
    }
    ended = END;
    added = kept;
    return value;
  }

  // Reads a quoted field whose opening quote is at i. Leaves how it ended in `ended`.
  function readQuoted() {
    const open = i;
    const openLine = line;
    // The closing quote: the first '"' that no second '"' follows. Doubled quotes are skipped whole.
    let p = i + 1;
    let close = -1;
    while (p < n) {
      const q = text.indexOf('"', p);
      if (q < 0) {
        p = n;
        break;
      }
      if (text.charCodeAt(q + 1) === 34) {
        p = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close < 0) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      i = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    // The quoted content: "" is one quote, a CRLF or a lone CR is one LF, and each of those line breaks counts.
    let value;
    if (text.indexOf('"', open + 1) === close && text.indexOf('\r', open + 1) >= close) {
      // Fast path: the content holds no quote and no CR, so it is one slice and only its LFs count.
      value = text.slice(open + 1, close);
      let nl = 0;
      let pp = text.indexOf('\n', open + 1);
      while (pp >= 0 && pp < close) {
        nl += 1;
        pp = text.indexOf('\n', pp + 1);
      }
      line += nl;
    } else {
      let seg = open + 1;
      let k = open + 1;
      value = '';
      while (k < close) {
        const c = text.charCodeAt(k);
        if (c === 34) {
          value += text.slice(seg, k) + '"';
          k += 2;
          seg = k;
          continue;
        }
        if (c === 13) {
          value += text.slice(seg, k) + '\n';
          k += text.charCodeAt(k + 1) === 10 ? 2 : 1;
          seg = k;
          line += 1;
          continue;
        }
        if (c === 10) line += 1;
        k += 1;
      }
      value += text.slice(seg, close);
    }
    i = close + 1;
    if (i >= n) {
      ended = END;
      return value;
    }
    const c = text.charCodeAt(i);
    if (c === 44) {
      i += 1;
      ended = COMMA;
      return value;
    }
    if (c === 10) {
      i += 1;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(i + 1) === 10) {
      i += 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 10) {
        i += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(i + 1) === 10) {
        i += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (i >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(i) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? columns ?? [] : null, rows, errors };
}
