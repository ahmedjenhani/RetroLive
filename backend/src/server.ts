import { createBackend } from './bootstrap';
import { loadConfig } from './config';

const config = loadConfig();
const backend = createBackend({ config });

if (!config.gemini.apiKey) {
  console.warn('[ai] GEMINI_API_KEY is not set: the AI summary button is disabled');
}

// No host on purpose: Node then listens on every interface for both IPv4 and IPv6. Forcing "0.0.0.0" would
// make "localhost" (which Windows resolves to IPv6 first) slow, and some platforms health-check over IPv6.
backend.httpServer.listen(config.port, () => {
  console.log(`[server] RetroLive API listening on port ${config.port} (${config.nodeEnv})`);
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`[server] ${signal} received, shutting down`);
  // give clients a moment to finish, but never hang a deploy
  setTimeout(() => process.exit(1), 10_000).unref();
  await backend.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
