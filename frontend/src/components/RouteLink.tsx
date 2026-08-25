import type { MouseEvent, ReactNode } from "react";
import { navigate, type AppRoute } from "../lib/routes";

export function RouteLink({ to, className, children }: { to: AppRoute; className?: string; children: ReactNode }) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={to} className={className} onClick={follow}>
      {children}
    </a>
  );
}
