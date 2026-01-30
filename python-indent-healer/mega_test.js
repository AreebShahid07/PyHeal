const { healIndentation } = require('./out/healer');
const fs = require('fs');

const input = fs.readFileSync('d:/PyHeal/test.py', 'utf8');

const result = healIndentation(input);
fs.writeFileSync('d:/PyHeal/test_healed.py', result);

console.log("--- MEGA TEST COMPLETE ---");
console.log("Results saved to test_healed.py");
console.log("Verifying first 50 lines...");
console.log(result.split('\n').slice(0, 50).join('\n'));
console.log("...");
console.log("Verifying last 20 lines...");
console.log(result.split('\n').slice(-20).join('\n'));
