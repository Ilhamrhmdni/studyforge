// ── PARSER ENGINE ──────────────────────────────────────────────────────────────
// Modular PDF Parsing Engine for StudyForge
// Handles extracting text, standardizing formats, and robust validation.

/**
 * Extract text from PDF file
 */
async function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function() {
      try {
        const typedarray = new Uint8Array(this.result);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        let fullText = '';
        const pageImagesMap = {};
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          // Check for images
          const ops = await page.getOperatorList();
          let hasImage = false;
          for (let j = 0; j < ops.fnArray.length; j++) {
            if (ops.fnArray[j] === pdfjsLib.OPS.paintImageXObject) {
              hasImage = true;
              break;
            }
          }

          if (hasImage) {
            // Render to canvas to save as image
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            pageImagesMap[i] = canvas.toDataURL('image/jpeg', 0.8);
          } else {
            const pageText = textContent.items.map(s => s.str).join(' ');
            fullText += `\n\n--- PAGE ${i} ---\n\n` + pageText;
          }
        }
        resolve({ fullText, pageImagesMap, numPages: pdf.numPages });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Normalizes PDF text by removing weird characters, fixing spaces.
 */
function normalizePdfText(text) {
  // Use existing normalizeText from normalize.js if available
  if (typeof normalizeText === 'function') {
    return normalizeText(text);
  }
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/**
 * Parse answer key text file
 * Supports formats: "1. A", "1 A", "No 1: A", "1. Jawaban: A"
 */
function parseAnswerKey(text) {
  const answerMap = {};
  const lines = text.split('\n');
  const regex = /^(?:no\s*)?(\d+)[\.\s:]*(?:jawaban\s*:\s*)?([A-E])/i;
  
  for (const line of lines) {
    const m = line.trim().match(regex);
    if (m) {
      answerMap[parseInt(m[1], 10)] = m[2].toUpperCase();
    }
  }
  return answerMap;
}

/**
 * Parse raw text into structured questions
 */
function parseQuestions(text, answerMap = {}) {
  // Try to find if it's LMS/Moodle format (Question 1) or Standard (1.)
  const isLMS = /Question\s+\d+/i.test(text);
  let questions = [];

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let current = null;

  const isQuestionHeaderLMS = l => /^Question\s+(\d+)/i.test(l);
  const isQuestionHeaderStd = l => /^(\d+)[\.\)]\s+(.+)/.test(l);
  
  // Regex to detect options A-E with formats like A., a., (A), A)
  const isOption = l => /^[\(]?([a-e])[\.\)]\s+(.+)/i.test(l);
  const getOptionMatch = l => l.match(/^[\(]?([a-e])[\.\)]\s+(.+)/i);

  let skipMeta = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Meta skipping for LMS
    if (isLMS && skipMeta && /^(Correct|Incorrect|Mark|Not answered|Flag)/i.test(line)) {
      continue;
    }
    skipMeta = false;

    // Detect new question header
    let newQMatch = isLMS ? line.match(/^Question\s+(\d+)/i) : line.match(/^(\d+)[\.\)]\s+(.+)/);
    
    if (newQMatch) {
      if (current && current.options.length >= 2) {
        questions.push(current);
      }
      
      const num = parseInt(newQMatch[1], 10);
      current = {
        num: num,
        text: isLMS ? '' : newQMatch[2] || '',
        options: [],
        answer: answerMap[num] || '',
        _correctText: ''
      };
      
      if (isLMS) skipMeta = true;
      continue;
    }

    if (!current) continue;

    // Detect LMS inline correct answer
    if (isLMS && /^(The\s+correct\s+answer\s+is|Jawaban\s+yang\s+benar)[:\s]/i.test(line)) {
      const ansText = line.replace(/^(The\s+correct\s+answer\s+is[:\s]|Jawaban\s+yang\s+benar[:\s])/i, '').trim();
      current._correctText = ansText.toLowerCase();
      continue;
    }

    // Detect option
    const optMatch = getOptionMatch(line);
    if (optMatch) {
      current.options.push({ key: optMatch[1].toUpperCase(), text: optMatch[2] });
      continue;
    }

    // Append to last option if we are in options
    if (current.options.length > 0) {
      current.options[current.options.length - 1].text += ' ' + line;
    } else {
      // Append to question text
      if (!isLMS || line.length > 3) {
         current.text += (current.text ? ' ' : '') + line;
      }
    }
  }

  if (current && current.options.length >= 2) {
    questions.push(current);
  }

  // Resolve LMS correct text to option key
  for (const q of questions) {
    if (typeof stripMarkers === 'function') {
      q.text = stripMarkers(q.text);
      for (const opt of q.options) opt.text = stripMarkers(opt.text);
    }
    
    // Resolve answer by text matching (from LMS)
    if (q._correctText && typeof normalizeForCompare === 'function') {
      for (const opt of q.options) {
        const normOpt = normalizeForCompare(opt.text);
        const normCorr = normalizeForCompare(q._correctText);
        if (normOpt.includes(normCorr) || normCorr.includes(normOpt)) {
          q.answer = opt.key;
          break;
        }
      }
    }
    // Resolve answer by markers (✓)
    for (const opt of q.options) {
      if (typeof hasCorrectMarker === 'function' && hasCorrectMarker(opt.text) && !q.answer) {
        q.answer = opt.key;
      }
    }
    delete q._correctText;
  }

  return questions;
}

