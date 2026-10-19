import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source, so it has to be bundled into the server.
  noExternal: ['@retrolive/shared'],
});
