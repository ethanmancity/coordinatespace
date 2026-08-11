/* ============================================================
   Coordinate Space — Three.js scene & manual orbit camera
   ------------------------------------------------------------
   Responsibilities:
     • scene furniture: color-coded axes, two-tier ground grid,
       point marker + vector from the origin
     • per-mode reference geometry overlays (rebuilt on change)
     • hand-rolled orbit controls — drag to rotate,
       wheel, pinch, or the toolbar slider to zoom
     • zoom-adaptive scaling so marker / labels / dashed overlays
       stay equally readable at any camera distance

   World orientation: the app's Z axis is vertical (up/down),
   X and Y lie on the horizontal ground plane. three.js has Y
   up, so every app-space point (x, y, z) is mapped to the
   world position (x, z, y). The grid is drawn directly in the
   world XZ plane (= the app's XY plane at z = 0).
   ============================================================ */
(function (global) {
  'use strict';

  const T = THREE;

  /* ---- palette (kept in sync with the CSS accent colors) ---- */
  const COLORS = {
    bg: 0x0a1420,
    grid: 0x19304d,
    gridCenter: 0x2e5a86,
    axisTail: 0x26446b,
    x: 0xff6b6b,
    y: 0x4ade80,
    z: 0x5b9bff,
    marker: 0xfff3c4,
    accent: { rect: 0xffb020, cyl: 0x26d0ee, sph: 0xc48aff }
  };

  const EPS = 1e-7;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const css = h => '#' + h.toString(16).padStart(6, '0');

  /* zoom range for the camera radius, mapped onto the toolbar zoom slider */
  const ZOOM_MIN = 1.5;
  const ZOOM_MAX = 400; /* sees the whole ±100 world with margin */

  /* extent of the reference world (±WORLD_EXTENT along each axis) */
  const WORLD_EXTENT = 100;
  const GRID_MINOR = 2;   /* minor grid line spacing (units) */
  const GRID_MAJOR = 10;  /* major grid line spacing (units) */

  /* camera distance at which world objects render 1:1. Overlay dash
     sizes, marker and label sprites scale with radius / DEFAULT_RADIUS
     so they stay equally readable at every zoom level. */
  const DEFAULT_RADIUS = 16;

  let container, renderer, scene, camera;
  let mode = 'rect';
  let marker, glow, vectorLine, overlay = null;

  /* axis + origin label sprites — scaled so they stay readable at any zoom */
  const axisLabels = [];

  /* current zoom-dependent scale for dashes / markers / labels */
  let dashScale = 1;
  let lastDashScale = 1;

  /* camera orbit state (spherical coordinates around the origin) */
  const orbit = { theta: Math.PI / 4, phi: Math.PI / 3, radius: DEFAULT_RADIUS };

  /* live pointers — single pointer orbits, two pointers pinch-zoom */
  const pointers = new Map();
  let pinchDist = 0;

  /* called whenever the camera radius changes (keeps the zoom slider in sync) */
  let radiusCb = null;

  /* ----------------------------------------------------------------
     coordinate mapping
  ---------------------------------------------------------------- */

  /* Convert an app-space point (x, y, z) — Z vertical, X/Y horizontal —
     into a three.js world position (x, z, y). Arrays hold app
     coordinates; a Vector3 argument is already world space (cloned). */
  function v3(a, b, c) {
    if (Array.isArray(a)) return new T.Vector3(a[0], a[2], a[1]);
    if (a && a.isVector3) return a.clone();
    return new T.Vector3(a, c, b);
  }

  /* ----------------------------------------------------------------
     setup
  ---------------------------------------------------------------- */

  function init(host) {
    container = host;

    scene = new T.Scene();
    scene.background = new T.Color(COLORS.bg);

    camera = new T.PerspectiveCamera(50, 1, 0.1, 300);

    renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    /* ---- manual orbit controls (no addons) ---- */
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('contextmenu', e => e.preventDefault());
    container.addEventListener('wheel', onWheel, { passive: false });

    buildBase();
    applyOrbit();
    resize();

    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
    else window.addEventListener('resize', resize);

    renderer.setAnimationLoop(() => renderer.render(scene, camera));
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  /* ----------------------------------------------------------------
     controls
  ---------------------------------------------------------------- */

  function onPointerDown(e) {
    try { container.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinchDist = pointers.size === 2 ? twoPointerDist() : 0;
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      /* single pointer → orbit */
      orbit.theta -= dx * 0.005;
      orbit.phi = clamp(orbit.phi - dy * 0.005, 0.06, Math.PI - 0.06);
      applyOrbit();
    } else if (pointers.size === 2) {
      /* two pointers → pinch zoom */
      const d = twoPointerDist();
      if (pinchDist > 0) {
        orbit.radius = clamp(orbit.radius * (pinchDist / d), ZOOM_MIN, ZOOM_MAX);
        applyOrbit();
      }
      pinchDist = d;
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    pinchDist = pointers.size === 2 ? twoPointerDist() : 0;
  }

  function twoPointerDist() {
    const pts = Array.from(pointers.values());
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  function onWheel(e) {
    e.preventDefault();
    orbit.radius = clamp(orbit.radius * Math.exp(e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
    applyOrbit();
  }

  function applyOrbit() {
    const sp = Math.sin(orbit.phi);
    camera.position.set(
      orbit.radius * sp * Math.sin(orbit.theta),
      orbit.radius * Math.cos(orbit.phi),
      orbit.radius * sp * Math.cos(orbit.theta)
    );
    camera.lookAt(0, 0, 0);

    /* keep the marker, glow, labels and overlay dashes at a constant
       on-screen size no matter how far the camera is */
    dashScale = orbit.radius / DEFAULT_RADIUS;
    marker.scale.setScalar(dashScale);
    glow.scale.setScalar(0.9 * dashScale);
    axisLabels.forEach(l => {
      /* axis labels ride the zoom: constant screen size, parked just
         past the visible edge of the axis so they never clip off-screen */
      l.scale.setScalar(l.userData.base * orbit.radius * 0.11);
      if (l.userData.dir) l.position.copy(l.userData.dir).multiplyScalar(orbit.radius * 1.42);
    });

    /* overlay dash sizes are zoom-dependent → rebuild when the scale moves */
    if (Math.abs(dashScale - lastDashScale) > 0.002) {
      lastDashScale = dashScale;
      rebuildOverlay();
    }

    if (radiusCb) radiusCb(orbit.radius, getZoom());
  }

  /* ---- zoom slider API: radius is mapped exponentially so the
         slider feels linear (near = fine detail, far = overview) ---- */
  function getZoom() {
    return Math.log(orbit.radius / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
  }

  function setZoom(t) {
    t = clamp(t, 0, 1);
    orbit.radius = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, t);
    applyOrbit();
  }

  function onRadiusChange(fn) { radiusCb = fn; }

  function resetCamera() {
    orbit.theta = Math.PI / 4;
    orbit.phi = Math.PI / 3;
    orbit.radius = DEFAULT_RADIUS;
    applyOrbit();
  }

  /* ----------------------------------------------------------------
     static scene furniture
  ---------------------------------------------------------------- */

  /* two-tier reference grid in the world XZ plane (= the app's XY
     ground plane): major (10-unit) lines brighter, minor (2-unit)
     lines dim, center lines on top */
  function buildGrid() {
    const minor = [], major = [], center = [];
    for (let i = -WORLD_EXTENT; i <= WORLD_EXTENT; i += GRID_MINOR) {
      if (i === 0) continue; /* center lines handled separately */
      const arr = (i % GRID_MAJOR === 0) ? major : minor;
      arr.push(new T.Vector3(i, 0, -WORLD_EXTENT), new T.Vector3(i, 0, WORLD_EXTENT));
      arr.push(new T.Vector3(-WORLD_EXTENT, 0, i), new T.Vector3(WORLD_EXTENT, 0, i));
    }
    center.push(new T.Vector3(0, 0, -WORLD_EXTENT), new T.Vector3(0, 0, WORLD_EXTENT));
    center.push(new T.Vector3(-WORLD_EXTENT, 0, 0), new T.Vector3(WORLD_EXTENT, 0, 0));
    scene.add(gridLines(center, COLORS.gridCenter, 0.95));
    scene.add(gridLines(major, COLORS.grid, 0.6));
    scene.add(gridLines(minor, COLORS.grid, 0.3));
  }

  function gridLines(verts, color, opacity) {
    return new T.LineSegments(
      new T.BufferGeometry().setFromPoints(verts),
      new T.LineBasicMaterial({ color, transparent: true, opacity })
    );
  }

  function buildBase() {
    /* ground reference grid (world XZ = app XY plane) */
    buildGrid();

    /* lighting for the shaded translucent sphere in spherical mode
       (everything else in the scene uses unlit basic materials) */
    scene.add(new T.AmbientLight(0xffffff, 0.55));
    const keyLight = new T.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(8, 12, 6);
    scene.add(keyLight);

    /* color-coded axes: bright positive half with arrowhead,
       faint solid negative tail, canvas-texture label.
       Directions are app-space arrays → v3() maps them to the
       world (so [0,0,1] runs vertically, [0,1,0] runs horizontally). */
    const axes = [
      { dir: [1, 0, 0], color: COLORS.x, label: 'X' },
      { dir: [0, 1, 0], color: COLORS.y, label: 'Y' },
      { dir: [0, 0, 1], color: COLORS.z, label: 'Z' }
    ];
    axes.forEach(a => {
      const d = v3(a.dir);
      scene.add(solidLine(v3(d).multiplyScalar(-WORLD_EXTENT), new T.Vector3(), COLORS.axisTail, 0.6));
      scene.add(new T.ArrowHelper(d, new T.Vector3(), WORLD_EXTENT, a.color, 2, 1));
      const label = makeLabel(a.label, css(a.color), 0.5);
      label.userData.base = 0.5;
      label.userData.dir = d.clone();
      axisLabels.push(label);
      scene.add(label);
    });

    /* origin label */
    const oLabel = makeLabel('O', '#7fa3d6', 0.5);
    oLabel.userData.base = 0.5;
    oLabel.position.set(-0.5, -0.5, -0.5);
    axisLabels.push(oLabel);
    scene.add(oLabel);

    /* point marker + soft halo */
    marker = new T.Mesh(
      new T.SphereGeometry(0.09, 24, 24),
      new T.MeshBasicMaterial({ color: COLORS.marker })
    );
    scene.add(marker);

    glow = makeGlow(0.9);
    scene.add(glow);

    /* vector from the origin to the point.
       Geometry is preallocated; positions are written per update. */
    vectorLine = new T.Line(
      new T.BufferGeometry(),
      new T.LineBasicMaterial({ color: COLORS.accent.rect })
    );
    vectorLine.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
    vectorLine.frustumCulled = false;
    scene.add(vectorLine);

    /* overlay group — rebuilt whenever the point or mode changes */
    overlay = new T.Group();
    scene.add(overlay);
  }

  /* ----------------------------------------------------------------
     dynamic scene updates
  ---------------------------------------------------------------- */

  function setMode(m) {
    mode = m;
    vectorLine.material.color.set(COLORS.accent[mode]);
    rebuildOverlay();
  }

  function updatePoint(p) {
    const v = v3(p.x, p.y, p.z);
    marker.position.copy(v);
    glow.position.copy(v);

    const len = v.length();
    if (len > EPS) {
      vectorLine.visible = true;
      vectorLine.material.color.set(COLORS.accent[mode]);
      const pos = vectorLine.geometry.attributes.position;
      pos.setXYZ(0, 0, 0, 0);
      pos.setXYZ(1, p.x, p.z, p.y);
      pos.needsUpdate = true;
    } else {
      vectorLine.visible = false;
    }

    rebuildOverlay();
  }

  /* ----------------------------------------------------------------
     reference geometry overlays (one per mode)
     Overlay builders work in app coordinates (Z vertical); every
     vector that reaches three.js goes through v3().
  ---------------------------------------------------------------- */

  function rebuildOverlay() {
    disposeGroup(overlay);
    const p = marker.position;
    if (mode === 'rect') buildRectOverlay(p);
    else if (mode === 'cyl') buildCylOverlay(p);
    else buildSphOverlay(p);
  }

  /* ---- Rectangular mode: dashed bounding box, color-coded edges ---- */
  function buildRectOverlay(p) {
    const ax = p.x, ay = p.z, az = p.y; /* world → app */
    if (Math.abs(ax) + Math.abs(ay) + Math.abs(az) < EPS) return;
    const x = ax, y = ay, z = az;
    const A = [0, 0, 0], B = [x, 0, 0], C = [0, y, 0], D = [0, 0, z];
    const E = [x, y, 0], F = [x, 0, z], G = [0, y, z], H = [x, y, z];

    /* the 12 box edges; each edge is drawn in the color of the
       axis it runs parallel to (showing x, y, z as edges) */
    [[A, B], [C, E], [D, F], [G, H]].forEach(e =>
      overlay.add(dashedLine(v3(e[0]), v3(e[1]), COLORS.x, 0.8)));
    [[A, C], [B, E], [D, G], [F, H]].forEach(e =>
      overlay.add(dashedLine(v3(e[0]), v3(e[1]), COLORS.y, 0.8)));
    [[A, D], [B, F], [C, G], [E, H]].forEach(e =>
      overlay.add(dashedLine(v3(e[0]), v3(e[1]), COLORS.z, 0.8)));

    /* intercept dots: projections of the point onto the axes and the XY plane */
    if (Math.abs(x) > EPS) overlay.add(dot([x, 0, 0], COLORS.x, 0.05, 1));
    if (Math.abs(y) > EPS) overlay.add(dot([0, y, 0], COLORS.y, 0.05, 1));
    if (Math.abs(z) > EPS) overlay.add(dot([0, 0, z], COLORS.z, 0.05, 1));
    if (Math.abs(x) > EPS && Math.abs(y) > EPS) overlay.add(dot([x, y, 0], 0xffffff, 0.045, 0.9));
  }

  /* ---- Cylindrical mode (r, θ, z): base/rim circles, radial r,
         vertical riser z, θ arc in the ground plane ---- */
  function buildCylOverlay(p) {
    const ax = p.x, ay = p.z, az = p.y; /* world → app */
    const col = COLORS.accent.cyl;
    const r = Math.hypot(ax, ay);
    const theta = Math.atan2(ay, ax);

    if (r > EPS) {
      /* dashed circle of radius r in the XY plane + rim at height z */
      overlay.add(dashedCircle(r, 0, col, 0.45));
      if (Math.abs(az) > EPS) overlay.add(dashedCircle(r, az, col, 0.45));

      /* radial line from the origin to the XY projection */
      overlay.add(solidLine(v3([0, 0, 0]), v3([ax, ay, 0]), col, 0.9));

      /* azimuth arc sweeping θ from the +X axis */
      const arcR = clamp(r * 0.45, 0.18, 0.5);
      if (Math.abs(theta) > 1e-4) {
        overlay.add(dashedArcXY(arcR, 0, theta, col, 0.9));
        const lab = makeLabel('θ', css(col), 0.4 * dashScale);
        lab.position.set(
          Math.cos(theta / 2) * (arcR + 0.24),
          0,
          Math.sin(theta / 2) * (arcR + 0.24));
        overlay.add(lab);
      }

      const rLab = makeLabel('r', css(col), 0.4 * dashScale);
      rLab.position.set(ax / 2, 0, ay / 2);
      overlay.add(rLab);

      overlay.add(dot([ax, ay, 0], col, 0.05, 1));
    }

    /* vertical dashed riser (the z component) */
    if (Math.abs(az) > EPS) {
      overlay.add(dashedLine(v3([ax, ay, 0]), v3([ax, ay, az]), col, 0.85));
      const zLab = makeLabel('z', css(col), 0.4 * dashScale);
      zLab.position.set(ax, az / 2, ay);
      overlay.add(zLab);
    }
  }

  /* ---- Spherical mode (ρ, θ, φ): translucent shell, polar φ arc,
         azimuthal θ arc ---- */
  function buildSphOverlay(p) {
    const ax = p.x, ay = p.z, az = p.y; /* world → app */
    const col = COLORS.accent.sph;
    const rho = Math.hypot(ax, ay, az);
    if (rho < EPS) return;

    /* simple translucent sphere — smooth shaded surface, no wireframe */
    overlay.add(new T.Mesh(
      new T.SphereGeometry(rho, 48, 32),
      new T.MeshPhongMaterial({
        color: col, transparent: true, opacity: 0.22,
        depthWrite: false, side: T.DoubleSide, shininess: 40
      })
    ));

    const theta = Math.atan2(ay, ax);                 /* azimuth from +X */
    const phi = Math.acos(clamp(az / rho, -1, 1));    /* polar from +Z */

    /* polar arc: from the +Z axis down to the vector,
       in the vertical plane at azimuth θ */
    if (phi > 1e-4) {
      overlay.add(dashedArcTheta(rho, theta, phi, col, 0.9));
      const lab = makeLabel('φ', css(col), 0.42 * dashScale);
      const pm = phi / 2;
      lab.position.set(
        rho * Math.sin(pm) * Math.cos(theta) * 1.16,
        rho * Math.cos(pm) * 1.16,
        rho * Math.sin(pm) * Math.sin(theta) * 1.16);
      overlay.add(lab);
    }

    /* azimuthal arc in the XY plane, radius ρ·sin φ */
    const rPlane = rho * Math.sin(phi);
    if (rPlane > 1e-4 && Math.abs(theta) > 1e-4) {
      overlay.add(dashedArcXY(rPlane, 0, theta, col, 0.9));
      const lab = makeLabel('θ', css(col), 0.42 * dashScale);
      lab.position.set(
        Math.cos(theta / 2) * (rPlane + 0.24),
        0,
        Math.sin(theta / 2) * (rPlane + 0.24));
      overlay.add(lab);
    }

    const rhoLab = makeLabel('ρ', css(col), 0.42 * dashScale);
    rhoLab.position.set(ax * 0.5, az * 0.5, ay * 0.5);
    overlay.add(rhoLab);

    overlay.add(dot([ax, ay, 0], col, 0.045, 0.9));
  }

  /* ----------------------------------------------------------------
     geometry helpers
     All helpers that receive "from/to" points expect world-space
     THREE.Vector3 values (use v3() to convert from app space).
  ---------------------------------------------------------------- */

  function dashedLine(a, b, color, opacity) {
    if (a.distanceTo(b) < EPS) return new T.Group(); /* degenerate */
    const geo = new T.BufferGeometry().setFromPoints([a, b]);
    const mat = new T.LineDashedMaterial({
      color, dashSize: 0.13 * dashScale, gapSize: 0.09 * dashScale, transparent: true, opacity
    });
    const line = new T.Line(geo, mat);
    line.computeLineDistances();
    return line;
  }

  function solidLine(a, b, color, opacity) {
    if (a.distanceTo(b) < EPS) return new T.Group();
    const geo = new T.BufferGeometry().setFromPoints([a, b]);
    return new T.Line(geo, new T.LineBasicMaterial({ color, transparent: true, opacity }));
  }

  /* dashed circle in a plane parallel to the ground (app XY plane),
     at height y (the app's z) — world coords are (cos·r, y, sin·r) */
  function dashedCircle(radius, y, color, opacity, segments) {
    const n = segments || 96;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(new T.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
    const geo = new T.BufferGeometry().setFromPoints(pts);
    const mat = new T.LineDashedMaterial({
      color, dashSize: 0.12 * dashScale, gapSize: 0.09 * dashScale, transparent: true, opacity
    });
    const line = new T.Line(geo, mat);
    line.computeLineDistances();
    return line;
  }

  /* dashed circular arc in the ground plane (app XY), sweeping a0 → a1 */
  function dashedArcXY(radius, a0, a1, color, opacity) {
    const sweep = a1 - a0;
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 48)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + sweep * (i / n);
      pts.push(new T.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new T.BufferGeometry().setFromPoints(pts);
    const mat = new T.LineDashedMaterial({
      color, dashSize: 0.11 * dashScale, gapSize: 0.08 * dashScale, transparent: true, opacity
    });
    const line = new T.Line(geo, mat);
    line.computeLineDistances();
    return line;
  }

  /* dashed polar arc on a sphere of radius r: from the +Z axis
     (φ = 0) down to φ = polar, in the vertical plane at azimuth
     `azim`. App points (r sin t cos a, r sin t sin a, r cos t) become
     the world positions (r sin t cos a, r cos t, r sin t sin a). */
  function dashedArcTheta(r, azim, polar, color, opacity) {
    const n = Math.max(2, Math.ceil(polar / (Math.PI / 48)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = polar * (i / n);
      pts.push(new T.Vector3(
        r * Math.sin(t) * Math.cos(azim),
        r * Math.cos(t),
        r * Math.sin(t) * Math.sin(azim)
      ));
    }
    const geo = new T.BufferGeometry().setFromPoints(pts);
    const mat = new T.LineDashedMaterial({
      color, dashSize: 0.11 * dashScale, gapSize: 0.08 * dashScale, transparent: true, opacity
    });
    const line = new T.Line(geo, mat);
    line.computeLineDistances();
    return line;
  }

  function dot(pos, color, size, opacity) {
    const m = new T.Mesh(
      new T.SphereGeometry(size * dashScale, 12, 8),
      new T.MeshBasicMaterial({ color, transparent: true, opacity })
    );
    m.position.copy(v3(pos));
    return m;
  }

  /* text label rendered as a canvas-texture sprite (always faces the camera) */
  function makeLabel(text, color, worldHeight) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d');
    g.font = 'bold 80px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 64, 64);
    const tex = new T.CanvasTexture(cv);
    const sprite = new T.Sprite(new T.SpriteMaterial({
      map: tex, transparent: true, depthTest: false
    }));
    sprite.scale.set(worldHeight, worldHeight, 1);
    return sprite;
  }

  /* soft additive halo behind the point marker */
  function makeGlow(size) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 224, 140, 0.85)');
    grad.addColorStop(0.4, 'rgba(255, 190, 90, 0.25)');
    grad.addColorStop(1, 'rgba(255, 190, 90, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new T.CanvasTexture(cv);
    const sprite = new T.Sprite(new T.SpriteMaterial({
      map: tex, transparent: true, blending: T.AdditiveBlending, depthWrite: false
    }));
    sprite.scale.set(size, size, 1);
    return sprite;
  }

  /* recursively release GPU resources before discarding geometry */
  function disposeGroup(group) {
    while (group.children.length) {
      const child = group.children.pop();
      group.remove(child);
      child.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (!m) return;
          if (m.map) m.map.dispose();
          m.dispose();
        });
      });
    }
  }

  global.CoordScene = { init, setMode, updatePoint, resetCamera, setZoom, getZoom, onRadiusChange };
})(window);
