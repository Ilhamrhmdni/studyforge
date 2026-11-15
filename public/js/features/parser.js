// Parser helpers for StudyForge admin PDF import flow.

async function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function onLoad() {
      try {
        const buffer = /** @type {ArrayBuffer} */ (this.result);
        const typedArray = new Uint8Array(buffer);
        const pdf = await pdfjsLib.getDocument(typedArray).promise;
        let fullText = '';
        const pageImagesMap = {};

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const ops = await page.getOperatorList();

          let hasImage = false;
          for (let index = 0; index < ops.fnArray.length; index++) {
            if (ops.fnArray[index] === pdfjsLib.OPS.paintImageXObject) {
              hasImage = true;
              break;
            }
          }

          if (hasImage) {
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport }).promise;
            pageImagesMap[pageNumber] = canvas.toDataURL('image/jpeg', 0.8);
          } else {
            const pageText = textContent.items.map((item) => item.str).join(' ');
            fullText += `\n\n--- PAGE ${pageNumber} ---\n\n${pageText}`;
          }
        }

        resolve({ fullText, pageImagesMap, numPages: pdf.numPages });
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function generateQuizDescription(questionsText, geminiKey) {
  const model = 'gemini-2.0-flash'; // using stable model for text
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
  } catch (e) {
    return '';
  }
}

function normalizePdfText(text) {
  if (typeof normalizeText === 'function') {
    return normalizeText(text);
  }
  return String(text || '').replace(/[ \t]{2,}/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function parseAnswerKey(text) {
  const answerMap = {};
  const lines = String(text || '').split('\n');
  const regex = /^(?:no\s*)?(\d+)[.\s:]*(?:jawaban\s*:\s*)?([A-E])/i;

  for (const line of lines) {
    const match = line.trim().match(regex);
    if (match) {
      answerMap[parseInt(match[1], 10)] = match[2].toUpperCase();
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

function finalizeParsedQuestions(questions) {
  for (const question of questions) {
    if (typeof stripMarkers === 'function') {
      question.text = stripMarkers(question.text);
    }

    for (const option of question.options) {
      if (typeof hasCorrectMarker === 'function' && hasCorrectMarker(option.text) && !question.answer) {
        question.answer = option.key;
      }
      if (typeof stripMarkers === 'function') {
        option.text = stripMarkers(option.text);
      }
    }

    if (question._correctText && typeof normalizeForCompare === 'function') {
      const normalizedCorrectText = normalizeForCompare(question._correctText);
      for (const option of question.options) {
        const normalizedOptionText = normalizeForCompare(option.text);
        if (
          normalizedOptionText.includes(normalizedCorrectText) ||
          normalizedCorrectText.includes(normalizedOptionText)
        ) {
          question.answer = option.key;
          break;
        }
      }
    }

    delete question._correctText;
  }

  return questions.filter((question) => question.text.length > 5 && question.options.length >= 2);
}

function parseQuestionsStandard(lines, answerMap = {}) {
  let answerKeyStart = -1;
  for (let index = 0; index < lines.length; index++) {
    if (/kunci\s*jawaban|answer\s*key|pembahasan|kunci\s*soal/i.test(lines[index])) {
      answerKeyStart = index;
      break;
    }
  }

  const mergedAnswerMap = { ...answerMap };
  if (answerKeyStart > -1) {
    for (let index = answerKeyStart; index < lines.length; index++) {
      const match = lines[index].match(/^(\d+)[.)]\s*([A-Ea-e])\b/) ||
        lines[index].match(/no\.?\s*(\d+)\s*[=:]\s*([A-Ea-e])\b/i);
      if (match) {
        mergedAnswerMap[parseInt(match[1], 10)] = match[2].toUpperCase();
      }
    }
  }

  const workLines = answerKeyStart > 0 ? lines.slice(0, answerKeyStart) : lines;
  const questions = [];
  let current = null;

  for (const line of workLines) {
    const questionMatch = line.match(/^(\d+)[.)]\s+(.+)/);
    if (questionMatch) {
      const nextNum = parseInt(questionMatch[1], 10);
      if (current && nextNum <= current.num) {
        current.text += ` ${line}`;
        continue;
      }
      if (current) questions.push(current);
      current = {
        num: nextNum,
        text: questionMatch[2],
        options: [],
        answer: mergedAnswerMap[nextNum] || ''
      };
      continue;
    }

    if (!current) continue;

    const optionMatch = line.match(/^[(]?([A-Ea-e])[.)]\s+(.+)/);
    if (optionMatch) {
      current.options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2] });
      continue;
    }

    if (current.options.length > 0) {
      const lastOption = current.options[current.options.length - 1];
      if (lastOption) {
        lastOption.text += ` ${line}`;
      }
    } else {
      current.text += ` ${line}`;
    }
  }

  if (current) questions.push(current);
  return finalizeParsedQuestions(questions);
}

