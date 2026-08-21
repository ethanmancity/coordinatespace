/* ============================================================
   Coordinate Space — state & sync engine
   ------------------------------------------------------------
   Single source of truth: the rectangular point {x, y, z}.
   Every edit in any of the three sections is converted to that
   point, then the other two sections are re-derived from it.

   Angles are always stored in radians; the display-unit
   conversion (deg/rad) is applied by the UI layer.
   ============================================================ */
(function (global) {
  'use strict';

  const C = global.CoordMath;

  /* ---- canonical point (the source of truth) ---- */
  let canonical = { x: 1.5, y: 1.0, z: 1.5 };

  /* display unit for angles ('deg' | 'rad'); math stays in radians */
  let units = 'deg';

  /* section currently being edited — the UI never overwrites its fields */
  let activeSection = null;

  /* θ is undefined at the origin (ρ = 0). Remember the last
     non-degenerate spherical angles so the display doesn't snap
     to zero when the point passes through the origin. */
  let lastSph = C.cartToSph(canonical.x, canonical.y, canonical.z);
  if (isNaN(lastSph.theta)) lastSph = { theta: 0, phi: 0 };

  const subscribers = [];

  function subscribe(fn) { subscribers.push(fn); }

  function getPoint() { return { x: canonical.x, y: canonical.y, z: canonical.z }; }

  function getUnits() { return units; }
  function setUnits(u) { units = u; }

  function getActive() { return activeSection; }
  function setActive(s) { activeSection = s; }

  /* Recompute the cylindrical + spherical representations from the
     canonical rectangular point. All angles returned in radians. */
  function computeSections() {
    const cyl = C.cartToCyl(canonical.x, canonical.y, canonical.z);
    const sph = C.cartToSph(canonical.x, canonical.y, canonical.z);
    if (!isNaN(sph.theta)) {
      lastSph = { theta: sph.theta, phi: sph.phi };
    } else {
      /* degenerate at origin → reuse last known angles */
      sph.theta = lastSph.theta;
      sph.phi = lastSph.phi;
    }
    return { rect: getPoint(), cyl, sph };
  }

  /* Apply an edit coming from one section. `v` holds that section's
   values with angles already in radians. Invalid magnitudes are
   clamped: ρ ≥ 0, r ≥ 0, θ ∈ [0, π]. */
  function applySection(section, v) {
    let pt;
    switch (section) {
      case 'rect':
        pt = { x: v.x, y: v.y, z: v.z };
        break;
      case 'cyl': {
        const rho = Math.max(0, v.rho);
        pt = C.cylToCart(rho, v.phi, v.z);
        break;
      }
      case 'sph': {
        const r = Math.max(0, v.r);
        const theta = C.clamp(v.theta, 0, Math.PI);
        pt = C.sphToCart(r, theta, v.phi);
        break;
      }
    }

    /* never let non-finite junk reach the canonical state */
    if (!isFinite(pt.x) || !isFinite(pt.y) || !isFinite(pt.z)) return;

    canonical = pt;
    fire();
  }

  function fire() {
    const sections = computeSections();
    subscribers.forEach(fn => fn(getPoint(), sections, activeSection));
  }

  global.CoordState = {
    subscribe,
    getPoint,
    getUnits,
    setUnits,
    getActive,
    setActive,
    applySection,
    getSections: computeSections
  };
})(window);
