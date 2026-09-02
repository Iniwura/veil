export type PrivateBalanceHandles = {
  walletPrincipal: string;
  poolPrincipal: string;
  reservedWithdrawal: string;
  prizeBalance: string;
};

export type PrivateBalanceValues = {
  availablePrincipal: bigint;
  activePrincipal: bigint;
  reservedPrincipal: bigint;
  strategySharePrizeBalance: bigint;
};

/** Map one batched user-decrypt response back to the four private dashboard values. */
export function mapPrivateBalanceValues(
  handles: PrivateBalanceHandles,
  values: ReadonlyMap<string, bigint>,
): PrivateBalanceValues {
  return {
    availablePrincipal: values.get(handles.walletPrincipal) ?? 0n,
    activePrincipal: values.get(handles.poolPrincipal) ?? 0n,
    reservedPrincipal: values.get(handles.reservedWithdrawal) ?? 0n,
    strategySharePrizeBalance: values.get(handles.prizeBalance) ?? 0n,
  };
}
