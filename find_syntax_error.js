const fs = require('fs');

const code = fs.readFileSync('server.js', 'utf8');
const lines = code.split('\n');

let braceCount = 0;
let parenCount = 0;
let bracketCount = 0;
let inString = false;
let stringChar = null;
let inRegex = false;
let braceStack = [];
let parenStack = [];

for (let lineNum = 0; lineNum < lines.length; lineNum++) {
  const line = lines[lineNum];
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : '';
    
    // Skip comments
    if (i < line.length - 1 && char === '/' && line[i + 1] === '/') break;
    
    // Handle strings
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      }
      continue;
    }
    
    if (inString) continue;
    
    // Track brackets
    if (char === '{') {
      braceCount++;
      braceStack.push({ line: lineNum + 1, col: i, char: '{' });
    } else if (char === '}') {
      braceCount--;
      if (braceStack.length > 0) braceStack.pop();
      if (braceCount < 0) {
        console.log(`EXTRA } at line ${lineNum + 1}, col ${i}`);
        console.log(`Line: ${line}`);
      }
    } else if (char === '(') {
      parenCount++;
      parenStack.push({ line: lineNum + 1, col: i });
    } else if (char === ')') {
      parenCount--;
      if (parenStack.length > 0) parenStack.pop();
      if (parenCount < 0) {
        console.log(`EXTRA ) at line ${lineNum + 1}, col ${i}`);
      }
    } else if (char === '[') {
      bracketCount++;
    } else if (char === ']') {
      bracketCount--;
    }
  }
}

console.log('\n=== Final Count ===');
console.log(`Braces: ${braceCount} (should be 0)`);
console.log(`Parentheses: ${parenCount} (should be 0)`);
console.log(`Brackets: ${bracketCount} (should be 0)`);

if (braceCount !== 0) {
  console.log('\n=== Unclosed Braces ===');
  braceStack.forEach(b => console.log(`  Line ${b.line}, Col ${b.col}: ${b.char}`));
}

if (parenCount !== 0) {
  console.log('\n=== Unclosed Parentheses ===');
  parenStack.forEach(p => console.log(`  Line ${p.line}, Col ${p.col}`));
}

