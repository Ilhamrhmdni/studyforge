const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, '../functions/api');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    // Ignore the _shared directory!
    if (stat && stat.isDirectory() && !file.includes('_shared')) { 
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
  
  // Replace import { ... } from '../shared/...js' or '../../shared/...js'
  // Or even './shared/...js' (for the root api ones)
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"](?:\.\/|\.\.\/|\.\.\/\.\.\/)shared\/([^'"]+)['"];?/g;
  
  let newContent = content.replace(importRegex, (match, importsStr, moduleFile) => {
    const depth = file.split(path.sep).length - apiDir.split(path.sep).length;
    const prefix = depth === 1 ? '../_shared' : '../../_shared';
    return `import { ${importsStr.trim()} } from '${prefix}/${moduleFile}';`;
  });
  
  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Updated:', file);
  }
});
