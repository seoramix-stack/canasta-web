const fs = require('fs');

const code = fs.readFileSync('server.js', 'utf8');
const lines = code.split('\n');

let stack = [];
let inString = false;
let stringChar = null;

for (let lineNum = 0; lineNum < lines.length; lineNum++) {
  const line = lines[lineNum];
  let inLineString = inString;
  let inLineStringChar = stringChar;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : '';
    
    if (i < line.length - 1 && char === '/' && line[i + 1] === '/') break;
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inLineString) {
        inLineString = true;
        inLineStringChar = char;
      } else if (char === inLineStringChar) {
        inLineString = false;
        inLineStringChar = null;
      }
      continue;
    }
    if (inLineString) continue;

    if (char === '{') {
      stack.push({ type: '{', line: lineNum + 1, col: i + 1, context: line.substring(Math.max(0, i - 10), Math.min(line.length, i + 20)) });
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1].type === '{') {
        stack.pop();
      } else if (stack.length > 0) {
        console.log(`ERROR At line ${lineNum + 1}, col ${i + 1}: } trying to close ${stack[stack.length - 1].type} opened at line ${stack[stack.length - 1].line}`);
        break;
      }
    } else if (char === '(') {
      stack.push({ type: '(', line: lineNum + 1, col: i + 1, context: line.substring(Math.max(0, i - 10), Math.min(line.length, i + 20)) });
    } else if (char === ')') {
      if (stack.length > 0 && stack[stack.length - 1].type === '(') {
        stack.pop();
      } else if (stack.length > 0) {
        console.log(`ERROR At line ${lineNum + 1}, col ${i + 1}: ) trying to close ${stack[stack.length - 1].type} opened at line ${stack[stack.length - 1].line}`);
        break;
      }
    }
  }
  inString = inLineString;
  stringChar = inLineStringChar;
}

console.log('\n=== UNCLOSED ===');
if (stack.length > 0) {
  stack.forEach(item => {
    console.log(`${item.type} at line ${item.line}, col ${item.col}`);
    console.log(`  Context: ...${item.context}...`);
  });
} else {
  console.log('All brackets matched!');
}
