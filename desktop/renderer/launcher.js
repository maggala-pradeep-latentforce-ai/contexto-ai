// Manual drag handling — NOT -webkit-app-region: drag, which intercepts
// mousedown at the OS level and swallows click events, so the button would
// move but never open. Instead: track movement since mousedown, and only
// treat it as a drag once it crosses a small threshold; a quick tap with no
// meaningful movement fires the toggle instead.
var btn = document.getElementById('launcherBtn');
var DRAG_THRESHOLD = 4; // px
var isDown = false, dragged = false, startX = 0, startY = 0;

btn.addEventListener('mousedown', function (e) {
  isDown = true; dragged = false;
  startX = e.screenX; startY = e.screenY;
});

window.addEventListener('mousemove', function (e) {
  if (!isDown) return;
  var dx = e.screenX - startX, dy = e.screenY - startY;
  if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragged = true;
  if (dragged) {
    window.contexto.moveLauncherBy(e.movementX, e.movementY);
  }
});

window.addEventListener('mouseup', function () {
  if (isDown && !dragged) window.contexto.togglePanel();
  isDown = false; dragged = false;
});
