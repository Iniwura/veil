import { CryptographicChamber, type CryptographicChamberState } from "./CryptographicChamber";

export type EncryptedDrawFieldState = CryptographicChamberState;

export function EncryptedDrawField({
  roundId,
  participantCount,
  state,
  compact = false,
}: {
  roundId?: bigint;
  participantCount?: number;
  state: EncryptedDrawFieldState;
  compact?: boolean;
}) {
  return <CryptographicChamber roundId={roundId} participantCount={participantCount} state={state} compact={compact} />;
}
