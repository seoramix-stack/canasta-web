const fs = require('fs');

const code = fs.readFileSync('server.js', 'utf8');
const lines = code.split('\n');

let stack = [];
let inString = false;
let stringChar = null;
let bracketNum = 0;

for (let lineNum = 360; lineNum < 370; lineNum++) {
  const line = lines[lineNum];
  console.log(`Line ${lineNum + 1}: ${line}`);
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : '';
    
    if (i < line.length - 1 && char === '/' && line[i + 1] === '/') break;
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      bracketNum++;
      stack.push({ type: '{', num: bracketNum, line: lineNum + 1, col: i + 1 });
      console.log(`  [${bracketNum}] OPEN { at col ${i + 1}`);
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1].type === '{') {
        const open = stack.pop();
        console.log(`  [${open.num}] CLOSE } col ${i + 1} -> matches OPEN at ${open.line}:${open.col}`);
      }
    } else if (char === '(') {
      bracketNum++;
      stack.push({ type: '(', num: bracketNum, line: lineNum + 1, col: i + 1 });
      console.log(`  [${bracketNum}] OPEN ( at col ${i + 1}`);
    } else if (char === ')') {
      if (stack.length > 0 && stack[stack.length - 1].type === '(') {
        const open = stack.pop();
        console.log(`  [${open.num}] CLOSE ) col ${i + 1} -> matches OPEN at ${open.line}:${open.col}`);
      }
    }
  }
}

console.log('\n=== Remaining unmatched ===');
stack.forEach(item => {
  console.log(`[${item.num}] ${item.type} at line ${item.line}, col ${item.col}`);
});

// Now check around line 1413
console.log('\n\n=== AROUND LINE 1413 ===');
for (let lineNum = 1410; lineNum < 1420; lineNum++) {
  if (lineNum >= lines.length) break;
  const line = lines[lineNum];
  console.log(`Line ${lineNum + 1}: ${line}`);
}

