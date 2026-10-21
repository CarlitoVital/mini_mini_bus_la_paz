/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
