// ── NORMALIZE.JS ──────────────────────────────────────────────────────────────
// Standardizes PDF text symbols to consistent UTF-8 markers before parsing.
// All "correct" indicators → ✔  |  All "wrong" indicators → ✗

const SF_CORRECT_GLYPHS = [
  '\uF058', // Wingdings filled circle checkmark
  '\uF0FE', // Wingdings ballot check
  '\uF0FC', // Wingdings checked box
  '\u2713', // ✓ Check mark
  '\u2714', // ✔ Heavy check mark
  '\u2705', // ✅ White heavy check mark emoji
  '\u2611', // ☑ Ballot box with check
  '\u2612', // ☒ Ballot box with X (sometimes used as "correct" in some PDFs)
];

const SF_WRONG_GLYPHS = [
  '\u2715', // ✕ Multiplication X
  '\u2716', // ✖ Heavy multiplication X
  '\u2717', // ✗ Ballot X
  '\u2718', // ✘ Heavy ballot X
  '\uF0FB', // Wingdings X
];

function normalizeText(s) {
  if (!s) return '';
  let t = s;

  // Replace all correct glyphs with canonical ✔
  SF_CORRECT_GLYPHS.forEach(c => { t = t.split(c).join(' ✔ '); });

  // Replace all wrong glyphs with canonical ✗
  SF_WRONG_GLYPHS.forEach(c => { t = t.split(c).join(' ✗ '); });

  // (V) variants → ✔  (handles (V), **(V)**, **( V )**, etc.)
  t = t.replace(/\*{0,2}\(\s*V\s*\)\*{0,2}/gi, ' ✔ ');

  // Remaining PDF private-use area chars (Wingdings etc.)
  t = t.replace(/[\uE000-\uF8FF]/g, '');

  // Unicode replacement char
  t = t.replace(/\uFFFD/g, '');

  // Common PDF ligatures / special chars
  t = t.replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl');

  // Collapse whitespace
  t = t.replace(/[ \t]{2,}/g, ' ').trim();

  return t;
}

// Returns true if normalized text contains a ✔ marker
function hasCorrectMarker(s) {
  return normalizeText(s).includes('✔');
}

// Returns true if normalized text contains a ✗ marker
function hasWrongMarker(s) {
  return normalizeText(s).includes('✗');
}

// Remove ✔ and ✗ markers from text
function stripMarkers(s) {
  return normalizeText(s)
    .replace(/\s*✔\s*/g, ' ')
    .replace(/\s*✗\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Normalize text for comparison (lowercase, no punctuation, collapsed spaces)
function normalizeForCompare(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
