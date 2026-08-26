import type { MouseEvent, ReactNode } from "react";
import { navigate, type AppRoute } from "../lib/routes";

export function RouteLink({
  to,
  className,
  children,
  dataTour,
}: {
  to: AppRoute;
  className?: string;
  children: ReactNode;
  dataTour?: string;
}) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={to} className={className} onClick={follow} data-tour={dataTour}>
      {children}
    </a>
  );
}
