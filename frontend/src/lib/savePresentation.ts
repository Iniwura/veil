export {
  deriveSaveActions,
  isRetryableSaveError,
  saveSourceSummary,
  saveSourceUnit,
  type SaveAction,
  type SaveActionKind,
  type SaveSourceKind,
} from "../../../shared/savePresentation";

export type SaveMode = "deposit" | "withdraw";

export type SaveStage =
  | "IDLE"
  | "AUTHORIZATION"
  | "FHE_INIT"
  | "LOCAL_ENCRYPTION"
  | "WALLET_CONFIRMATION"
  | "SEPOLIA_CONFIRMATION"
  | "WITHDRAW_REQUEST"
  | "SEALED"
  | "ERROR";

export const DEPOSIT_STAGES: ReadonlyArray<
  Extract<SaveStage, "AUTHORIZATION" | "FHE_INIT" | "LOCAL_ENCRYPTION" | "WALLET_CONFIRMATION" | "SEPOLIA_CONFIRMATION">
> = ["AUTHORIZATION", "FHE_INIT", "LOCAL_ENCRYPTION", "WALLET_CONFIRMATION", "SEPOLIA_CONFIRMATION"];

const NOTICE_MARKERS: ReadonlyArray<
  [
    Extract<
      SaveStage,
      "AUTHORIZATION" | "FHE_INIT" | "LOCAL_ENCRYPTION" | "WALLET_CONFIRMATION" | "SEPOLIA_CONFIRMATION"
    >,
    string,
  ]
> = [
  ["SEPOLIA_CONFIRMATION", "Deposit submitted. Waiting for Sepolia confirmation…"],
  ["WALLET_CONFIRMATION", "Encrypted request ready. Waiting for wallet confirmation…"],
  ["LOCAL_ENCRYPTION", "Encrypting deposit locally…"],
  ["FHE_INIT", "Initializing FHE…"],
  ["AUTHORIZATION", "Checking confidential principal authorization…"],
];

export function deriveSaveStage({
  busy,
  notice,
  error,
  mode,
}: {
  busy: string;
  notice: string;
  error: string;
  mode: SaveMode;
}): SaveStage {
  if (error) return "ERROR";
  if (mode === "withdraw") return busy === "withdraw" ? "WITHDRAW_REQUEST" : "IDLE";
  if (busy === "deposit") {
    const activeNotice = NOTICE_MARKERS.find(([, marker]) => notice.includes(marker));
    if (activeNotice) return activeNotice[0];
    return "AUTHORIZATION";
  }
  if (notice.startsWith("Encrypted deposit confirmed.")) return "SEALED";
  return "IDLE";
}

export function saveStageIndex(stage: SaveStage): number {
  const index = DEPOSIT_STAGES.indexOf(stage as (typeof DEPOSIT_STAGES)[number]);
  return index === -1 ? -1 : index;
}
