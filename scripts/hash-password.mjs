// Prints a salted scrypt hash for ADMIN_PASSWORD_HASH.
// Usage: npm run auth:hash -- "a long unique password"
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 14) {
  console.error('Usage: npm run auth:hash -- "your password (14 characters or more)"');
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
console.log(`${salt}:${scryptSync(password, salt, 64).toString("hex")}`);
