import { expect } from "chai";

import { isTransientZamaDecryptError, withZamaDecryptRetry } from "../scripts/sepolia-v4-decrypt-retry";

describe("V4 Sepolia user-decrypt retry handling", function () {
  it("retries a transient Gao failure with the same operation and then succeeds", async function () {
    const handle = "0x8d12feb013704dad1b9b91c6f4c48a8a2089ff0000000000aa36a70500";
    const calls: string[] = [];
    const logs: string[] = [];
    let attempts = 0;

    const result = await withZamaDecryptRetry(
      async () => {
        attempts += 1;
        calls.push(handle);
        if (attempts < 3) throw new Error("Gao decoding failure");
        return 100n;
      },
      { delayMs: 0, log: (message) => logs.push(message) },
    );

    expect(result).to.equal(100n);
    expect(attempts).to.equal(3);
    expect(calls).to.deep.equal([handle, handle, handle]);
    expect(logs).to.deep.equal([
      "transient Zama decrypt failure; retry 2/5",
      "transient Zama decrypt failure; retry 3/5",
    ]);
    expect(isTransientZamaDecryptError(new Error("Error reconstructing all blocks"))).to.equal(true);
  });

  it("stops after five total attempts when the transient failure persists", async function () {
    let attempts = 0;
    const logs: string[] = [];

    await expect(
      withZamaDecryptRetry(
        async () => {
          attempts += 1;
          throw new Error("Error reconstructing all blocks");
        },
        { delayMs: 0, log: (message) => logs.push(message) },
      ),
    ).to.be.rejectedWith("Error reconstructing all blocks");

    expect(attempts).to.equal(5);
    expect(logs).to.have.length(4);
  });

  it("fails immediately for non-transient errors", async function () {
    let attempts = 0;
    const error = new Error("Not in round");

    await expect(
      withZamaDecryptRetry(
        async () => {
          attempts += 1;
          throw error;
        },
        { delayMs: 0 },
      ),
    ).to.be.rejectedWith("Not in round");

    expect(attempts).to.equal(1);
    expect(isTransientZamaDecryptError(error)).to.equal(false);
  });
});