/**
 * Validate parsed quiz data and flag warnings/errors
 */
function validateParsedQuiz(questions) {
  let validCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  const seenNums = new Set();
  const duplicates = [];
  
  // First pass: sort and check duplicates
  questions.sort((a, b) => a.num - b.num);
  questions.forEach(q => {
    if (seenNums.has(q.num)) duplicates.push(q.num);
    seenNums.add(q.num);
  });

  const missingNums = [];
  if (questions.length > 0) {
    const min = questions[0].num;
    const max = questions[questions.length - 1].num;
    for (let i = min; i <= max; i++) {
      if (!seenNums.has(i)) missingNums.push(i);
    }
  }

  // Second pass: validate individual questions
  questions.forEach(q => {
    q.errors = [];
    q.warnings = [];

    // Errors
    if (!q.text || q.text.length < 5) q.errors.push('Teks soal terlalu pendek atau kosong.');
    if (q.options.length === 0) q.errors.push('Soal tidak memiliki opsi jawaban.');
    
    // Warnings
    if (q.options.length > 0 && q.options.length < 4) q.warnings.push('Opsi jawaban kurang dari 4.');
    if (!q.answer) q.warnings.push('Jawaban benar belum diatur.');
    else if (!q.options.find(o => o.key === q.answer)) q.warnings.push(`Kunci jawaban (${q.answer}) tidak ada di opsi.`);
    
    if (duplicates.includes(q.num)) q.warnings.push('Nomor soal duplikat.');

    // NLP heuristics
    const lowText = q.text.toLowerCase();
    if (lowText.includes('gambar di bawah') || lowText.includes('perhatikan gambar')) {
      if (!q.image) q.warnings.push('Soal mungkin membutuhkan gambar yang hilang.');
    }
    if (lowText.includes('tabel berikut')) {
      q.warnings.push('Soal mungkin mengandung tabel yang gagal terekstrak.');
    }

    if (q.errors.length > 0) {
      q.status = 'error';
      errorCount++;
    } else if (q.warnings.length > 0) {
      q.status = 'warning';
      warningCount++;
    } else {
      q.status = 'valid';
      validCount++;
    }
  });

  // Calculate score
  const total = questions.length;
  let score = 0;
  if (total > 0) {
    score = Math.round(((validCount * 1) + (warningCount * 0.5)) / total * 100);
  }

  return {
    questions,
    stats: {
      total,
      valid: validCount,
      warning: warningCount,
      error: errorCount,
      missingNums,
      duplicateNums: [...new Set(duplicates)],
      qualityScore: score
    }
  };
}
