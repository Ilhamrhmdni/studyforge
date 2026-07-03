// Fix: Remove PDF checkbox/marker symbols from quiz data on GitHub
const TOKEN = '<REMOVED_FOR_SECURITY>';
const OWNER = 'Ilhamrhmdni';
const DB_REPO = 'studyforge-db';
const QUIZ_ID = 'quiz-1782596237398';

function cleanText(s) {
  if (!s) return '';
  return s
    // Remove ALL unicode box/check/bullet/private-use characters
    .replace(/[\u25A0-\u25FF]/g, '')   // geometric shapes (□■◆◇etc)
    .replace(/[\u2600-\u26FF]/g, '')   // misc symbols (☐☑☒)
    .replace(/[\u2700-\u27BF]/g, '')   // dingbats (✓✗✔✘)
    .replace(/[\uF000-\uFFFF]/g, '')   // private use area (PDF fonts)
    .replace(/[\u00A0]/g, ' ')         // non-breaking space → space
    .replace(/\s{2,}/g, ' ')           // collapse multiple spaces
    .trim();
}

async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${DB_REPO}/contents/${path}`, {
    headers: { Authorization: `token ${TOKEN}`, 'User-Agent': 'StudyForge' }
  });
  const data = await r.json();
  const content = JSON.parse(Buffer.from(data.content.replace(/\n/g,''), 'base64').toString('utf8'));
  return { data: content, sha: data.sha };
}

async function ghPut(path, content, sha, msg) {
  const encoded = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${DB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'StudyForge' },
    body: JSON.stringify({ message: msg, content: encoded, sha, branch: 'main' })
  });
  if (!r.ok) throw new Error(await r.text());
}

const { data: quiz, sha } = await ghGet(`quizzes/${QUIZ_ID}.json`);

let cleaned = 0;
for (const q of quiz.questions) {
  const origText = q.text;
  q.text = cleanText(q.text);
  if (q.text !== origText) cleaned++;
  
  for (const opt of q.options) {
    const origOpt = opt.text;
    opt.text = cleanText(opt.text);
    if (opt.text !== origOpt) cleaned++;
  }
}

console.log(`Cleaned ${cleaned} fields`);
console.log('Sample Q4 opsi A:', quiz.questions[3]?.options[0]?.text);
console.log('Sample Q1 opsi A:', quiz.questions[0]?.options[0]?.text);

await ghPut(`quizzes/${QUIZ_ID}.json`, quiz, sha, 'Fix: Remove PDF checkbox symbols from quiz data');
console.log('✅ Quiz data updated on GitHub!');
