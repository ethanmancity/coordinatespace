/* ============================================================
   Coordinate Space — coordinate conversion math
   ------------------------------------------------------------
   Pure functions, no DOM / three.js dependencies.
   All angles are radians. Conventions:

     Cylindrical (r, θ, z): r ≥ 0, θ from +X in the XY plane
     Spherical   (ρ, θ, φ): ρ ≥ 0, θ from +X in the XY plane,
                            φ from +Z axis (polar)
   ============================================================ */
(function (global) {
  'use strict';

  const DEG2RAD = Math.PI / 180;
  const EPS = 1e-12;

  const rad = d => d * DEG2RAD;
  const deg = r => r / DEG2RAD;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---- Cylindrical → Rectangular ---- */
  /* x = ρ·cos φ, y = ρ·sin φ, z = z */
  function cylToCart(rho, phi, z) {
    return { x: rho * Math.cos(phi), y: rho * Math.sin(phi), z: z };
  }

  /* ---- Rectangular → Cylindrical ---- */
  /* ρ = √(x² + y²), φ = atan2(y, x), z = z */
  function cartToCyl(x, y, z) {
    return { rho: Math.hypot(x, y), phi: Math.atan2(y, x), z: z };
  }

  /* ---- Spherical → Rectangular ---- */
  /* x = ρ·sin φ·cos θ, y = ρ·sin φ·sin θ, z = ρ·cos φ */
  function sphToCart(r, theta, phi) {
    const sp = Math.sin(phi);
    return {
      x: r * sp * Math.cos(theta),
      y: r * sp * Math.sin(theta),
      z: r * Math.cos(phi)
    };
  }

  /* ---- Rectangular → Spherical ---- */
  /* ρ = √(x² + y² + z²), θ = atan2(y, x), φ = acos(z/ρ)
     φ is NaN when ρ = 0 (undefined at the origin) — callers
     must fall back to a last-known or default angle. */
  function cartToSph(x, y, z) {
    const r = Math.hypot(x, y, z);
    return {
      r,
      theta: Math.atan2(y, x),
      phi: r > EPS ? Math.acos(clamp(z / r, -1, 1)) : NaN
    };
  }

  /* ---- wrap an angle into (-π, π] ---- */
  function normAngle(a) {
    let v = a % (2 * Math.PI);
    if (v <= -Math.PI) v += 2 * Math.PI;
    if (v > Math.PI) v -= 2 * Math.PI;
    return v;
  }

  global.CoordMath = { rad, deg, clamp, cylToCart, cartToCyl, sphToCart, cartToSph, normAngle, EPS };
})(window);
