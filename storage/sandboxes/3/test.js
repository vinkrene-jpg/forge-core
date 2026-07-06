const { add } = require("./index.js");
if (add(2, 3) !== 5) { console.error("FAIL: add"); process.exit(1); }
if (process.env.DATABASE_URL || process.env.SESSION_SECRET) { console.error("SECURITY FAIL: secrets visible"); process.exit(1); }
console.log("all tests passed");
