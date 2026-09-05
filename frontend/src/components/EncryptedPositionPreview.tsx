import { EncryptedMatterArtwork } from "./EncryptedMatterArtwork";
import { SeamLoader } from "./SeamLoader";

type EncryptedPositionPreviewProps = {
  roundId?: bigint;
  state?: string;
  publicState: "LIVE" | "STALE" | "UNAVAILABLE" | "LOADING";
};

export function EncryptedPositionPreview({ roundId, state, publicState }: EncryptedPositionPreviewProps) {
  const publicRound = roundId === undefined ? "CURRENT" : `ROUND ${roundId.toString().padStart(2, "0")}`;
  return (
    <section
      className="position-preview"
      data-cursor="sealed"
      aria-label="Conceptual product preview showing a masked private position and separate public draw proof"
    >
      <EncryptedMatterArtwork idPrefix="hero-matter" />
      <div className="position-preview-private">
        <header className="position-preview-header">
          <div>
            <span className="eyebrow">PRIVATE POSITION</span>
          </div>
          <span className="position-preview-state">SEALED</span>
        </header>
        <div className="position-preview-balance">
          <span>ENCRYPTED PRINCIPAL</span>
          <strong aria-label="Masked private principal">••••••</strong>
        </div>
      </div>
      <div className="position-preview-seam" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="position-preview-public">
        <header className="position-preview-header">
          <div>
            <span className="eyebrow">PUBLIC PROOF</span>
            <strong>Onchain proof</strong>
          </div>
          <span className={`position-preview-state position-preview-state--${publicState.toLowerCase()}`}>
            {publicState}
          </span>
          <SeamLoader active={publicState === "LOADING"} />
        </header>
        <div className="position-preview-proof-rail">
          <div>
            <span>ROUND</span>
            <strong>{publicRound}</strong>
          </div>
          <div>
            <span>STATE</span>
            <strong>{state ?? publicState}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
