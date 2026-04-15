import { defineConfig } from 'vite';
import { builtinModules } from 'module';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['cjs'],
      fileName: 'index'
    },
    sourcemap: true,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]
    }
  },
  plugins: []
});
