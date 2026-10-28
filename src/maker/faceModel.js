// MediaPipe Face Landmarker 로딩 (명세 3.3 [확정]). 처음 쓸 때 한 번만 불러온다.
// 로더는 번들에 포함(tools/vendor-mediapipe.mjs), wasm·모델은 ./mediapipe/에서 같은 출처로 받는다.
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import ModuleFactory from '../vendor/vision_wasm_loader.js';

let pending = null;

/**
 * 모델 바이트. 아티팩트 배포처럼 이진 파일(.task)을 내보낼 수 없는 곳에서는
 * 빌드 때 base64 텍스트로 바꾼 파일(face_landmarker.task.b64.txt)을 받아 되돌린다 (__MODEL_AS_TEXT__).
 */
async function modelBytes(base) {
  if (typeof __MODEL_AS_TEXT__ !== 'undefined' && __MODEL_AS_TEXT__) {
    const b64 = (await (await fetch(`${base}face_landmarker.task.b64.txt`)).text()).trim();
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const res = await fetch(`${base}face_landmarker.task`);
  if (!res.ok) throw new Error(`모델을 받지 못했어요 (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function loadLandmarker(base = './mediapipe/') {
  pending ??= (async () => {
    self.ModuleFactory = ModuleFactory; // wasmLoaderPath를 비우면 MediaPipe가 이것을 그대로 쓴다
    return FaceLandmarker.createFromOptions(
      { wasmLoaderPath: '', wasmBinaryPath: `${base}vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetBuffer: await modelBytes(base), delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 3 },
    );
  })().catch((err) => {
    pending = null; // 실패하면 다음에 다시 시도
    throw err;
  });
  return pending;
}

/** 연결 목록 (geometry.partPolygons용) */
export const CONNECTIONS = {
  eyeA: FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  eyeB: FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  browA: FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
  browB: FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
  lips: FaceLandmarker.FACE_LANDMARKS_LIPS,
  oval: FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
};

/** 가장 큰 얼굴의 랜드마크 (정규화 좌표). 얼굴이 없으면 null */
export async function detectFace(image) {
  const lm = await loadLandmarker();
  const res = lm.detect(image);
  const faces = res.faceLandmarks ?? [];
  if (!faces.length) return null;
  const size = (f) => {
    const xs = f.map((p) => p.x);
    const ys = f.map((p) => p.y);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  return { landmarks: faces.reduce((a, b) => (size(b) > size(a) ? b : a)), count: faces.length };
}
