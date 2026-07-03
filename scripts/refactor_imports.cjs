const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, '../functions/api');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory() && !file.includes('shared')) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk(apiDir);
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace import statement
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"](?:\.\.\/)+_shared\.js['"];?/g;
  
  let newContent = content.replace(importRegex, (match, importsStr) => {
    const imports = importsStr.split(',').map(i => i.trim()).filter(Boolean);
    const authImports = [];
    const supabaseImports = [];
    const responseImports = [];
    const quizImports = [];
    
    imports.forEach(i => {
      if (['extractBearerToken', 'getUserFromToken', 'requireAdmin', 'requireUser'].includes(i)) authImports.push(i);
      else if (['getServiceConfigError', 'getSupabaseConfigError', 'supabaseFetch', 'getProfile'].includes(i)) supabaseImports.push(i);
      else if (['sendJson', 'readJson'].includes(i)) responseImports.push(i);
      else if (['isDraftTitle', 'encryptAnswer', 'decryptAnswer', 'sanitizeQuestion', 'prepareQuestionsForStorage', 'resolveStoredAnswer', 'getQuizById'].includes(i)) quizImports.push(i);
    });
    
    const depth = file.split(path.sep).length - apiDir.split(path.sep).length;
    const prefix = depth === 1 ? './shared' : '../shared';
    
    let result = '';
    if (authImports.length) result += `import { ${authImports.join(', ')} } from '${prefix}/auth.js';\n`;
    if (supabaseImports.length) result += `import { ${supabaseImports.join(', ')} } from '${prefix}/supabase.js';\n`;
    if (responseImports.length) result += `import { ${responseImports.join(', ')} } from '${prefix}/response.js';\n`;
    if (quizImports.length) result += `import { ${quizImports.join(', ')} } from '${prefix}/quiz.js';\n`;
    return result.trim();
  });
  
  // Fix supabaseFetch syntax:
  // if (!rows.ok) -> removed
  // rows.json() -> rows
  newContent = newContent.replace(/const (\w+) = await supabaseFetch(.*);\s+if \(!\1\.ok\) \{[^}]+\}\s+const (\w+) = await \1\.json\(\);/g, 'const $3 = await supabaseFetch$2;');
  newContent = newContent.replace(/const (\w+) = await supabaseFetch(.*);\s+const (\w+) = await \1\.json\(\);/g, 'const $3 = await supabaseFetch$2;');
  newContent = newContent.replace(/if \(!(\w+)\.ok\) \{[\s\S]*?throw new Error[^}]+\}\s+const (\w+) = await \1\.json\(\);/g, ''); // Handled above, mostly
  
  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Updated:', file);
  }
});
