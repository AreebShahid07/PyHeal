const { healIndentation } = require('./out/healer');

const input = `def h(n):
if n>=0:
if n==0:
print("zero")
else:
print("pos")
else:
print("neg")`;

const result = healIndentation(input);
console.log("--- RESULT ---");
console.log(result);
console.log("--- END ---");
