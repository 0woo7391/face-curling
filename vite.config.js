import { defineConfig } from 'vite';

// GitHub Pages 하위 경로(/<repo>/)에서도 동작하도록 상대 경로로 빌드 (명세 7.1).
// ARTIFACT=1: 한 파일로 묶어 올리는 배포용 — 지연 로딩 조각까지 하나의 JS에 넣고,
//             이진 모델(.task)은 base64 텍스트(face_landmarker.task.b64.txt)로 받는다.
const single = process.env.ARTIFACT === '1';

export default defineConfig({
  base: './',
  define: { __MODEL_AS_TEXT__: JSON.stringify(single) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 5000,
    rolldownOptions: single ? { output: { codeSplitting: false } } : undefined,
  },
});
