// Normalizes PDF text symbols to consistent UTF-8 markers before parsing.

const CHECK_MARK = '\u2714';
const X_MARK = '\u2718';

const SF_CORRECT_GLYPHS = [
  '\uF058',
  '\uF0FE',
  '\uF0FC',
  '\u2713',
  '\u2714',
  '\u2705',
  '\u2611',
  '\u2612'
];

const SF_WRONG_GLYPHS = [
  '\u2715',
  '\u2716',
  '\u2717',
  '\u2718',
  '\uF0FB'
];

function normalizeText(value) {
  if (!value) return '';
  let text = value;

  SF_CORRECT_GLYPHS.forEach((glyph) => {
    text = text.split(glyph).join(` ${CHECK_MARK} `);
  });

  SF_WRONG_GLYPHS.forEach((glyph) => {
    text = text.split(glyph).join(` ${X_MARK} `);
  });

  text = text.replace(/\*{0,2}\(\s*V\s*\)\*{0,2}/gi, ` ${CHECK_MARK} `);
  text = text.replace(/[\uE000-\uF8FF]/g, '');
  text = text.replace(/\uFFFD/g, '');
  text = text.replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl');
  text = text.replace(/[ \t]{2,}/g, ' ').trim();

  return text;
}

function hasCorrectMarker(value) {
  return normalizeText(value).includes(CHECK_MARK);
}

function hasWrongMarker(value) {
  return normalizeText(value).includes(X_MARK);
}

function stripMarkers(value) {
  return normalizeText(value)
    .replace(new RegExp(`\\s*${CHECK_MARK}\\s*`, 'g'), ' ')
    .replace(new RegExp(`\\s*${X_MARK}\\s*`, 'g'), ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Auto-exports to window ---
window.normalizeText = normalizeText;
window.normalizeForCompare = normalizeForCompare;
window.hasWrongMarker = hasWrongMarker;
window.hasCorrectMarker = hasCorrectMarker;
window.stripMarkers = stripMarkers;
