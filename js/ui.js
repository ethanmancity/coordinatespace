/* ============================================================
   Coordinate Space — sidebar / toolbar UI
   ------------------------------------------------------------
   Reads values from the sidebar inputs, feeds them to the state
   engine, and writes the synced results back. Every coordinate
   has a textbox AND a slider; the section the user is currently
   editing is never overwritten while typing (sync happens on
   debounced input, with a full re-sync on blur/slider release).
   A toolbar zoom slider mirrors the camera radius.
   ============================================================ */
(function (global) {
  'use strict';

  const C = global.CoordMath;
  const S = global.CoordState;

  const SECTIONS = ['rect', 'cyl', 'sph'];

  /* textbox element ids per section (sliders reuse the id with
     a "slider-" prefix, e.g. "slider-rect-x") */
  const FIELDS = {
    rect: { x: 'rect-x', y: 'rect-y', z: 'rect-z' },
    cyl:  { rho: 'cyl-rho', phi: 'cyl-phi', z: 'cyl-z' },
    sph:  { r: 'sph-r', theta: 'sph-theta', phi: 'sph-phi' }
  };

  /* per-mode accent colors (must match CSS + scene) */
  const ACCENTS = { rect: '#ffb020', cyl: '#26d0ee', sph: '#c48aff' };

  /* linear slider ranges (per display units, for angles).
     x/y/z are limited to ±10 for fine control near the origin;
     r/ρ go further so the ±100 world corners stay reachable
     (ρ_max = √(100²+100²) ≈ 141, r_max = √(100²·3) ≈ 173) */
  const LINEAR_RANGES = {
    'rect-x':  { min: -10, max: 10,  step: 0.01 },
    'rect-y':  { min: -10, max: 10,  step: 0.01 },
    'rect-z':  { min: -10, max: 10,  step: 0.01 },
    'cyl-rho': { min: 0,    max: 150, step: 0.01 },
    'cyl-z':   { min: -10,  max: 10,  step: 0.01 },
    'sph-r':   { min: 0,    max: 180, step: 0.01 }
  };
  const ANGLE_RANGES = {
    deg: { phi:   { min: -180, max: 180, step: 1 },
           theta: { min: 0,    max: 180, step: 1 } },
    rad: { phi:   { min: -Math.PI, max: Math.PI, step: 0.01 },
           theta: { min: 0,       max: Math.PI, step: 0.01 } }
  };

  const inputs = {};
  const sliders = {};
  const debounce = {};

  /* which element caused the current edit — textbox edits skip their
     own section during sync, slider edits write back everywhere */
  let editSource = { section: null, kind: 'text' };

  const el = id => document.getElementById(id);

  /* ---------------- formatting ---------------- */

  const fmtCoord = v => String(Number(v.toFixed(4)));
  const fmt3 = v => (v + 0).toFixed(3); /* readout, fixed precision */

  const angleToDisplay = rad => (S.getUnits() === 'deg' ? C.deg(rad) : rad);
  const angleFromDisplay = v => (S.getUnits() === 'deg' ? C.rad(v) : v);

  function fmtAngle(rad) {
    const dp = S.getUnits() === 'deg' ? 2 : 4;
    return String(Number(angleToDisplay(rad).toFixed(dp)));
  }

  /* ---------------- parsing (display units → radians) ---------------- */

  function readInputs(section) {
    const f = FIELDS[section], out = {};
    for (const key in f) {
      const raw = inputs[f[key]].value.trim();
      out[key] = raw === '' ? NaN : Number(raw);
    }
    return out;
  }

  /* Returns the section's values with angles in radians, or null while
     the entry is incomplete (mid-typing states like "1." or "-"). */
  function parse(section) {
    const v = readInputs(section);
    for (const key in v) if (isNaN(v[key])) return null;
    if (section === 'cyl') v.phi = angleFromDisplay(v.phi);
    if (section === 'sph') {
      v.theta = angleFromDisplay(v.theta);
      v.phi = angleFromDisplay(v.phi);
    }
    return v;
  }

  /* ---------------- writing synced values into the DOM ---------------- */

  /* sliders have a fixed range — values outside it are clamped */
  function setSlider(id, value) {
    const s = sliders[id];
    if (!s) return;
    s.value = String(clampValue(value, parseFloat(s.min), parseFloat(s.max)));
  }

  const clampValue = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function writeSection(section, sec) {
    if (section === 'rect') {
      setField('rect-x', fmtCoord(sec.x));
      setField('rect-y', fmtCoord(sec.y));
      setField('rect-z', fmtCoord(sec.z));
      setSlider('rect-x', sec.x);
      setSlider('rect-y', sec.y);
      setSlider('rect-z', sec.z);
    } else if (section === 'cyl') {
      setField('cyl-rho', fmtCoord(sec.rho));
      setField('cyl-phi', fmtAngle(C.normAngle(sec.phi)));
      setField('cyl-z', fmtCoord(sec.z));
      setSlider('cyl-rho', sec.rho);
      setSlider('cyl-phi', angleToDisplay(C.normAngle(sec.phi)));
      setSlider('cyl-z', sec.z);
    } else {
      setField('sph-r', fmtCoord(sec.r));
      setField('sph-theta', fmtAngle(sec.theta));
      setField('sph-phi', fmtAngle(C.normAngle(sec.phi)));
      setSlider('sph-r', sec.r);
      setSlider('sph-theta', angleToDisplay(sec.theta));
      setSlider('sph-phi', angleToDisplay(C.normAngle(sec.phi)));
    }
  }

  function setField(id, value) { inputs[id].value = value; }

  /* `skip` is the section being edited by hand — its fields stay
     untouched so the user's cursor/typing is never fought. */
  function writeSections(sections, skip) {
    SECTIONS.forEach(section => {
      if (section !== skip) writeSection(section, sections[section]);
    });
  }

  function renderAll() {
    writeSections(S.getSections(), null);
    refreshReadout();
  }

  /* ---------------- readout ---------------- */

  function refreshReadout(point) {
    const p = point || S.getPoint();
    el('readout-val').textContent =
      '(' + fmt3(p.x) + ', ' + fmt3(p.y) + ', ' + fmt3(p.z) + ')';
  }

  /* ---------------- actions ---------------- */

  function commit(section) {
    const values = parse(section);
    if (!values) return;
    S.applySection(section, values);
  }

  function setUnits(unit) {
    S.setUnits(unit);
    document.querySelectorAll('#unit-toggle .unit-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.unit === unit));
    document.querySelectorAll('.unit-tag')
      .forEach(t => { t.textContent = unit === 'deg' ? '°' : 'rad'; });
    updateSliderRanges();
    renderAll();
  }

  function setMode(m) {
    document.querySelectorAll('#mode-toggle .mode-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    el('toolbar').style.setProperty('--mode-acc', ACCENTS[m]);
    global.CoordScene.setMode(m);
  }

  function refreshActive() {
    const active = S.getActive();
    document.querySelectorAll('.section')
      .forEach(sec => sec.classList.toggle('active', sec.dataset.section === active));
  }

  /* ---------------- slider ranges ---------------- */

  function sliderRangeFor(id) {
    if (id === 'cyl-phi' || id === 'sph-theta') return ANGLE_RANGES[S.getUnits()].phi;
    if (id === 'sph-phi') return ANGLE_RANGES[S.getUnits()].theta;
    return LINEAR_RANGES[id];
  }

  function updateSliderRanges() {
    Object.keys(sliders).forEach(id => {
      const r = sliderRangeFor(id);
      sliders[id].min = r.min;
      sliders[id].max = r.max;
      sliders[id].step = r.step;
    });
  }

  /* ---------------- wiring ---------------- */

  function init() {
    SECTIONS.forEach(section => {
      for (const key in FIELDS[section]) {
        const id = FIELDS[section][key];
        const input = el(id);
        const slider = el('slider-' + id);
        inputs[id] = input;
        sliders[id] = slider;

        /* ---- textbox ---- */
        input.addEventListener('focus', () => {
          S.setActive(section);
          refreshActive();
        });

        input.addEventListener('input', () => {
          editSource = { section, kind: 'text' };
          S.setActive(section);
          refreshActive();
          clearTimeout(debounce[section]);
          /* debounced sync — the active section is never rewritten */
          debounce[section] = setTimeout(() => commit(section), 120);
        });

        input.addEventListener('blur', () => {
          clearTimeout(debounce[section]);
          commit(section);   /* push final values into the canonical state */
          renderAll();       /* write corrected/clamped values into every field */
        });

        /* ---- slider ---- */
        slider.addEventListener('input', () => {
          editSource = { section, kind: 'slider' };
          S.setActive(section);
          refreshActive();
          /* mirror into the textbox so the row always reads consistently */
          input.value = slider.value;
          clearTimeout(debounce[section]);
          debounce[section] = setTimeout(() => commit(section), 60);
        });

        slider.addEventListener('change', () => {
          clearTimeout(debounce[section]);
          commit(section);
          renderAll();
        });
      }
    });

    /* ---- unit toggle ---- */
    document.querySelectorAll('#unit-toggle .unit-btn')
      .forEach(btn => btn.addEventListener('click', () => setUnits(btn.dataset.unit)));

    /* ---- view mode ---- */
    document.querySelectorAll('#mode-toggle .mode-btn')
      .forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

    /* ---- camera controls ---- */
    el('reset-cam').addEventListener('click', () => global.CoordScene.resetCamera());

    const zoomSlider = el('zoom-slider');
    zoomSlider.addEventListener('input', () => {
      global.CoordScene.setZoom(zoomSlider.value / 100);
    });
    global.CoordScene.onRadiusChange((radius, t) => {
      zoomSlider.value = String((t * 100).toFixed(1));
    });
    zoomSlider.value = String((global.CoordScene.getZoom() * 100).toFixed(1));

    /* ---- mobile drawer ---- */
    el('drawer-toggle').addEventListener('click', () => {
      const open = document.body.classList.toggle('drawer-open');
      el('drawer-toggle').setAttribute('aria-expanded', String(open));
    });
    el('drawer-scrim').addEventListener('click', () => {
      document.body.classList.remove('drawer-open');
      el('drawer-toggle').setAttribute('aria-expanded', 'false');
    });

    updateSliderRanges();
    setMode('rect');
    refreshActive();
    renderAll();
  }

  /* state → UI hook, called by the state engine after every edit */
  function onState(point, sections, src) {
    global.CoordScene.updatePoint(point);
    /* skip the active section only when the edit came from typing */
    const skip = (editSource.kind === 'text' && editSource.section === src) ? src : null;
    writeSections(sections, skip);
    refreshReadout(point);
  }

  global.CoordUI = { init, onState, renderAll };
})(window);
