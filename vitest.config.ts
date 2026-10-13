import { defineConfig } from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@mergefoo/platform-store':fileURLToPath(new URL('./src/server/state/platform-cloudflare.ts',import.meta.url))}},test: { include: ['src/**/*.test.ts'], environment: 'node' } });
