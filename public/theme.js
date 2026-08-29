/* Shared dark/light theme toggle (Multify ships both, via [data-theme]).
   Loaded before other scripts so there's no flash of the wrong theme. */
(function () {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.dataset.theme = saved;

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    const setIcon = () => { btn.textContent = document.documentElement.dataset.theme === "dark" ? "☀" : "☾"; };
    setIcon();
    btn.onclick = () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("theme", next);
      setIcon();
      document.dispatchEvent(new CustomEvent("themechange"));
    };
  });
})();
