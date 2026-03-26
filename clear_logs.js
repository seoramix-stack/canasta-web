const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, 'human_training_data.jsonl');

try {
    if (fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, ''); // Overwrites the file with an empty string
        console.log("Successfully cleared human_training_data.jsonl");
    } else {
        console.log("File not found, nothing to clear.");
    }
} catch (err) {
    console.error("Error clearing file:", err);
}