// 만든 얼굴을 이 브라우저에 저장 (명세 7.2: IndexedDB). 실패해도 게임은 기본 얼굴로 동작한다.
import { stickerOutline } from './extract.js';
const DB = 'face-curling';
const STORE = 'faces';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/webp', 0.95));

async function toCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return c;
}

export async function saveFace(face) {
  try {
    const parts = {};
    for (const [id, p] of Object.entries(face.parts)) parts[id] = { rect: p.rect, anchor: p.anchor, png: await toBlob(p.canvas) };
    const rec = { schemaVersion: 1, savedAt: Date.now(), faceBox: face.faceBox, crop: await toBlob(face.crop), empty: await toBlob(face.empty), parts };
    await tx('readwrite', (s) => s.put(rec, KEY));
    return true;
  } catch (err) {
    console.warn('얼굴 저장 실패', err);
    return false;
  }
}

export async function loadFace() {
  try {
    const rec = await tx('readonly', (s) => s.get(KEY));
    if (!rec || rec.schemaVersion !== 1) return null;
    const parts = {};
    for (const [id, p] of Object.entries(rec.parts)) {
      const part = { rect: p.rect, anchor: p.anchor, canvas: await toCanvas(p.png) };
      parts[id] = { ...part, outline: stickerOutline(part) };
    }
    return { faceBox: rec.faceBox, crop: await toCanvas(rec.crop), empty: await toCanvas(rec.empty), parts };
  } catch (err) {
    console.warn('얼굴 불러오기 실패', err);
    return null;
  }
}

export async function clearFace() {
  try {
    await tx('readwrite', (s) => s.delete(KEY));
  } catch {
    /* 무시 */
  }
}
