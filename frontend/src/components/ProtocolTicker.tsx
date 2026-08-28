const CONCEPTS = [
  "FULLY HOMOMORPHIC ENCRYPTION",
  "PRIVATE PRINCIPAL",
  "PUBLIC VERIFICATION",
  "AUTOMATIC CONFIDENTIAL PRIZES",
  "SEPOLIA V2",
] as const;

function TickerContent() {
  return (
    <>
      {CONCEPTS.map((concept) => (
        <span key={concept}>
          {concept}
          <b aria-hidden="true">·</b>
        </span>
      ))}
    </>
  );
}

export function ProtocolTicker() {
  return (
    <section className="protocol-ticker" aria-label="UNVEIL protocol concepts">
      <div className="protocol-ticker-track">
        <TickerContent />
        <span aria-hidden="true">
          <TickerContent />
        </span>
      </div>
    </section>
  );
}
