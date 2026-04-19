const fs = require('fs');

const code = fs.readFileSync('server.js', 'utf8');
const lines = code.split('\n');

let stack = [];  // Stack of {, (, [
let inString = false;
let stringChar = null;

for (let lineNum = 0; lineNum < lines.length; lineNum++) {
  const line = lines[lineNum];
  let inLineString = inString;
  let inLineStringChar = stringChar;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : '';
    
    // Skip line comments
    if (i < line.length - 1 && char === '/' && line[i + 1] === '/') break;

    // Handle strings
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

    // Track brackets
    if (char === '{') {
      stack.push({ type: '{', line: lineNum + 1, col: i + 1 });
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1].type === '{') {
        stack.pop();
      } else {
        console.log(`ERROR: Extra } at line ${lineNum + 1}, col ${i + 1}`);
      }
    } else if (char === '(') {
      stack.push({ type: '(', line: lineNum + 1, col: i + 1 });
    } else if (char === ')') {
      if (stack.length > 0 && stack[stack.length - 1].type === '(') {
        stack.pop();
      } else {
        console.log(`ERROR: Extra ) at line ${lineNum + 1}, col ${i + 1}`);
      }
    } else if (char === '[') {
      stack.push({ type: '[', line: lineNum + 1, col: i + 1 });
    } else if (char === ']') {
      if (stack.length > 0 && stack[stack.length - 1].type === '[') {
        stack.pop();
      } else {
        console.log(`ERROR: Extra ] at line ${lineNum + 1}, col ${i + 1}`);
      }
    }
  }
  inString = inLineString;
  stringChar = inLineStringChar;
}

console.log('\n=== UNCLOSED BRACKETS ===');
if (stack.length === 0) {
  console.log('All brackets are properly matched!');
} else {
  console.log(`Found ${stack.length} unclosed bracket(s):`);
  stack.forEach((item, idx) => {
    console.log(`${idx + 1}. ${item.type} at line ${item.line}, column ${item.col}`);
    // Show the line content
    const lineContent = lines[item.line - 1];
    console.log(`   Line: ${lineContent}`);
  });
}

