export function SeamLoader({ active = true }: { active?: boolean }) {
  if (!active) return null;
  return <span className="seam-loader" role="status" aria-label="Loading public protocol state" />;
}
