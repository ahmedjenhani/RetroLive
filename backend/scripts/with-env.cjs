// Runs a command with the variables from the repository's .env file loaded.
// Example: node scripts/with-env.cjs prisma migrate deploy
// (Prisma only looks for .env in the folder it runs from, but ours lives one level up.)
const path = require('node:path');
const { spawnSync } = require('node:child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-env.cjs <command> [args...]');
  process.exit(2);
}
const result = spawnSync(command, args, { stdio: 'inherit', shell: true, env: process.env });
process.exit(result.status ?? 1);
