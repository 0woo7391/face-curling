// Three.js 표현 계층 (명세 4장). 게임 상태를 읽기만 하고 바꾸지 않는다.
// 2D 물리 (x, y) ↔ 3D (X, Y=높이, Z) 단일 매핑: X = x, Z = -y.
//
// 피드백 원칙 (사용자 결정):
// - 글자 대신 크기·두께·색·소리로 '내 입력에 대한 반응'을 보여준다.
// - 어디에 두라는 정답 안내(예상 경로 점선, 멈출 곳 표시, 빗자루 위치 가이드, 정답 유령 표시)는 기본으로 보여주지 않는다.
import * as THREE from 'three';
import { FACE_BOX } from '../core/board.js';
import { LAUNCH } from '../core/game.js';
import { broomJudgeRadius } from '../core/sweep.js';
import { faceBoardTexture, puckTexture, labelTexture } from './textures.js';
import { Fx } from './fx.js';

const V = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_TOP = new THREE.Vector3(0, 0, -1); // 탑다운에서 화면 위 = 레인 진행 방향
const lerp = (a, b, t) => a + (b - a) * t;
const C = {
  broom: new THREE.Color('#5c6bc0'),
  good: new THREE.Color('#76ff03'),
  caution: new THREE.Color('#ffd600'),
  danger: new THREE.Color('#ff1744'),
  low: new THREE.Color('#4dd0e1'),
  powerLo: new THREE.Color('#66bb6a'),
  powerMid: new THREE.Color('#ffd600'),
  powerHi: new THREE.Color('#ff3d00'),
};

const basic = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide, toneMapped: false });

function flatRing(inner, outer, color, opacity, segments = 48) {
  const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, segments), basic(color, opacity));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** 바닥에 눕힌 단위 사각형. placeStrip으로 두 점 사이에 늘인다 */
function flatStrip(color, opacity = 1) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // 길이 방향 = 로컬 Z
  return new THREE.Mesh(geo, basic(color, opacity));
}

function placeStrip(mesh, a, b, width, h = 0.02) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  mesh.position.copy(V((a.x + b.x) / 2, (a.y + b.y) / 2, h));
  mesh.scale.set(width, 1, Math.max(1e-4, len));
  mesh.rotation.y = -Math.atan2(dx, dy);
}

function flatTriangle(color, halfWidth, length) {
  const shape = new THREE.Shape([new THREE.Vector2(-halfWidth, 0), new THREE.Vector2(halfWidth, 0), new THREE.Vector2(0, length)]);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // 꼭짓점 = 로컬 -Z = 월드 +y
  return new THREE.Mesh(geo, basic(color));
}

