import { defineConfig } from 'vitest/config';
import { builtinModules } from 'node:module';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      fileName: 'index',
      formats: ['cjs']
    },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]
    },
    sourcemap: true
  },
  plugins: [],
  test: {
    coverage: {
      exclude: ['src/forgejo-client/**'],
      include: ['src/**'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'html']
    },
    projects: [
      {
        test: {
          clearMocks: true,
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
          name: 'unit',
          restoreMocks: true,
          unstubEnvs: true,
          unstubGlobals: true
        }
      },
      {
        test: {
          clearMocks: true,
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          name: 'integration',
          restoreMocks: true,
          testTimeout: 30_000,
          unstubEnvs: true,
          unstubGlobals: true
        }
      },
      {
        test: {
          environment: 'node',
          globalSetup: ['test/e2e/global-setup.ts'],
          hookTimeout: 300_000,
          include: ['test/e2e/**/*.spec.ts'],
          name: 'e2e',
          testTimeout: 300_000
        }
      }
    ]
  }
});
