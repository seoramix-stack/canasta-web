const fs = require('fs');

const code = fs.readFileSync('server.js', 'utf8');
const lines = code.split('\n');

let stack = [];
let inString = false;
let stringChar = null;
let pairNum = 0;

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

    if (char === '(') {
      stack.push({ type: '(', line: lineNum + 1, col: i + 1 });
    } else if (char === ')') {
      if (stack.length > 0 && stack[stack.length - 1].type === '(') {
        const open = stack.pop();
        pairNum++;
        if ((open.line === 364 && open.col === 6) || (lineNum + 1 === 1413 && i + 1 === 2)) {
          console.log(`PAIR #${pairNum}: ( at ${open.line}:${open.col} <-> ) at ${lineNum + 1}:${i + 1}`);
        }
      }
    } else if (char === '{') {
      stack.push({ type: '{', line: lineNum + 1, col: i + 1 });
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1].type === '{') {
        const open = stack.pop();
        pairNum++;
        if ((open.line === 364 && open.col === 39) || (lineNum + 1 === 1413 && i + 1 === 1)) {
          console.log(`PAIR #${pairNum}: { at ${open.line}:${open.col} <-> } at ${lineNum + 1}:${i + 1}`);
        }
      }
    }
  }
  inString = inLineString;
  stringChar = inLineStringChar;
}

console.log('\nTotal pairs found:', pairNum);
console.log('Unclosed opens:', stack.length);
stack.forEach((item, idx) => {
  console.log(`  ${idx + 1}. ${item.type} at ${item.line}:${item.col}`);
});
