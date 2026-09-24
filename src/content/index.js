// Contexto AI - Content Script
var _lastText = ""; var _lastTs = 0;
document.addEventListener("copy", function() {
  setTimeout(function() {
    try {
      var sel = window.getSelection();
      var text = sel ? sel.toString().trim() : "";
      if (!text || text.length < 2) return;
      var now = Date.now();
      if (text === _lastText && now - _lastTs < 600) return;
      _lastText = text; _lastTs = now;
      var payload = {
        id: crypto.randomUUID(), type: "text", content: text,
        url: location.href, title: document.title,
        favicon: getFavicon(), domain: location.hostname,
        createdAt: now, vector: null
      };
      chrome.runtime.sendMessage({ type: "NEW_CLIP", data: payload }).catch(function(){});
    } catch(e) {}
  }, 60);
});
function getFavicon() {
  var el = document.querySelector("link[rel~=icon]") || document.querySelector("link[rel~=shortcut]");
  if (el && el.href) return el.href;
  return "https://www.google.com/s2/favicons?domain=" + location.hostname + "&sz=32";
}
