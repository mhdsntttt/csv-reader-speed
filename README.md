# csv-reader-speed

A faster drop-in for **csv-reader 1.0.0**, make.fun's reference CSV reader, built for the
[make.fun bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

`solve.js` exports `run(input)` and returns exactly what csv-reader 1.0.0's `readCsv` returns for the same
`{text, header}`: the same `{columns, rows, errors}`, the same strings code unit for code unit, the same
errors in the same order. `main.ts` is the driver the harness runs: it reads `/input/cases.json`, answers
each case with `run`, and writes `/output/answers.json`.

## The policy (make.fun's own, kept identical)

- a U+FEFF at the very start of the text is dropped;
- a record ends at LF or CRLF, and a line left with no characters is no record;
- outside a quoted field a CR not followed by LF is dropped (`stray_cr`);
- a field that opens with a quote runs to the next quote that is not doubled, `""` inside it one quote, each
  CRLF or lone CR inside it read as LF; what follows its closing quote, up to the next comma or line break,
  is appended as it stands (`quote_junk`, when the field ends); a quote that never closes is a literal
  character and the text after it is read again as unquoted (`unterminated_quote`);
- a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
- `columns` is the first record when `header` is true, else null; `rows` holds the records after it, each
  padded with `""` (`short_row`) or cut (`long_row`) to the first record's width;
- each error is `{code, line, row}`, in the order met.

## Where the speed comes from

The reference walks one character at a time through closures and builds every field a character at a time.
This reader keeps the same branches and differs only mechanically:

- an unquoted run is found with one native regex scan (`/[,\r\n]/g`) instead of three `indexOf` calls and a
  per-character loop, and the run is handed over as a single slice;
- a quoted field's closing quote is found with one native `indexOf('"')`, doubled quotes skipped whole;
- a quoted field whose content holds no quote and no CR is one slice, with only its LFs counted;
- the field's end and kept count are carried in two closure variables rather than an object per field.

## Verification

- byte-identical `answers.json` against the house baseline on the practice set (6/6 cases pass);
- 40,052 fuzz cases (random and structured broken-row inputs, `header` true and false) with zero mismatches
  against `vendor/csv-reader`'s `readCsv`.

## Licence

MIT (see `LICENSE`).
