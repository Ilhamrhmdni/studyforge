const fs = require('fs');
const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN || 'YOUR_TOKEN';
const OWNER = 'Ilhamrhmdni';
const REPO  = 'studyforge';

// Files to push in order
const FILES = [
  { local: 'public/js/site-config.js', remote: 'public/js/site-config.js' },
  { local: 'public/css/style.css',     remote: 'public/css/style.css' },
  { local: 'public/js/normalize.js',   remote: 'public/js/normalize.js' },
  { local: 'public/index.html',        remote: 'public/index.html' },
  { local: 'public/quiz.html',         remote: 'public/quiz.html' },
  { local: 'public/result.html',       remote: 'public/result.html' },
  { local: 'public/admin.html',        remote: 'public/admin.html' },
  { local: 'public/js/auth.js',        remote: 'public/js/auth.js' },
  { local: 'public/login.html',        remote: 'public/login.html' },
  { local: 'vercel.json',              remote: 'vercel.json' }
];

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/contents/${path}`,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'StudyForge',
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function pushFile(local, remote) {
  const content = fs.readFileSync(local).toString('base64');
  let sha;
  try {
    const existing = await apiRequest('GET', remote);
    sha = existing.sha;
  } catch {}

  const result = await apiRequest('PUT', remote, {
    message: `StudyForge: update ${remote}`,
    content,
    ...(sha ? { sha } : {}),
    branch: 'main'
  });

  if (result.content) {
    console.log(`✅ ${remote}`);
  } else {
    console.log(`❌ ${remote}: ${JSON.stringify(result.message || result)}`);
  }
}

(async () => {
  console.log(`\nPushing ${FILES.length} files to ${OWNER}/${REPO}...\n`);
  for (const f of FILES) {
    await pushFile(f.local, f.remote);
  }
  console.log('\n✅ All done! Vercel will deploy in ~1 minute.\n');
})();
