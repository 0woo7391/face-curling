// MediaPipe 로더를 ES 모듈로 감싸 번들에 포함하고, wasm 바이너리를 public/에 복사한다.
// 로더를 <script>로 따로 불러오지 않으므로 외부 스크립트를 막는 환경(아티팩트 등)에서도 동작한다.
// npm install 후 자동 실행 (postinstall).
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';

const src = 'node_modules/@mediapipe/tasks-vision/wasm';
mkdirSync('src/vendor', { recursive: true });
mkdirSync('public/mediapipe', { recursive: true });
let loader = readFileSync(`${src}/vision_wasm_internal.js`, 'utf8');
// ES 모듈은 strict mode라 블록 안 함수 선언이 블록 밖에서 안 보인다 → 그 한 곳을 console.warn으로 바꾼다
const sloppy = 'if(typeof custom_dbg==="undefined"){function custom_dbg(text){console.warn.apply(console,arguments)}}custom_dbg(';
if (!loader.includes(sloppy)) throw new Error('MediaPipe 로더 형식이 바뀜: tools/vendor-mediapipe.mjs 패치 확인 필요');
loader = loader.replace(sloppy, 'console.warn(');
writeFileSync('src/vendor/vision_wasm_loader.js', `/* eslint-disable */\n// 자동 생성 (tools/vendor-mediapipe.mjs) — 수정하지 말 것\n${loader}\nexport default ModuleFactory;\n`);
copyFileSync(`${src}/vision_wasm_internal.wasm`, 'public/mediapipe/vision_wasm_internal.wasm');
console.log('mediapipe vendored');
