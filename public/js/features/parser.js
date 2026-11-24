// Parser helpers for StudyForge admin PDF import flow.

async function extractPdfPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const ops = await page.getOperatorList();

  let hasImage = false;
  for (const fn of ops.fnArray) {
    if (fn === pdfjsLib.OPS.paintImageXObject) {
      hasImage = true;
      break;
    }
  }

  const pageText = textContent.items.map((item) => item.str).join(' ');
  let imageDataUrl = null;
  if (hasImage) {
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport }).promise;
    imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
  }

  return { pageNumber, pageText, imageDataUrl };
}

async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(new Uint8Array(buffer)).promise;
  const pageNumbers = Array.from({ length: pdf.numPages }, (_, idx) => idx + 1);
  const pages = await Promise.all(pageNumbers.map((num) => extractPdfPage(pdf, num)));

  let fullText = '';
  const pageImagesMap = {};
  for (const p of pages) {
    fullText += `\n\n--- PAGE ${p.pageNumber} ---\n\n${p.pageText}`;
    if (p.imageDataUrl) pageImagesMap[p.pageNumber] = p.imageDataUrl;
  }

  return { fullText, pageImagesMap, numPages: pdf.numPages };
}

async function generateQuizDescription(questionsText, geminiKey) {
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const prompt = `Buatkan deskripsi singkat (maksimal 2 kalimat) yang menarik untuk paket soal berikut. Fokus pada topik utama. JANGAN beri awalan seperti "Deskripsi:" atau tanda kutip, langsung tuliskan kalimatnya.\n\nContoh cuplikan soal:\n${questionsText.substring(0, 1500)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 100 }
      })
    });
    const data = await res.json();
    if (!res.ok) return '';
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch (err) {
    console.warn('generateQuizDescription failed:', err?.message);
    return '';
  }
}

function normalizePdfText(text) {
  if (typeof normalizeText === 'function') {
    return normalizeText(text);
  }
  return String(text || '')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function parseAnswerKey(text) {
  const answerMap = {};
  const lines = String(text || '').split('\n');
  const regex = /^(?:no\s*)?(\d+)[.\s:]*(?:jawaban\s*:\s*)?([A-E])/i;

  for (const line of lines) {
    const match = regex.exec(line.trim());
    if (match) {
      answerMap[Number.parseInt(match[1], 10)] = match[2].toUpperCase();
    }
  }

  return answerMap;
}

function isNoiseLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return true;
  return (
    /^---\s*PAGE\s+\d+\s*---$/i.test(trimmed) ||
    /^Edit\s+soal\s+by\s+Tiktok\b/i.test(trimmed) ||
    /^Note:\s*Soal\s+Direkap\s+dan\s+Bersumber\s+dari\b/i.test(trimmed) ||
    /^sebagai\s+bahan\s+belajar\s+dan\s+tetap\s+cek\s+kembali\s+jawabannya/i.test(trimmed) ||
    /^Kisi\s+Kisi\s+Soal\s+UT\b/i.test(trimmed) ||
    /^Akses\s+Soal$/i.test(trimmed) ||
    /^[A-Z][A-Z0-9\s]{4,}\(\s*[A-Z]{4}\d{4}\s*\)$/.test(trimmed)
  );
}

function parseQuestions(text, answerMap = {}) {
  const isLMSFormat = /Question\s+\d+/i.test(text) || /Correct\s+Mark\s+[\d.]+\s+out\s+of/i.test(text);
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !isNoiseLine(line));
  return isLMSFormat
    ? parseQuestionsLMS(lines, answerMap)
    : parseQuestionsStandard(lines, answerMap);
}

function resolveQuestionAnswer(question) {
  const clean = typeof stripMarkers === 'function' ? stripMarkers : (s) => s;
  question.text = clean(question.text);

  for (const option of question.options) {
    delete option._isColon;
    if (typeof hasCorrectMarker === 'function' && hasCorrectMarker(option.text) && !question.answer) {
      question.answer = option.key;
    }
    option.text = clean(option.text);
  }

  if (question.explanation) {
    question.explanation = clean(question.explanation);
  }

  if (question._correctText && typeof normalizeForCompare === 'function') {
    const normalizedCorrectText = normalizeForCompare(question._correctText);
    const matched = question.options.find((option) => {
      const normalizedOpt = normalizeForCompare(option.text);
      return normalizedOpt.includes(normalizedCorrectText) || normalizedCorrectText.includes(normalizedOpt);
    });
    if (matched) question.answer = matched.key;
  }

  delete question._correctText;
}

function finalizeParsedQuestions(questions) {
  for (const question of questions) {
    resolveQuestionAnswer(question);
  }
  return questions.filter((question) => question.text.length > 5 && question.options.length >= 2);
}

function extractTrailingAnswerKey(lines, initialMap) {
  const mergedAnswerMap = { ...initialMap };
  const headerRegex = /^(?:daftar\s+)?(?:kunci\s*jawaban|answer\s*key|kunci\s*soal|pembahasan\s*soal)\b/i;
  const numAnsRegex = /^(\d+)[.)]\s*([A-E])\b/i;
  const noAnsRegex = /no\.?\s*(\d+)\s*[=:]\s*([A-E])\b/i;

  for (let index = 5; index < lines.length; index++) {
    if (!headerRegex.test(lines[index])) continue;
    let foundKeys = 0;
    for (let j = index; j < lines.length; j++) {
      const match = numAnsRegex.exec(lines[j]) || noAnsRegex.exec(lines[j]);
      if (match) {
        foundKeys++;
        mergedAnswerMap[Number.parseInt(match[1], 10)] = match[2].toUpperCase();
      }
    }
    if (foundKeys >= 2) {
      return { workLines: lines.slice(0, index), mergedAnswerMap };
    }
  }
  return { workLines: lines, mergedAnswerMap };
}

function handleOptionMatch(line, optionMatch, current) {
  const optKey = optionMatch[1].toUpperCase();
  const optText = optionMatch[2].trim();
  const isColonSpeaker = /^[A-E]:\s/.test(line);

  if (!isColonSpeaker && optKey === 'A' && current.options.length > 0 && current.options.every((o) => o._isColon || o.key !== 'A')) {
    const stemText = current.options
      .map((o) => (o._isColon ? `${o.key}: ${o.text}` : `${o.key}. ${o.text}`))
      .join(' ');
    current.text = current.text ? `${current.text} ${stemText}` : stemText;
    current.options = [];
  }

  if (isColonSpeaker && current.options.some((o) => o.key === optKey)) {
    const dialogueText = current.options.map((o) => `${o.key}: ${o.text}`).join(' ');
    current.text = current.text ? `${current.text} ${dialogueText} ${line}` : `${dialogueText} ${line}`;
    current.options = [];
    return;
  }

  current.options.push({ key: optKey, text: optText, _isColon: isColonSpeaker });
}

function appendContinuation(line, current) {
  const lastOption = current.options.at(-1);
  if (lastOption) {
    lastOption.text += ` ${line}`;
  } else {
    current.text = current.text ? `${current.text} ${line}` : line;
  }
}

const STANDARD_QUESTION_REGEX = /^(?:(?:Soal|No\.?|Pertanyaan)\s*)?(\d+)(?:\s*\([a-z]\))?\s*[.):-]\s*(.*)/i;
const STANDARD_OPTION_REGEX = /^[([]?([A-E])\s*[.):\]]\s*(.*)/i;
const INLINE_ANSWER_REGEX = /^(?:Jawaban(?:\s+yang\s+benar)?|Kunci(?:\s+jawaban)?|Answer)\s*[:=-]\s*(.*)/i;
const EXPLANATION_START_REGEX = /^(?:Cara\s*hitung(?:\s*\/\s*pembahasan)?|Pembahasan|Penjelasan|Keterangan|Catatan)\s*[:=-]/i;

function processStandardLine(line, state) {
  const questionMatch = /^\d+\.\d/.test(line) ? null : STANDARD_QUESTION_REGEX.exec(line);
  const matchedNum = questionMatch ? Number.parseInt(questionMatch[1], 10) : null;
  const isSequentialNext = Boolean(state.current && matchedNum === state.current.num + 1 && matchedNum > 1);
  if (questionMatch && (!state.current || state.current.options.length >= 2 || isSequentialNext)) {
    if (state.current) state.questions.push(state.current);
    const nextNum = matchedNum;
    state.current = {
      num: nextNum,
      text: (questionMatch[2] || '').trim(),
      options: [],
      answer: state.mergedAnswerMap[nextNum] || '',
      explanation: ''
    };
    state.inExplanation = false;
    return;
  }

  const current = state.current;
  if (!current) return;

  const inlineAnswerMatch = INLINE_ANSWER_REGEX.exec(line);
  if (inlineAnswerMatch) {
    const ansLetter = /^([A-E])\b/i.exec(inlineAnswerMatch[1].trim());
    if (ansLetter && !current.answer) {
      current.answer = ansLetter[1].toUpperCase();
    }
    return;
  }

  if (state.inExplanation || EXPLANATION_START_REGEX.test(line)) {
    state.inExplanation = true;
    current.explanation = current.explanation ? `${current.explanation} ${line}` : line;
    return;
  }

  const optionMatch = STANDARD_OPTION_REGEX.exec(line);
  if (optionMatch) {
    handleOptionMatch(line, optionMatch, current);
    return;
  }

  appendContinuation(line, current);
}

function parseQuestionsStandard(lines, answerMap = {}) {
  const { workLines, mergedAnswerMap } = extractTrailingAnswerKey(lines, answerMap);
  const state = { questions: [], current: null, inExplanation: false, mergedAnswerMap };

  for (const line of workLines) {
    processStandardLine(line, state);
  }

  if (state.current) state.questions.push(state.current);
  return finalizeParsedQuestions(state.questions);
}

const LMS_META_PATTERNS = [
  /^(?:Correct|Incorrect|Partially\s+correct|Not\s+answered|Finish\s+review)/i,
  /^(?:Mark\s+[\d.]+|Score\s+[\d.]+|Flag|Question\s+\d+\s*$)/i,
  /^(?:Started\s+on|State:|Completed\s+on|Time\s+taken|Grade|Maximum|Question\s+text)/i,
  /^(?:out\s+of\s+[\d.]+|[\d.]+\s+out\s+of)/i
];
const LMS_QUESTION_HEADER_REGEX = /^Question\s+(\d+)\s*$/i;
const LMS_CORRECT_LINE_REGEX = /^(?:The\s+correct\s+answer\s+is|Correct\s+answer|Jawaban\s+yang\s+benar)[:\s]/i;

function isLmsMetaLine(line) {
  return LMS_META_PATTERNS.some((rx) => rx.test(line));
}

function processLmsLine(line, state) {
  const questionMatch = LMS_QUESTION_HEADER_REGEX.exec(line);
  if (questionMatch) {
    if (state.current && state.current.options.length >= 2) state.questions.push(state.current);
    const num = Number.parseInt(questionMatch[1], 10);
    state.current = { num, text: '', options: [], answer: state.answerMap[num] || '', _correctText: '' };
    state.skipMeta = true;
    return;
  }

  const current = state.current;
  if (!current) return;
  if (isLmsMetaLine(line)) {
    state.skipMeta = false;
    return;
  }
  if (LMS_CORRECT_LINE_REGEX.test(line)) {
    current._correctText = line.replace(LMS_CORRECT_LINE_REGEX, '').trim().toLowerCase();
    return;
  }

  const optionMatch = STANDARD_OPTION_REGEX.exec(line);
  if (optionMatch) {
    current.options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
    return;
  }

  const lastOption = current.options.at(-1);
  if (lastOption) {
    lastOption.text += ` ${line}`;
  } else if (!state.skipMeta && line.length > 3) {
    current.text += `${current.text ? ' ' : ''}${line}`;
  }
}

function parseQuestionsLMS(lines, answerMap = {}) {
  const state = { questions: [], current: null, skipMeta: false, answerMap };

  for (const line of lines) {
    processLmsLine(line, state);
  }

  if (state.current && state.current.options.length >= 2) state.questions.push(state.current);
  return finalizeParsedQuestions(state.questions);
}

function checkOptionIntegrity(question, errors, warnings) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length === 0) {
    errors.push('Soal tidak memiliki opsi jawaban.');
    return;
  }
  if (options.length < 4) warnings.push('Opsi jawaban kurang dari 4.');
  if (options.length > 5) warnings.push('Opsi jawaban berlebih (> 5), kemungkinan soal berikutnya ikut terbaca.');

  const normalizedSet = new Set();
  let hasEmpty = false;
  let hasDuplicate = false;
  let sequenceBroken = false;

  options.forEach((opt, idx) => {
    const optText = (opt?.text || '').trim().toLowerCase();
    if (!optText) hasEmpty = true;
    else if (normalizedSet.has(optText)) hasDuplicate = true;
    else normalizedSet.add(optText);

    const expectedKey = String.fromCodePoint(65 + idx);
    if (opt?.key && opt.key !== expectedKey) sequenceBroken = true;
  });

  if (hasEmpty) warnings.push('Ada opsi jawaban yang kosong.');
  if (hasDuplicate) warnings.push('Ada opsi jawaban yang duplikat.');
  if (sequenceBroken) {
    const keys = options.map((opt) => opt.key || '?').join(', ');
    warnings.push(`Urutan opsi melompat (${keys}), kemungkinan ada opsi yang gagal terbaca.`);
  }
}

function checkTextQuality(question, errors, warnings) {
  const text = (question.text || '').trim();
  if (!text || text.length < 5) {
    errors.push('Teks soal terlalu pendek atau kosong.');
    return;
  }
  if (text.length > 1500) {
    warnings.push('Teks soal sangat panjang (> 1500 karakter), kemungkinan soal berikutnya ikut tergabung.');
  }
  if (/\b(?:catatan|sumber)\s*:|https?:\/\/|www\.|\bpage\s+\d+\s+of\s+\d+/i.test(text)) {
    warnings.push('Teks mengandung metadata atau URL bocor yang perlu dibersihkan.');
  }

  const lowText = text.toLowerCase();
  if ((lowText.includes('gambar di bawah') || lowText.includes('perhatikan gambar')) && !question.image) {
    warnings.push('Soal mungkin membutuhkan gambar yang hilang.');
  }
  if (lowText.includes('tabel berikut')) {
    warnings.push('Soal mungkin mengandung tabel yang gagal terekstrak.');
  }
}

function validateParsedQuiz(questions) {
  let validCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  const seenNums = new Set();
  const duplicates = [];

  questions.sort((a, b) => a.num - b.num);
  questions.forEach((question) => {
    if (seenNums.has(question.num)) duplicates.push(question.num);
    seenNums.add(question.num);
  });

  const missingNums = [];
  if (questions.length > 0) {
    const min = questions[0].num;
    const max = questions.at(-1).num;
    for (let num = min; num <= max; num++) {
      if (!seenNums.has(num)) missingNums.push(num);
    }
  }

  questions.forEach((question) => {
    question.errors = [];
    question.warnings = [];

    checkTextQuality(question, question.errors, question.warnings);
    checkOptionIntegrity(question, question.errors, question.warnings);

    if (!question.answer) question.warnings.push('Jawaban benar belum diatur.');
    else if (!question.options.some((option) => option.key === question.answer)) {
      question.warnings.push(`Kunci jawaban (${question.answer}) tidak ada di opsi.`);
    }

    if (duplicates.includes(question.num)) {
      question.errors.push('Nomor soal duplikat. Perbaiki sebelum publish agar jawaban tidak tertukar.');
    }

    if (question.errors.length > 0) {
      question.status = 'error';
      errorCount++;
    } else if (question.warnings.length > 0) {
      question.status = 'warning';
      warningCount++;
    } else {
      question.status = 'valid';
      validCount++;
    }
  });

  const total = questions.length;
  const qualityScore = total > 0
    ? Math.round(((validCount * 1) + (warningCount * 0.5)) / total * 100)
    : 0;

  return {
    questions,
    stats: {
      total,
      valid: validCount,
      warning: warningCount,
      error: errorCount,
      missingNums,
      duplicateNums: [...new Set(duplicates)],
      qualityScore
    }
  };
}

// --- Auto-exports to window ---
window.extractPdfText = extractPdfText;
window.generateQuizDescription = generateQuizDescription;
window.normalizePdfText = normalizePdfText;
window.parseAnswerKey = parseAnswerKey;
window.parseQuestions = parseQuestions;
window.validateParsedQuiz = validateParsedQuiz;
