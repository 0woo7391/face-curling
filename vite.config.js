import { defineConfig } from 'vite';

// GitHub Pages 하위 경로(/<repo>/)에서도 동작하도록 상대 경로로 빌드 (명세 7.1)
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
