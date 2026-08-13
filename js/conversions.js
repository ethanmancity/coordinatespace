/* ============================================================
   Coordinate Space — coordinate conversion math
   ------------------------------------------------------------
   Pure functions, no DOM / three.js dependencies.
   All angles are radians. Conventions:

     Cylindrical (r, θ, z): r ≥ 0, θ from +X in the XY plane
     Spherical   (ρ, θ, φ): ρ ≥ 0, θ from +Z axis (polar, 0…π),
                            φ from +X in the XY plane (azimuthal)
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
  /* x = ρ·sin θ·cos φ, y = ρ·sin θ·sin φ, z = ρ·cos θ */
  function sphToCart(r, theta, phi) {
    const st = Math.sin(theta);
    return {
      x: r * st * Math.cos(phi),
      y: r * st * Math.sin(phi),
      z: r * Math.cos(theta)
    };
  }

  /* ---- Rectangular → Spherical ---- */
  /* ρ = √(x² + y² + z²), θ = acos(z/ρ), φ = atan2(y, x)
     θ is NaN when ρ = 0 (undefined at the origin) — callers
     must fall back to a last-known or default angle. */
  function cartToSph(x, y, z) {
    const r = Math.hypot(x, y, z);
    return {
      r,
      theta: r > EPS ? Math.acos(clamp(z / r, -1, 1)) : NaN,
      phi: Math.atan2(y, x)
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
