import { useEffect, useRef, useState } from "react";
import { currentRoute } from "../lib/routes";
import { visualTransition } from "../lib/visualTransition";

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  const requestedRoute = useRef(route);
  useEffect(() => {
    const onPopState = () => {
      const next = currentRoute();
      if (next === requestedRoute.current) return;
      requestedRoute.current = next;
      visualTransition(() => setRoute(currentRoute()), "route");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return route;
}
