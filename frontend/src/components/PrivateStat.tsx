export function PrivateStat({
  label,
  value,
  revealed,
  detail,
}: {
  label: string;
  value?: bigint | string;
  revealed: boolean;
  detail?: string;
}) {
  return (
    <div className={`private-stat ${revealed ? "private-stat--revealed" : ""}`}>
      <span>{label}</span>
      <strong>{revealed ? (value?.toString() ?? "0") : "••••••"}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
