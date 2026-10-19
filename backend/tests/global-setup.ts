import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';

/** Brings the test database up to date with the latest migrations before any test runs. */
export default function setup(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set.');
  }
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
