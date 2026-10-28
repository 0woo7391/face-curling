const { chromium } = require('playwright');
const SP = process.argv[2] ?? '/tmp';
const VIEWS = [
  { name: 'pc-1400x860', w: 1400, h: 860, touch: false },
  { name: 'panel-935x823', w: 935, h: 823, touch: false },
  { name: 'phone-390x664', w: 390, h: 664, touch: true, dpr: 3 },
  { name: 'tablet-768x1024', w: 768, h: 1024, touch: true, dpr: 2 },
];
const HUD = ['#home .home-logo', '#home .home-panel', '#pause', '#lock-overlay', '#topbar', '#parts', '#steps', '#hint', '#controls', '#next-key', '#minimap-frame', '#touch-swipe', '#result', '#offscreen'];

(async () => {
  const browser = await chromium.launch();
  let problems = 0;
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.dpr ?? 1, hasTouch: v.touch, isMobile: v.touch });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('http://localhost:4173/');
    await page.waitForFunction(() => window.__game);
    await page.evaluate((touch) => { window.__debug.paused = true; if (touch) window.__debug.input.pointerType = 'touch'; }, v.touch);

    const steps = [
      ['HOME', () => {}],
      ['PART_SELECT', () => { window.__debug.actions.start('record'); window.__debug.paused = true; }],
      ['THROW', () => { window.__game.selectPart('nose'); }],
      ['PULL', () => { window.__game.setThrow(0.1, 0.9); }],
      ['SWEEP', () => {
        const g = window.__game; g.release();
        for (let t = 0; t < 140; t++) {
          const s = g.currentStone, c = g.cfg, sp = Math.hypot(s.vx, s.vy);
          const best = c.stoneRadius + c.broomVisualRadius * c.broomJudgeScale + c.cushionWidth + 0.15;
          const along = g.broom.y - s.y;
          g.enqueue({ type: 'moveAbs', x: along < best ? s.x - c.broomReach - 0.5 : s.x - c.broomReach, y: s.y + best + (along < best ? 1 : 0) });
          if (t % 8 === 0) g.enqueue({ type: 'press', button: g.sweep.expect === 'push' ? 0 : 2 });
          g.tick();
        }
      }],
      ['PAUSE', () => { window.__debug.actions.pause(); }],
      ['RESULT', () => {
        window.__debug.actions.resume();
        const g = window.__game;
        for (let i = 0; i < 4000 && g.state !== 'PART_SELECT'; i++) g.tick();
        for (const id of ['left_brow', 'right_brow', 'left_eye', 'right_eye', 'mouth']) {
          g.selectPart(id); g.setThrow(0, 0.57); g.release();
          for (let i = 0; i < 4000 && !['PART_SELECT', 'RESULT'].includes(g.state); i++) g.tick();
        }
      }],
    ];
    for (const [label, fn] of steps) {
      await page.evaluate(fn);
      await page.waitForTimeout(['HOME', 'PART_SELECT', 'RESULT'].includes(label) ? 2500 : 1500); // 카메라 이동 대기
      const rep = await page.evaluate(([HUD, label]) => {
        const g = window.__game, r = window.__debug.renderer;
        const vis = [];
        for (const sel of HUD) {
          const el = document.querySelector(sel);
          if (!el || el.hidden) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (sel === '#hint' && !el.textContent) continue;
          if (sel === '#controls' && ![...el.children].some((b) => !b.hidden)) continue;
          const b = el.getBoundingClientRect();
          if (b.width < 2 || b.height < 2) continue;
          vis.push({ sel, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom });
        }
        const issues = [];
        for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
          const a = vis[i], b = vis[j];
          const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          if (ox > 2 && oy > 2) issues.push(`HUD 겹침 ${a.sel} × ${b.sel} (${Math.round(ox)}×${Math.round(oy)})`);
        }
        // 게임 대상 → 화면 점
        const pts = [];
        if (['THROW', 'PULL'].includes(label)) {
          const pw = label === 'PULL' ? g.power * 0.6 : 0;
          pts.push(['스톤', 0, -pw]);
        }
        if (label === 'SWEEP' || label === 'PAUSE') {
          const s = g.currentStone; if (s) pts.push(['스톤', s.x, s.y]);
          pts.push(['캐릭터', g.character.pos.x, g.character.pos.y]);
          pts.push(['빗자루', g.broom.x, g.broom.y]);
        }
        if (label === 'HOME' || label === 'PART_SELECT' || label === 'RESULT') {
          for (const q of [[0.2, 0.17], [0.8, 0.17], [0.2, 0.9], [0.8, 0.9], [0.5, 0.5]]) {
            const w = g.board.qToWorld({ x: q[0], y: q[1] }); pts.push([`얼굴(${q})`, w.x, w.y]);
          }
          for (const s of g.sim.stones.values()) pts.push([`스톤 ${s.id}`, s.x, s.y]);
        }
        for (const [name, x, y] of pts) {
          const p = r.worldToScreen(x, y);
          const S = document.getElementById('stage').getBoundingClientRect();
          if (p.x < S.left || p.y < S.top || p.x > S.right || p.y > S.bottom) { issues.push(`${name} 화면 밖 (${Math.round(p.x)},${Math.round(p.y)})`); continue; }
          for (const h of vis) {
            const m = 12;
            if (p.x > h.x0 - m && p.x < h.x1 + m && p.y > h.y0 - m && p.y < h.y1 + m) issues.push(`${name} ← ${h.sel}에 가려짐`);
          }
        }
        return { state: g.state, issues };
      }, [HUD, label]);
      if (rep.issues.length) { problems += rep.issues.length; console.log(`✗ ${v.name} ${label}: ${rep.issues.join(' | ')}`); }
      await page.screenshot({ path: `${SP}/ov-${v.name}-${label}.png` });
    }
    if (errs.length) console.log(v.name, 'errors', errs);
    await ctx.close();
  }
  console.log(problems ? `문제 ${problems}건` : '겹침 없음');
  await browser.close();
})();