function parseQuestionsLMS(lines, answerMap = {}) {
  const questions = [];
  let current = null;
  let skipMeta = false;

  const isMetaLine = (line) =>
    /^(Correct|Incorrect|Partially\s+correct|Mark\s+[\d.]+|Flag|Question\s+\d+\s*$|Not\s+answered|Score\s+[\d.]+|Finish\s+review|Started\s+on|State:|Completed\s+on|Time\s+taken|Grade|Maximum|Question\s+text)/i.test(line) ||
    /^(out\s+of\s+[\d.]+|[\d.]+\s+out\s+of)/i.test(line);

  for (const line of lines) {
    const questionMatch = line.match(/^Question\s+(\d+)\s*$/i);
    if (questionMatch) {
      if (current && current.options.length >= 2) questions.push(current);
      const num = parseInt(questionMatch[1], 10);
      current = {
        num,
        text: '',
        options: [],
        answer: answerMap[num] || '',
        _correctText: ''
      };
      skipMeta = true;
      continue;
    }

    if (!current) continue;
    if (isMetaLine(line)) {
      skipMeta = false;
      continue;
    }

    if (/^(The\s+correct\s+answer\s+is|Correct\s+answer|Jawaban\s+yang\s+benar)[:\s]/i.test(line)) {
      current._correctText = line.replace(/^(The\s+correct\s+answer\s+is[:\s]|Correct\s+answer[:\s]|Jawaban\s+yang\s+benar[:\s])/i, '').trim().toLowerCase();
      continue;
    }

    const optionMatch = line.match(/^([A-Ea-e])[.)]\s+(.+)/);
    if (optionMatch) {
      current.options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2] });
      continue;
    }

    if (current.options.length > 0) {
      const lastOption = current.options[current.options.length - 1];
      if (lastOption) {
        lastOption.text += ` ${line}`;
      }
      continue;
    }

    if (!skipMeta && line.length > 3) {
      current.text += `${current.text ? ' ' : ''}${line}`;
    }
  }

  if (current && current.options.length >= 2) questions.push(current);
  return finalizeParsedQuestions(questions);
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
    const max = questions[questions.length - 1].num;
    for (let num = min; num <= max; num++) {
      if (!seenNums.has(num)) missingNums.push(num);
    }
  }

  questions.forEach((question) => {
    question.errors = [];
    question.warnings = [];

    if (!question.text || question.text.length < 5) question.errors.push('Teks soal terlalu pendek atau kosong.');
    if (question.options.length === 0) question.errors.push('Soal tidak memiliki opsi jawaban.');

    if (question.options.length > 0 && question.options.length < 4) question.warnings.push('Opsi jawaban kurang dari 4.');
    if (!question.answer) question.warnings.push('Jawaban benar belum diatur.');
    else if (!question.options.find((option) => option.key === question.answer)) question.warnings.push(`Kunci jawaban (${question.answer}) tidak ada di opsi.`);

    if (duplicates.includes(question.num)) question.errors.push('Nomor soal duplikat. Perbaiki sebelum publish agar jawaban tidak tertukar.');

    const lowText = question.text.toLowerCase();
    if ((lowText.includes('gambar di bawah') || lowText.includes('perhatikan gambar')) && !question.image) {
      question.warnings.push('Soal mungkin membutuhkan gambar yang hilang.');
    }
    if (lowText.includes('tabel berikut')) {
      question.warnings.push('Soal mungkin mengandung tabel yang gagal terekstrak.');
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
