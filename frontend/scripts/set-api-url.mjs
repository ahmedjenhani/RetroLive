// Writes public/config.json from the API_URL environment variable.
// It runs before every build (see "prebuild" in package.json), so the same source can be built for
// localhost, Docker (API_URL="" means "same origin", with nginx proxying the API) or Vercel
// (API_URL=https://my-api.onrender.com).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const apiUrl = process.env.API_URL;
if (apiUrl === undefined) {
  console.log('API_URL not set: keeping public/config.json as it is');
} else {
  const file = fileURLToPath(new URL('../public/config.json', import.meta.url));
  writeFileSync(file, JSON.stringify({ apiUrl: apiUrl.replace(/\/+$/, '') }, null, 2) + '\n');
  console.log(`public/config.json -> apiUrl = "${apiUrl}"`);
}
