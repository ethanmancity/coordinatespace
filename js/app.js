/* ============================================================
   Coordinate Space — bootstrap
   ------------------------------------------------------------
   Wire the state engine to the UI and the scene, then paint
   the initial state.
   ============================================================ */
(function () {
  'use strict';

  /* three.js failed to load (CDN unreachable) — show a notice */
  if (!window.THREE) {
    document.getElementById('viewport').innerHTML =
      '<div style="color:#8aa3c4;font-family:monospace;padding:24px;font-size:12px">' +
      'Could not load three.js from the CDN — check your internet connection.</div>';
    return;
  }

  /* every state change → update the scene + synced fields */
  window.CoordState.subscribe(window.CoordUI.onState);

  window.CoordScene.init(document.getElementById('viewport'));
  window.CoordUI.init();

  /* initial paint */
  window.CoordScene.updatePoint(window.CoordState.getPoint());
})();
