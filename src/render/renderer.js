// Three.js 표현 계층 (명세 4장). 게임 상태를 읽기만 하고 바꾸지 않는다.
// 2D 물리 (x, y) ↔ 3D (X, Y=높이, Z) 단일 매핑: X = x, Z = -y.
import * as THREE from 'three';
import { FACE_BOX } from '../core/board.js';
import { LAUNCH } from '../core/game.js';
import { broomJudgeRadius } from '../core/sweep.js';
import { faceBoardTexture, puckTexture, labelTexture } from './textures.js';

const V = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_TOP = new THREE.Vector3(0, 0, -1); // 탑다운에서 화면 위 = 레인 진행 방향
const lerp = (a, b, t) => a + (b - a) * t;

function flatRing(inner, outer, color, opacity, segments = 48) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, segments),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

function line(color, maxPoints, dashed = false) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.9 })
    : new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geo, mat);
}

function setLine(l, pts, h = 0.02) {
  const arr = l.geometry.attributes.position.array;
  const n = Math.min(pts.length, arr.length / 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = pts[i].x;
    arr[i * 3 + 1] = h;
    arr[i * 3 + 2] = -pts[i].y;
  }
  l.geometry.attributes.position.needsUpdate = true;
  l.geometry.setDrawRange(0, n);
  l.geometry.computeBoundingSphere();
  if (l.material.isLineDashedMaterial) l.computeLineDistances();
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
    this.options = { showSensors: true, showPath: true, showGhosts: true, showMinimap: true, laneTop: false };
    this.fallback = false; // Pointer Lock 불가 → 레인 탑다운 고정
    this.miniCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 300);
    this.minimapEl = null; // 미니맵을 그릴 위치는 HUD의 #minimap-frame 요소 위치를 따른다
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(UP_Y, 0);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.portrait = h > w;
    this.persp.aspect = w / h;
    // 세로 화면: 가로 시야가 좁아지므로 FOV를 넓히고, 아래쪽 조작 영역(엄지)을 피해 화면 중심을 위로 올린다
    this.persp.fov = this.portrait ? 68 : 50;
    for (const cam of [this.persp, this.ortho]) {
      if (this.portrait) cam.setViewOffset(w, h, 0, h * 0.16, w, h);
      else cam.clearViewOffset();
    }
    this.persp.updateProjectionMatrix();
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

    const len = cfg.laneLength - cfg.backLimitY;
    const midY = (cfg.laneLength + cfg.backLimitY) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, len + 20), new THREE.MeshStandardMaterial({ color: '#2a3442' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(V(0, midY, -0.01));
    scene.add(floor);

    const ice = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.laneWidth, len),
      new THREE.MeshStandardMaterial({ color: '#eef5fa', roughness: 0.35, metalness: 0 }),
    );
    ice.rotation.x = -Math.PI / 2;
    ice.position.copy(V(0, midY, 0));
    scene.add(ice);

    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, len), new THREE.MeshStandardMaterial({ color: '#90a4ae' }));
      wall.position.copy(V(sx * (cfg.laneWidth / 2 + 0.06), midY, 0.09));
      scene.add(wall);
    }
    const stripe = (y, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(cfg.laneWidth, 0.05), new THREE.MeshBasicMaterial({ color }));
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

    // 정답 위치 유령 표시 (명세 3.6)
    this.ghosts = new THREE.Group();
    const r = cfg.stoneRadius;
    for (const p of game.parts) {
      const w = game.board.qToWorld(p.q);
      const ring = flatRing(r * 0.92, r * 1.08, p.color, 0.75);
      ring.position.copy(V(w.x, w.y, 0.006));
      this.ghosts.add(ring);
      const dot = flatRing(0, 0.02, p.color, 0.9, 12);
      dot.position.copy(V(w.x, w.y, 0.006));
      this.ghosts.add(dot);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.label, p.color), depthTest: false }));
      label.scale.set(0.62, 0.175, 1);
      // 왼쪽 부위는 바깥 왼쪽, 오른쪽·가운데 부위는 오른쪽에 라벨 (위아래 부위와 겹치지 않게)
      const lx = p.side === 'L' ? -0.55 : 0.55;
      label.position.copy(V(w.x + lx, w.y, 0.15));
      this.ghosts.add(label);
    }
    scene.add(this.ghosts);

    // 스톤
    this.stoneMeshes = new Map();
    this.puckTextures = new Map(game.parts.map((p) => [p.id, puckTexture(p)]));

    // 투구 준비 표시
    this.pathLine = line('#2e7d32', 1024, true);
    this.aimLine = line('#ffb300', 2);
    this.powerLine = line('#e53935', 2);
    this.spinArc = null;
    this.previewStone = this.makeStone(game.parts[0]);
    scene.add(this.pathLine, this.aimLine, this.powerLine, this.previewStone);

    // 캐릭터
    this.character = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#5e35b1' });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.0, 20), bodyMat);
    body.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshStandardMaterial({ color: '#f1c9a5' }));
    head.position.y = 1.18;
    this.character.add(body, head);
    this.stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 8), new THREE.MeshStandardMaterial({ color: '#795548' }));
    this.broomHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.1), new THREE.MeshStandardMaterial({ color: '#c62828' }));
    scene.add(this.character, this.stick, this.broomHead);

    // 판정·센서 시각화 (명세 3.8.2)
    const bj = broomJudgeRadius(cfg);
    this.sensors = new THREE.Group();
    this.bodyRing = flatRing(cfg.bodyJudgeRadius - 0.015, cfg.bodyJudgeRadius, '#ffffff', 0.8);
    this.broomRing = flatRing(bj - 0.012, bj, '#ffffff', 0.9);
    this.contactRing = flatRing(r + bj - 0.012, r + bj, '#e53935', 0.5);
    this.cushionRing = flatRing(r + bj + cfg.cushionWidth - 0.012, r + bj + cfg.cushionWidth, '#fdd835', 0.5);
    this.zone = new THREE.Group();
    const zoneLen = cfg.cushionWidth + cfg.sweepZoneLength;
    const zoneMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.sweepZoneHalfWidth * 2, zoneLen),
      new THREE.MeshBasicMaterial({ color: '#43a047', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    );
    zoneMesh.rotation.x = -Math.PI / 2;
    zoneMesh.position.set(0, 0.005, -(r + bj + zoneLen / 2));
    this.zone.add(zoneMesh);
    this.sensors.add(this.bodyRing, this.broomRing, this.contactRing, this.cushionRing, this.zone);
    scene.add(this.sensors);

    this.targetMarker = new THREE.Group();
    this.targetMarker.add(flatRing(0.1, 0.13, '#00e5ff', 0.95, 24));
    const cross = flatRing(0, 0.03, '#00e5ff', 0.95, 12);
    this.targetMarker.add(cross);
    scene.add(this.targetMarker);
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
    const glow = flatRing(r * 1.05, r * 1.5, part.color, 0.55);
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
    halfH = Math.max(halfH, halfW / this.persp.aspect);
    const H = halfH / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    return { pos: V(cx, cy, H), look: V(cx, cy, 0), up: UP_TOP, ortho: true, halfH, speed: 4 };
  }

  cameraGoal(game) {
    const { cfg } = game;
    const st = game.state;
    if (st === 'PART_SELECT' || st === 'RESULT') return this.overhead(0, cfg.boardCenterY, cfg.boardSize * 0.62, cfg.boardSize * 0.56);
    if (st === 'AIM' || st === 'SPIN' || st === 'POWER') {
      return { pos: V(0, LAUNCH.y - 5, 4.2), look: V(0, LAUNCH.y + 9, 0), up: UP_Y, ortho: false, speed: 4 };
    }
    if (this.options.laneTop || this.fallback) {
      return this.overhead(0, (cfg.laneLength + cfg.backLimitY) / 2, (cfg.laneLength - cfg.backLimitY) / 2 + 0.4, cfg.laneWidth / 2 + 0.4);
    }
    // 스위핑 추적: 스톤과 캐릭터 사이 (명세 4장 [제안])
    const stone = game.currentStone ?? game.sim.movingStones()[0];
    const c = game.character.pos;
    // 캐릭터가 멀리 뒤처지면 스톤만 따라간다 (캐릭터 위치는 화면 가장자리 표시로 안내)
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
    cam.position.copy(this.rig.pos);
    cam.up.copy(this.rig.up);
    cam.lookAt(this.rig.look);
    this.active = cam;
  }

  // ── 프레임 ──

  render(game, alpha, dt) {
    const { cfg } = game;
    this.updateCamera(game, dt);
    this.ghosts.visible = this.options.showGhosts;

    // 스톤 동기화 + 렌더 보간
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

    // 투구 준비
    const aiming = game.state === 'AIM' || game.state === 'SPIN' || game.state === 'POWER';
    this.previewStone.visible = aiming;
    this.pathLine.visible = aiming && this.options.showPath;
    this.aimLine.visible = aiming;
    this.powerLine.visible = game.state === 'POWER' && game.power > 0;
    if (aiming) {
      this.setPreviewPart(game.currentPart);
      this.previewStone.position.copy(V(LAUNCH.x, LAUNCH.y));
      this.previewStone.userData.handle.rotation.y = 0;
      setLine(this.pathLine, game.predictedPath().points, 0.015);
      const dx = Math.sin(game.aimAngle);
      const dy = Math.cos(game.aimAngle);
      setLine(this.aimLine, [LAUNCH, { x: LAUNCH.x + dx * 3, y: LAUNCH.y + dy * 3 }], 0.03);
      setLine(this.powerLine, [LAUNCH, { x: LAUNCH.x - dx * game.power * 1.8, y: LAUNCH.y - dy * game.power * 1.8 }], 0.03);
    }
    this.updateSpinArc(aiming ? game.spin : 0, aiming);

    // 캐릭터·빗자루
    const ch = game.character;
    const cx = lerp(ch.prev.x, ch.pos.x, alpha);
    const cy = lerp(ch.prev.y, ch.pos.y, alpha);
    const bx = lerp(game.broomPrev.x, game.broom.x, alpha);
    const by = lerp(game.broomPrev.y, game.broom.y, alpha);
    const showChar = game.state === 'SWEEP' || game.state === 'SETTLING' || game.state === 'BURN_RESOLVE';
    this.character.visible = this.stick.visible = this.broomHead.visible = showChar;
    this.character.position.copy(V(cx, cy));
    const hand = V(lerp(cx, bx, 0.25), lerp(cy, by, 0.25), 0.85);
    const headPos = V(bx, by, 0.03);
    this.broomHead.position.copy(headPos);
    this.stick.position.copy(hand).add(headPos).multiplyScalar(0.5);
    this.stick.scale.y = hand.distanceTo(headPos);
    this.stick.quaternion.setFromUnitVectors(UP_Y, hand.clone().sub(headPos).normalize());

    // 센서
    const moving = game.sim.movingStones();
    const ref = game.currentStone?.status === 'moving' ? game.currentStone : moving[0];
    this.sensors.visible = this.options.showSensors && showChar;
    this.bodyRing.position.copy(V(cx, cy, 0.008));
    this.broomRing.position.copy(V(bx, by, 0.008));
    this.contactRing.visible = this.cushionRing.visible = !!ref;
    this.zone.visible = !!ref && game.state === 'SWEEP' && ref === game.currentStone;
    if (ref) {
      const p = V(lerp(ref.prevX, ref.x, alpha), lerp(ref.prevY, ref.y, alpha), 0.008);
      this.contactRing.position.copy(p);
      this.cushionRing.position.copy(p);
      const sp = Math.hypot(ref.vx, ref.vy) || 1;
      this.zone.position.copy(p);
      this.zone.rotation.y = Math.atan2(-ref.vx / sp, ref.vy / sp);
    }
    const contact = game.frame.contactTicks > 0;
    this.contactRing.material.opacity = contact ? 0.95 : 0.35;
    this.cushionRing.material.opacity = game.frame.cushion ? 0.95 : 0.35;
    this.broomRing.material.color.set(contact ? '#e53935' : game.frame.cushion ? '#fdd835' : '#ffffff');

    this.targetMarker.visible = showChar;
    this.targetMarker.position.copy(V(ch.target.x, ch.target.y, 0.01));

    this.renderer.render(this.scene, this.active);
    this.minimapVisible = this.options.showMinimap && ['AIM', 'SPIN', 'POWER', 'SWEEP', 'SETTLING', 'BURN_RESOLVE'].includes(game.state);
    if (this.minimapVisible && this.minimapEl) this.renderMinimap(cfg, this.minimapEl.getBoundingClientRect());
  }

  /** 투구·스위핑 중 목표 보드를 탑다운으로 보여주는 인셋 */
  renderMinimap(cfg, rect) {
    const size = Math.round(rect.width);
    const left = Math.round(rect.left);
    const bottom = Math.round(this.container.clientHeight - rect.bottom);
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

  updateSpinArc(spin, visible) {
    const key = visible ? Math.round(spin * 100) : null;
    if (key === this.spinKey) return;
    this.spinKey = key;
    if (this.spinArc) {
      this.scene.remove(this.spinArc);
      this.spinArc.geometry.dispose();
      this.spinArc = null;
    }
    if (!visible || key === 0) return;
    const r = this.cfg.stoneRadius;
    const len = Math.abs(spin) * Math.PI * 1.5;
    // RingGeometry 각도는 위에서 볼 때 반시계 방향. 시계(+)는 시작점을 len만큼 당겨서 그린다.
    const start = spin > 0 ? Math.PI / 2 - len : Math.PI / 2;
    this.spinArc = new THREE.Mesh(
      new THREE.RingGeometry(r * 1.7, r * 2.15, 48, 1, start, len),
      new THREE.MeshBasicMaterial({ color: spin > 0 ? '#ff7043' : '#26c6da', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    this.spinArc.rotation.x = -Math.PI / 2;
    this.spinArc.position.copy(V(LAUNCH.x, LAUNCH.y, 0.012));
    this.scene.add(this.spinArc);
  }
}
