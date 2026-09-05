import type { CSSProperties } from "react";

export function RouteTransition({ visible }: { visible: boolean }) {
  return (
    <div className={`route-transition${visible ? " is-visible" : ""}`} aria-hidden="true">
      <span className="route-transition-spinner">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} style={{ "--spinner-index": index } as CSSProperties} />
        ))}
      </span>
    </div>
  );
}
