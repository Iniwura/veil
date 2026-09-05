import { useEffect, useRef, useState } from "react";
import { currentRoute } from "../lib/routes";
import { visualTransition } from "../lib/visualTransition";

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  const [transitioning, setTransitioning] = useState(false);
  const requestedRoute = useRef(route);
  const transitionTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onPopState = () => {
      const next = currentRoute();
      if (next === requestedRoute.current) return;
      requestedRoute.current = next;
      if (transitionTimer.current !== undefined) window.clearTimeout(transitionTimer.current);
      setTransitioning(true);
      visualTransition(() => setRoute(currentRoute()), "route");
      transitionTimer.current = window.setTimeout(() => {
        setTransitioning(false);
        transitionTimer.current = undefined;
      }, 220);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (transitionTimer.current !== undefined) window.clearTimeout(transitionTimer.current);
    };
  }, []);
  return { route, transitioning };
}
