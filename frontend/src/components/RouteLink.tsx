import type { MouseEvent, ReactNode } from "react";
import { navigate, type AppRoute } from "../lib/routes";

export function RouteLink({
  to,
  className,
  children,
  dataCursor,
}: {
  to: AppRoute;
  className?: string;
  children: ReactNode;
  dataCursor?: "enter" | "sealed" | "verify";
}) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={to} className={className} onClick={follow} data-cursor={dataCursor}>
      {children}
    </a>
  );
}
