/* Runs before the application module graph, including TanStack Router, is loaded. */
(function () {
  const preview = document.currentScript?.dataset.preview === "true";
  const recoveryKey = "dbs-module-recovery-20261026-1";
  let recovered = false;
  try { recovered = sessionStorage.getItem(recoveryKey) === "1"; } catch (_) {
    recovered = new URL(location.href).searchParams.has("dbs_module_retry");
  }

  async function releasePreviewWorker() {
    if (!preview) return;
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.filter(registration => {
          const worker = registration.active || registration.waiting || registration.installing;
          if (!worker) return false;
          const url = new URL(worker.scriptURL);
          return url.origin === location.origin && url.pathname === "/sw.js";
        }).map(registration => registration.unregister()));
      }
      if (typeof caches !== "undefined") {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith("dbs-air-static-")).map(name => caches.delete(name)));
      }
    } catch (_) { /* Browser storage restrictions must not block application startup. */ }
  }

  const released = releasePreviewWorker();
  let startupFinished = false;
  window.addEventListener("dbs:app-ready", () => { startupFinished = true; });
  function isModuleFailure(error) {
    const message = String(error?.message || error || "");
    return /error loading dynamically imported module|failed to fetch dynamically imported module|importing a module script failed|loading chunk [\w-]+ failed/i.test(message);
  }
  async function recover(error, event) {
    // Never discard an already-open operational form because a later route import fails.
    if (startupFinished || recovered || !isModuleFailure(error)) return;
    recovered = true;
    const url = new URL(location.href);
    try { sessionStorage.setItem(recoveryKey, "1"); } catch (_) {
      url.searchParams.set("dbs_module_retry", "1");
    }
    event?.preventDefault();
    // The cleanup is best effort; a stalled browser API must not leave the screen blank.
    await Promise.race([released, new Promise(resolve => setTimeout(resolve, 1500))]);
    location.replace(url.href);
  }
  window.addEventListener("unhandledrejection", event => { void recover(event.reason, event); });
  window.addEventListener("vite:preloadError", event => { void recover(event.payload, event); });
})();
