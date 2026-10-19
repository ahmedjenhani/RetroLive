import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const url = process.env['TEST_DATABASE_URL'] ?? '';
if (!url) {
  throw new Error('TEST_DATABASE_URL is not set. Point it at a PostgreSQL database whose name ends with "_test".');
}

// The tests empty their tables between runs: never let them touch a database that is not clearly a test one.
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(`Refusing to run tests against "${dbName}": the database name must end with "_test".`);
}

process.env['DATABASE_URL'] = url;
process.env['NODE_ENV'] = 'test';