export class Renderer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // 터치 기기는 픽셀 비율을 낮춰 프레임 확보
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(coarse ? 1.5 : 2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 300);
    this.active = this.persp;
    this.rig = { pos: new THREE.Vector3(0, 6, 4), look: new THREE.Vector3(0, 0, -10), up: UP_Y.clone() };
    // showGhosts·showSensors는 디버그용 (정답 위치·판정 원 노출)
    this.options = { showSensors: false, showGhosts: false, showMinimap: true, laneTop: false };
    this.fallback = false; // Pointer Lock 불가 → 레인 탑다운 고정
    this.miniCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 300);
    this.minimapEl = null; // 미니맵을 그릴 위치는 HUD의 #minimap-frame 요소 위치를 따른다
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(UP_Y, 0);
    this.time = 0;
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }; // HUD가 가리는 가장자리 폭 (px)
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.portrait = h > w;
    this.persp.aspect = w / h;
    // 세로 화면: 가로 시야가 좁아지므로 FOV를 넓힌다
    this.persp.fov = this.portrait ? 68 : 50;
    this.applyInsets();
  }

  /**
   * HUD가 가리지 않는 영역(위 막대 아래 ~ 아래 조작부 위)의 가운데에 장면 중심이 오도록 화면을 옮긴다.
   * 버튼·패널이 스톤과 캐릭터를 가리지 않게 하기 위함.
   */
  setInsets(next) {
    const cur = this.insets;
    if (['top', 'bottom', 'left', 'right'].every((k) => Math.abs(next[k] - cur[k]) < 2)) return;
    this.insets = { ...next };
    this.applyInsets();
  }

  applyInsets() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const { top, bottom, left, right } = this.insets;
    const sx = (right - left) / 2;
    const sy = (bottom - top) / 2;
    for (const cam of [this.persp, this.ortho]) {
      if (Math.abs(sx) > 1 || Math.abs(sy) > 1) cam.setViewOffset(w, h, sx, sy, w, h);
      else cam.clearViewOffset();
    }
    this.persp.updateProjectionMatrix();
    this.ortho.updateProjectionMatrix();
  }

  /** 전체 화면 대비 HUD 없는 영역의 비율 — 탑다운에서 보드가 HUD 사이에 다 들어오게 */
  get safeScale() {
    const h = this.container.clientHeight;
    return h / Math.max(120, h - this.insets.top - this.insets.bottom);
  }

  get safeScaleX() {
    const w = this.container.clientWidth;
    return w / Math.max(120, w - this.insets.left - this.insets.right);
  }

  // ── 장면 구성 (재시작마다) ──

  build(game) {
    const { cfg } = game;
    this.cfg = cfg;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#18202c');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a5a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 12, 6);
    scene.add(sun);
    this.buildRink(game);

    // 정답 위치 (디버그 전용)
    this.ghosts = new THREE.Group();
    const r = cfg.stoneRadius;
    for (const p of game.parts) {
      const w = game.board.qToWorld(p.q);
      const ring = flatRing(r * 0.92, r * 1.08, p.color, 0.75);
      ring.position.copy(V(w.x, w.y, 0.006));
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.label, p.color), depthTest: false }));
      label.scale.set(0.62, 0.175, 1);
      label.position.copy(V(w.x + (p.side === 'L' ? -0.55 : 0.55), w.y, 0.15));
      this.ghosts.add(ring, label);
    }
    scene.add(this.ghosts);

    this.stoneMeshes = new Map();
    this.puckTextures = new Map(game.parts.map((p) => [p.id, puckTexture(p)]));
    this.buildThrowFeedback(game);
    this.buildCharacter();
    this.buildSweepFeedback(game);
    this.buildDebugSensors(game);
    this.fx = new Fx(scene);
  }

  buildRink(game) {
    const { cfg } = game;
    const scene = this.scene;
    const len = cfg.laneLength - cfg.backLimitY;
    const midY = (cfg.laneLength + cfg.backLimitY) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, len + 20), new THREE.MeshStandardMaterial({ color: '#2a3442' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(V(0, midY, -0.01));
    const ice = new THREE.Mesh(new THREE.PlaneGeometry(cfg.laneWidth, len), new THREE.MeshStandardMaterial({ color: '#eef5fa', roughness: 0.35 }));
    ice.rotation.x = -Math.PI / 2;
    ice.position.copy(V(0, midY, 0));
    scene.add(floor, ice);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, len), new THREE.MeshStandardMaterial({ color: sx < 0 ? '#e53935' : '#1e88e5' }));
      wall.position.copy(V(sx * (cfg.laneWidth / 2 + 0.08), midY, 0.11));
      scene.add(wall);
    }
    const stripe = (y, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(cfg.laneWidth, 0.05), basic(color));
      m.rotation.x = -Math.PI / 2;
      m.position.copy(V(0, y, 0.003));
      scene.add(m);
    };
    stripe(0, '#d32f2f');
    stripe(cfg.laneLength, '#1565c0');
    const B = cfg.boardSize;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(B, B), new THREE.MeshStandardMaterial({ map: faceBoardTexture(FACE_BOX), roughness: 0.6 }));
    board.rotation.x = -Math.PI / 2;
    board.position.copy(V(0, cfg.boardCenterY, 0.004));
    scene.add(board);
  }

  /**
   * 투구 준비 표시 — 서로 겹치지 않게 자리를 나눈다.
   * - 회전: 스톤에 딱 붙은 고리(길이·두께 = 세기) + 스톤 손잡이가 그 속도로 제자리에서 돈다
   * - 방향: 회전 고리 바깥에서 시작하는 화살표
   * - 파워: 스톤 오른쪽에 서 있는 막대 게이지 + 스톤이 뒤로 당겨짐
   * 지금 단계의 표시만 진하게, 끝난 단계는 흐리게.
   */
  buildThrowFeedback(game) {
    this.previewStone = this.makeStone(game.parts[0]);
    this.aim = new THREE.Group();
    this.aimShaft = flatStrip('#ffd54f');
    this.aimHead = flatTriangle('#ffd54f', 0.16, 0.3);
    for (const m of [this.aimShaft, this.aimHead]) m.material.transparent = true;
    this.aim.add(this.aimShaft, this.aimHead);

    this.gauge = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    frame.position.y = 0.5;
    this.gaugeFill = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 16), new THREE.MeshBasicMaterial({ color: '#66bb6a', toneMapped: false }));
    const cap = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 24), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    cap.rotation.x = Math.PI / 2;
    cap.position.y = 1;
    this.gauge.add(frame, this.gaugeFill, cap);

    this.spinArc = null;
    this.spinHead = flatTriangle('#ff7043', 0.06, 0.11);
    this.spinHead.material.transparent = true;
    this.scene.add(this.previewStone, this.aim, this.gauge, this.spinHead);
  }

  buildCharacter() {
    this.character = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.0, 20), new THREE.MeshStandardMaterial({ color: '#5e35b1' }));
    body.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshStandardMaterial({ color: '#f1c9a5' }));
    head.position.y = 1.18;
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e53935' }));
    hat.position.y = 1.2;
    this.character.add(body, head, hat);
    this.stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 8), new THREE.MeshStandardMaterial({ color: '#795548' }));
    this.broomMat = new THREE.MeshBasicMaterial({ color: C.broom.clone(), toneMapped: false });
    this.broomHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.1), this.broomMat);
    this.target = flatRing(0.08, 0.11, '#00e5ff', 0.8, 24); // 내 마우스/조이스틱 목표점
    this.scene.add(this.character, this.stick, this.broomHead, this.target);
  }

  /** 스위핑 반응: 스톤 둘레 강도 고리, 스톤 앞 얼음 녹는 띠, 위험할 때만 나타나는 경고 고리 */
  buildSweepFeedback(game) {
    const { cfg } = game;
    const r = cfg.stoneRadius;
    const bj = broomJudgeRadius(cfg);
    this.intensityRing = flatRing(r * 1.6, r * 2.1, '#76ff03', 0.95, 48);
    this.melt = flatStrip('#b3e5fc', 0);
    this.cushionWarn = flatRing(r + bj + cfg.cushionWidth - 0.025, r + bj + cfg.cushionWidth, '#ffd600', 0.9);
    this.bodyWarn = flatRing(cfg.bodyJudgeRadius + 0.02, cfg.bodyJudgeRadius + 0.07, '#ff1744', 0.9);
    this.scene.add(this.intensityRing, this.melt, this.cushionWarn, this.bodyWarn);
  }

  buildDebugSensors(game) {
    const { cfg } = game;
    const r = cfg.stoneRadius;
    const bj = broomJudgeRadius(cfg);
    this.sensors = new THREE.Group();
    this.dbgBody = flatRing(cfg.bodyJudgeRadius - 0.015, cfg.bodyJudgeRadius, '#ffffff', 0.8);
    this.dbgBroom = flatRing(bj - 0.012, bj, '#ffffff', 0.9);
    this.dbgContact = flatRing(r + bj - 0.012, r + bj, '#e53935', 0.6);
    this.dbgZone = new THREE.Group();
    const zoneLen = cfg.cushionWidth + cfg.sweepZoneLength;
    const zone = flatStrip('#43a047', 0.22);
    zone.scale.set(cfg.sweepZoneHalfWidth * 2, 1, zoneLen);
    zone.position.set(0, 0.005, -(r + bj + zoneLen / 2));
    this.dbgZone.add(zone);
    this.sensors.add(this.dbgBody, this.dbgBroom, this.dbgContact, this.dbgZone);
    this.scene.add(this.sensors);
  }

  makeStone(part) {
    const r = this.cfg.stoneRadius;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.96, 0.07, 32), new THREE.MeshStandardMaterial({ color: '#78909c', roughness: 0.5 }));
    base.position.y = 0.035;
    const decal = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 32), new THREE.MeshBasicMaterial({ map: this.puckTextures.get(part.id) }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.0715;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(r * 1.3, 0.025, 0.045), new THREE.MeshStandardMaterial({ color: '#263238' }));
    handle.position.y = 0.09;
    // 작은 퍽의 가시성 보강 (명세 5.3) — 판정 크기와 무관
    const glow = flatRing(r * 1.05, r * 1.45, part.color, 0.55);
    glow.position.y = 0.004;
    g.add(base, decal, handle, glow);
    g.userData = { handle, decal, partId: part.id };
    return g;
  }

  setPreviewPart(part) {
    if (this.previewStone.userData.partId === part.id) return;
    this.previewStone.userData.decal.material.map = this.puckTextures.get(part.id);
    this.previewStone.userData.partId = part.id;
  }

  handleEvents(events, game) {
    this.fx.handle(events, game);
    for (const e of events) if (e.type === 'stroke' && e.valid) this.broomPulse = 1;
  }

  // ── 좌표 변환 ──

  screenToGround(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.active);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    return { x: hit.x, y: -hit.z };
  }

  worldToScreen(x, y) {
    const v = V(x, y, 0.05).project(this.active);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // ── 카메라 (명세 4장, v1.1) ──

  /** halfW: 가로로 반드시 보여야 하는 반폭 — 세로 화면에서 잘리지 않게 */
  overhead(cx, cy, halfH, halfW = 0) {
    halfH = Math.max(halfH * this.safeScale, (halfW * this.safeScaleX) / this.persp.aspect);
    const H = halfH / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    return { pos: V(cx, cy, H), look: V(cx, cy, 0), up: UP_TOP, ortho: true, halfH, speed: 4 };
  }

  cameraGoal(game) {
    const { cfg } = game;
    const st = game.state;
    if (st === 'PART_SELECT' || st === 'RESULT') return this.overhead(0, cfg.boardCenterY, cfg.boardSize * 0.62, cfg.boardSize * 0.56);
    if (st === 'AIM' || st === 'SPIN' || st === 'POWER') {
      return { pos: V(0, LAUNCH.y - 4.2, 3.4), look: V(0, LAUNCH.y + 4, 0), up: UP_Y, ortho: false, speed: 4 };
    }
    if (this.options.laneTop || this.fallback) {
      return this.overhead(0, (cfg.laneLength + cfg.backLimitY) / 2, (cfg.laneLength - cfg.backLimitY) / 2 + 0.4, cfg.laneWidth / 2 + 0.4);
    }
    // 스위핑 추적: 스톤과 캐릭터 사이. 캐릭터가 멀리 뒤처지면 스톤만 따라간다
    const stone = game.currentStone ?? game.sim.movingStones()[0];
    const c = game.character.pos;
    const w = stone && Math.hypot(stone.x - c.x, stone.y - c.y) < 4 ? 0.35 : 0;
    const fx = stone ? lerp(stone.x, c.x, w) : c.x;
    const fy = stone ? lerp(stone.y, c.y, w) : c.y;
    return { pos: V(fx * 0.5, fy - 5.5, 6.5), look: V(fx * 0.8, fy + 1.8, 0), up: UP_Y, ortho: false, speed: 7 };
  }

  updateCamera(game, dt) {
    const goal = this.cameraGoal(game);
    const k = 1 - Math.exp(-dt * goal.speed);
    this.rig.pos.lerp(goal.pos, k);
    this.rig.look.lerp(goal.look, k);
    this.rig.up.lerp(goal.up, k).normalize();

    // 탑다운 목표에 거의 도달하면 같은 화면 크기의 정사영으로 교체 (명세 4장: 결과 = Ortho)
    const useOrtho = goal.ortho && this.rig.pos.distanceTo(goal.pos) < 0.05 && this.rig.up.distanceTo(goal.up) < 0.01;
    const cam = useOrtho ? this.ortho : this.persp;
    if (useOrtho) {
      const aspect = this.persp.aspect;
      Object.assign(this.ortho, { left: -goal.halfH * aspect, right: goal.halfH * aspect, top: goal.halfH, bottom: -goal.halfH });
      this.ortho.updateProjectionMatrix();
    }
    // 충돌·발사 순간의 짧은 카메라 펀치 (물리 시간은 멈추지 않는다)
    const p = this.fx?.punch ?? 0;
    cam.position.copy(this.rig.pos).add(new THREE.Vector3((Math.random() - 0.5) * p, (Math.random() - 0.5) * p, (Math.random() - 0.5) * p));
    cam.up.copy(this.rig.up);
    cam.lookAt(this.rig.look);
    this.active = cam;
  }

  // ── 프레임 ──

  render(game, alpha, dt) {
    const { cfg } = game;
    this.time += dt;
    this.lastDt = dt;
    this.updateCamera(game, dt);
    this.ghosts.visible = this.options.showGhosts;
    this.syncStones(game, alpha);
    this.renderThrowFeedback(game);
    const charPos = this.renderCharacter(game, alpha, dt);
    this.renderSweepFeedback(game, alpha, charPos);
    this.fx.update(dt, game);

    this.renderer.render(this.scene, this.active);
    this.minimapVisible = this.options.showMinimap && ['AIM', 'SPIN', 'POWER', 'SWEEP', 'SETTLING', 'BURN_RESOLVE'].includes(game.state);
    if (this.minimapVisible && this.minimapEl) this.renderMinimap(cfg, this.minimapEl.getBoundingClientRect());
  }

  syncStones(game, alpha) {
    const seen = new Set();
    for (const s of game.sim.stones.values()) {
      seen.add(s.id);
      let m = this.stoneMeshes.get(s.id);
      if (!m) {
        m = this.makeStone(game.parts.find((p) => p.id === s.id));
        this.stoneMeshes.set(s.id, m);
        this.scene.add(m);
      }
      m.position.copy(V(lerp(s.prevX, s.x, alpha), lerp(s.prevY, s.y, alpha)));
      m.userData.handle.rotation.y = -s.angle; // 위에서 볼 때 시계 방향 = +spin
    }
    for (const [id, m] of this.stoneMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.stoneMeshes.delete(id);
      }
    }
  }

  renderThrowFeedback(game) {
    const st = game.state;
    const aiming = st === 'AIM' || st === 'SPIN' || st === 'POWER';
    this.previewStone.visible = this.aim.visible = aiming;
    this.gauge.visible = st === 'POWER';
    if (!aiming) {
      this.updateSpinArc(0, false);
      return;
    }
    this.setPreviewPart(game.currentPart);
    const dx = Math.sin(game.aimAngle);
    const dy = Math.cos(game.aimAngle);
    const r = this.cfg.stoneRadius;

    // 파워: 스톤이 뒤로 당겨지고, 옆 막대가 차오르며 초록→노랑→빨강
    const pw = st === 'POWER' ? game.power : 0;
    const pull = pw * 0.6;
    const stone = { x: LAUNCH.x - dx * pull, y: LAUNCH.y - dy * pull };
    this.previewStone.position.copy(V(stone.x, stone.y));
    const powerColor = pw < 0.5 ? C.powerLo.clone().lerp(C.powerMid, pw * 2) : C.powerMid.clone().lerp(C.powerHi, (pw - 0.5) * 2);
    if (st === 'POWER') {
      this.gauge.position.copy(V(LAUNCH.x + dy * 0.75, LAUNCH.y - dx * 0.75 - 0.2));
      this.gaugeFill.scale.y = Math.max(0.02, pw);
      this.gaugeFill.position.y = Math.max(0.02, pw) / 2;
      this.gaugeFill.material.color.copy(powerColor);
    }

    // 회전: 스톤 손잡이가 세기만큼 제자리에서 돈다 (시계 = +)
    this.spinAngle = (this.spinAngle ?? 0) + game.spin * 5 * (this.lastDt ?? 0.016);
    this.previewStone.userData.handle.rotation.y = -this.spinAngle;

    // 방향 화살표: 회전 고리 바깥에서 시작. 파워 단계에서는 세기만큼 길어지고 색이 바뀐다
    const start = { x: stone.x + dx * r * 3, y: stone.y + dy * r * 3 };
    const len = st === 'POWER' ? 0.6 + 3 * pw : 1.5;
    const tip = { x: start.x + dx * len, y: start.y + dy * len };
    placeStrip(this.aimShaft, start, tip, st === 'AIM' ? 0.1 : 0.07, 0.015);
    this.aimHead.position.copy(V(tip.x, tip.y, 0.016));
    this.aimHead.rotation.y = -game.aimAngle;
    const aimColor = st === 'POWER' ? powerColor : new THREE.Color('#ffd54f');
    const aimOpacity = st === 'SPIN' ? 0.35 : 1;
    for (const m of [this.aimShaft, this.aimHead]) {
      m.material.color.copy(aimColor);
      m.material.opacity = aimOpacity;
    }

    this.updateSpinArc(game.spin, true, stone, st === 'SPIN' ? 0.95 : 0.4);
  }

  /** 회전 고리: 스톤에 딱 붙어서, 길이·두께 = 세기, 화살촉 = 방향, 색 = 시계(주황)/반시계(청록) */
  updateSpinArc(spin, visible, center = LAUNCH, opacity = 0.95) {
    const key = visible ? Math.round(spin * 100) : null;
    if (key !== this.spinKey) {
      this.spinKey = key;
      if (this.spinArc) {
        this.scene.remove(this.spinArc);
        this.spinArc.geometry.dispose();
        this.spinArc = null;
      }
      if (visible && key !== 0) {
        const r = this.cfg.stoneRadius;
        const a = Math.abs(spin);
        const len = a * Math.PI * 1.6;
        const R0 = r * 1.4;
        const R1 = R0 + 0.025 + 0.07 * a;
        // RingGeometry 각도는 위에서 볼 때 반시계 방향. 시계(+)는 시작점을 len만큼 당겨서 그린다.
        const startA = spin > 0 ? Math.PI / 2 - len : Math.PI / 2;
        const color = spin > 0 ? '#ff7043' : '#26c6da';
        const mat = basic(color, 0.95);
        mat.transparent = true;
        this.spinArc = new THREE.Mesh(new THREE.RingGeometry(R0, R1, 48, 1, startA, len), mat);
        this.spinArc.rotation.x = -Math.PI / 2;
        this.scene.add(this.spinArc);
        const end = spin > 0 ? startA : startA + len;
        this.spinArcEnd = { end, Rm: (R0 + R1) / 2, cw: spin > 0, a };
        this.spinHead.material.color.set(color);
      }
    }
    this.spinHead.visible = !!this.spinArc;
    if (!this.spinArc) return;
    this.spinArc.position.copy(V(center.x, center.y, 0.012));
    this.spinArc.material.opacity = opacity;
    const { end, Rm, cw, a } = this.spinArcEnd;
    const tx = cw ? Math.sin(end) : -Math.sin(end);
    const ty = cw ? -Math.cos(end) : Math.cos(end);
    this.spinHead.position.copy(V(center.x + Math.cos(end) * Rm, center.y + Math.sin(end) * Rm, 0.013));
    this.spinHead.rotation.y = -Math.atan2(tx, ty);
    this.spinHead.scale.setScalar(0.8 + a);
    this.spinHead.material.opacity = opacity;
  }

  renderCharacter(game, alpha, dt) {
    const ch = game.character;
    const cx = lerp(ch.prev.x, ch.pos.x, alpha);
    const cy = lerp(ch.prev.y, ch.pos.y, alpha);
    const bx = lerp(game.broomPrev.x, game.broom.x, alpha);
    const by = lerp(game.broomPrev.y, game.broom.y, alpha);
    const st = game.state;
    const show = st === 'SWEEP' || st === 'SETTLING' || st === 'BURN_RESOLVE';
    this.character.visible = this.stick.visible = this.broomHead.visible = this.target.visible = show;
    this.character.position.copy(V(cx, cy));
    // 번드: 휘청
    this.character.rotation.z = st === 'BURN_RESOLVE' ? Math.sin(this.time * 30) * 0.25 : 0;
    const hand = V(lerp(cx, bx, 0.25), lerp(cy, by, 0.25), 0.85);
    const headPos = V(bx, by, 0.03);
    this.broomHead.position.copy(headPos);
    this.stick.position.copy(hand).add(headPos).multiplyScalar(0.5);
    this.stick.scale.y = hand.distanceTo(headPos);
    this.stick.quaternion.setFromUnitVectors(UP_Y, hand.clone().sub(headPos).normalize());
    this.target.position.copy(V(ch.target.x, ch.target.y, 0.01));

    // 빗자루 머리 색 = 지금 스위핑이 먹히는지: 초록(효과 있음) / 노랑(너무 가까움) / 빨강(닿음) / 기본
    const f = game.frame;
    const want = f.contactTicks > 0 ? C.danger : f.cushion ? C.caution : f.posEff > 0 ? C.good : C.broom;
    this.broomMat.color.lerp(want, 1 - Math.exp(-dt * 20));
    this.broomPulse = Math.max(0, (this.broomPulse ?? 0) - dt * 6);
    this.broomHead.scale.set(1 + 0.35 * this.broomPulse, 1 + this.broomPulse, 1 + 0.35 * this.broomPulse);
    return { x: cx, y: cy, bx, by };
  }

  renderSweepFeedback(game, alpha, cp) {
    const { cfg } = game;
    const cur = game.currentStone;
    const sweeping = game.state === 'SWEEP' && cur && cur.status === 'moving';

    // 강도 고리: 스톤 둘레를 채우는 길이와 색으로 지금 스위핑 세기
    const s = game.sweep.intensity;
    this.intensityRing.visible = this.melt.visible = sweeping && s > 0.02;
    if (this.intensityRing.visible) {
      const p = { x: lerp(cur.prevX, cur.x, alpha), y: lerp(cur.prevY, cur.y, alpha) };
      this.intensityRing.position.copy(V(p.x, p.y, 0.01));
      this.intensityRing.geometry.setDrawRange(0, Math.max(1, Math.round(48 * s)) * 6);
      this.intensityRing.material.color.copy(C.low).lerp(C.good, s);
      // 스톤 앞 얼음이 녹는 띠: 세게 쓸수록 진하고 길다
      const sp = Math.hypot(cur.vx, cur.vy) || 1;
      const d = { x: cur.vx / sp, y: cur.vy / sp };
      const a = { x: p.x + d.x * cfg.stoneRadius, y: p.y + d.y * cfg.stoneRadius };
      const b = { x: a.x + d.x * (0.4 + 0.8 * s), y: a.y + d.y * (0.4 + 0.8 * s) };
      placeStrip(this.melt, a, b, cfg.stoneRadius * 2.2, 0.007);
      this.melt.material.opacity = 0.15 + 0.5 * s;
    }

    // 경고: 빗자루가 쿠션에 들어오거나 닿을 때만, 몸이 움직이는 스톤에 가까울 때만 보인다
    const moving = game.sim.movingStones();
    let near = null;
    let nd = Infinity;
    let bodyD = Infinity;
    for (const m of moving) {
      const d = Math.hypot(m.x - cp.bx, m.y - cp.by);
      if (d < nd) {
        nd = d;
        near = m;
      }
      bodyD = Math.min(bodyD, Math.hypot(m.x - cp.x, m.y - cp.y) - cfg.stoneRadius - cfg.bodyJudgeRadius);
    }
    const f = game.frame;
    this.cushionWarn.visible = !!near && (f.cushion || f.contactTicks > 0);
    if (this.cushionWarn.visible) {
      this.cushionWarn.position.copy(V(lerp(near.prevX, near.x, alpha), lerp(near.prevY, near.y, alpha), 0.012));
      this.cushionWarn.material.color.copy(f.contactTicks > 0 ? C.danger : C.caution);
      this.cushionWarn.material.opacity = 0.6 + 0.4 * Math.sin(this.time * 25);
    }
    this.bodyWarn.visible = bodyD < 0.35 && game.state !== 'BURN_RESOLVE';
    if (this.bodyWarn.visible) {
      this.bodyWarn.position.copy(V(cp.x, cp.y, 0.012));
      this.bodyWarn.material.opacity = Math.min(1, (0.35 - bodyD) / 0.2);
    }

    // 디버그: 판정 원·유효 영역
    this.sensors.visible = this.options.showSensors && this.character.visible;
    if (this.sensors.visible) {
      this.dbgBody.position.copy(V(cp.x, cp.y, 0.008));
      this.dbgBroom.position.copy(V(cp.bx, cp.by, 0.008));
      const ref = cur?.status === 'moving' ? cur : near;
      this.dbgContact.visible = this.dbgZone.visible = !!ref;
      if (ref) {
        const p = V(ref.x, ref.y, 0.008);
        this.dbgContact.position.copy(p);
        const sp = Math.hypot(ref.vx, ref.vy) || 1;
        this.dbgZone.position.copy(p);
        this.dbgZone.rotation.y = Math.atan2(-ref.vx / sp, ref.vy / sp);
      }
    }
  }

  /** 투구·스위핑 중 목표 보드를 탑다운으로 보여주는 인셋 */
  renderMinimap(cfg, rect) {
    // 미니맵 틀 위치를 캔버스 기준 좌표로 (PC에서는 캔버스가 가운데 세로 틀 안에 있다)
    const c = this.canvas.getBoundingClientRect();
    const size = Math.round(rect.width);
    const left = Math.round(rect.left - c.left);
    const bottom = Math.round(c.bottom - rect.bottom);
    if (size <= 0) return;
    const half = cfg.boardSize * 0.58;
    Object.assign(this.miniCam, { left: -half, right: half, top: half, bottom: -half });
    this.miniCam.updateProjectionMatrix();
    this.miniCam.position.copy(V(0, cfg.boardCenterY, 30));
    this.miniCam.up.copy(UP_TOP);
    this.miniCam.lookAt(V(0, cfg.boardCenterY, 0));
    const r = this.renderer;
    r.setScissorTest(true);
    r.setScissor(left, bottom, size, size);
    r.setViewport(left, bottom, size, size);
    r.render(this.scene, this.miniCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
  }

  /** 월드 점의 화면 위치와 화면 안 여부 (화면 밖 표시용) */
  screenInfo(x, y) {
    const v = V(x, y, 0.5).project(this.active);
    const behind = v.z > 1;
    const inside = !behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    return { nx: behind ? -v.x : v.x, ny: behind ? -Math.abs(v.y) - 1 : v.y, inside };
  }
}
