import { expect } from "chai";
import { readWithSepoliaFallback } from "../shared/sepoliaRpc";

const SEPOLIA = 11_155_111;

describe("Sepolia read RPC fallback", function () {
  it("tries the primary first, then falls back without fan-out", async function () {
    const calls: string[] = [];
    const endpoints = [
      {
        checkChainId: async () => {
          calls.push("primary:chain");
          return SEPOLIA;
        },
        read: async () => {
          calls.push("primary:read");
          throw new Error("primary unavailable");
        },
      },
      {
        checkChainId: async () => {
          calls.push("fallback:chain");
          return SEPOLIA;
        },
        read: async () => {
          calls.push("fallback:read");
          return "healthy";
        },
      },
    ];

    const result = await readWithSepoliaFallback(endpoints);

    expect(result).to.deep.equal({ value: "healthy", index: 1 });
    expect(calls).to.deep.equal(["primary:chain", "primary:read", "fallback:chain", "fallback:read"]);
  });

  it("rejects a wrong-chain endpoint before issuing its read", async function () {
    let wrongChainReads = 0;
    const endpoints = [
      {
        checkChainId: async () => 1,
        read: async () => {
          wrongChainReads += 1;
          return "mainnet";
        },
      },
    ];

    await expect(readWithSepoliaFallback(endpoints)).to.be.rejectedWith("returned chain 1");
    expect(wrongChainReads).to.equal(0);
  });
});
