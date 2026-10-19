import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/rules/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false } });
