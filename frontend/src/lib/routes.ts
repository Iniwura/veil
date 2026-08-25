export type AppRoute =
  | "/"
  | "/app"
  | "/app/save"
  | "/app/draws"
  | "/app/vault"
  | "/app/prizes"
  | "/app/history"
  | "/app/more";

const ROUTES = new Set<AppRoute>([
  "/",
  "/app",
  "/app/save",
  "/app/draws",
  "/app/vault",
  "/app/prizes",
  "/app/history",
  "/app/more",
]);

export function currentRoute(): AppRoute {
  const normalized = window.location.pathname.length > 1 ? window.location.pathname.replace(/\/$/, "") : "/";
  return ROUTES.has(normalized as AppRoute) ? (normalized as AppRoute) : normalized.startsWith("/app") ? "/app" : "/";
}

export function navigate(to: AppRoute) {
  if (window.location.pathname !== to) window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}
