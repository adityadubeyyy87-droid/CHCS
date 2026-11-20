// sceneDrive.js — the tiny bridge between the page and the WebGL scene.
//
// Kept in its own module so the landing page can drive the camera without
// pulling three.js into the initial bundle. Landing writes; the scene reads
// once per frame.
export const sceneDrive = {
  scroll: 0,      // 0 → 1 across roughly the first viewport of the page
  smooth: 0,      // damped scroll, written by the camera rig
  mx: 0,          // pointer x, -1 → 1
  my: 0,          // pointer y, -1 → 1
  reduced: false, // honours prefers-reduced-motion
};
