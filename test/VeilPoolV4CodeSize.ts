import { expect } from "chai";
import { artifacts } from "hardhat";

const EIP_170_RUNTIME_CODE_LIMIT = 24_576;

describe("VeilPoolV4 code size", function () {
  it("keeps deployed runtime bytecode within the EIP-170 limit", async function () {
    const artifact = await artifacts.readArtifact("VeilPoolV4");
    const deployedBytecode = artifact.deployedBytecode.startsWith("0x")
      ? artifact.deployedBytecode.slice(2)
      : artifact.deployedBytecode;
    const deployedBytecodeSize = deployedBytecode.length / 2;

    expect(deployedBytecodeSize).to.be.at.most(EIP_170_RUNTIME_CODE_LIMIT);
  });
});
