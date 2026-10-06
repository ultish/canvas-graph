import { defineConfig } from 'vite';
import { extensions, ember, classicEmberSupport } from '@embroider/vite';
import { babel } from '@rollup/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

// For scenario testing
const isCompat = Boolean(process.env.ENABLE_COMPAT_BUILD);

// `vite build --out-dir dist-tests` builds the QUnit suite; any other build is the demo app (GitHub Pages)
const isTestBuild = process.argv.includes('dist-tests');

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/ (the Pages workflow sets ROOT_URL)
  base: process.env.ROOT_URL || '/',
  plugins: [
    ...(isCompat ? [classicEmberSupport()] : []),
    tailwindcss(),
    ember(),
    babel({
      babelHelpers: 'inline',
      extensions,
    }),
  ],
  build: {
    rollupOptions: {
      input: isTestBuild
        ? { tests: 'tests/index.html' }
        : { main: 'index.html' },
    },
  },
});
