import { useEffect, useState } from "react";
import { currentRoute } from "../lib/routes";

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return route;
}
