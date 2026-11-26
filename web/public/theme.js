// Applies a stored theme choice before the first paint, so the page does not flash.
try {
  var theme = localStorage.getItem("ypea-studio-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (error) {
  // storage is blocked: the system preference applies
}
