export type AppRoute = "/" | "/app" | "/app/save" | "/app/draw";

const ROUTES = new Set<AppRoute>(["/", "/app", "/app/save", "/app/draw"]);

const LEGACY_REDIRECTS: Record<string, AppRoute> = {
  "/app/vault": "/app/save",
  "/app/draws": "/app/draw",
  "/app/prizes": "/app/draw",
  "/app/history": "/app/draw",
  "/app/more": "/app",
};

function normalizedPath() {
  return window.location.pathname.length > 1 ? window.location.pathname.replace(/\/$/, "") : "/";
}

export function currentRoute(): AppRoute {
  const normalized = normalizedPath();
  const redirected = LEGACY_REDIRECTS[normalized];
  if (redirected) {
    const suffix = `${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", `${redirected}${suffix}`);
    return redirected;
  }
  return ROUTES.has(normalized as AppRoute) ? (normalized as AppRoute) : normalized.startsWith("/app") ? "/app" : "/";
}

export function navigate(to: AppRoute) {
  if (window.location.pathname !== to) window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}
