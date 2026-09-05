import { JsonRpcProvider } from "ethers";
import { readWithSepoliaFallback, SEPOLIA_CHAIN_ID, SEPOLIA_READ_RPC_URLS } from "../../../shared/sepoliaRpc";

/** Sequential, chain-checked JsonRpcProvider used for public reads only. */
class SepoliaReadProvider extends JsonRpcProvider {
  private readonly endpointProviders: JsonRpcProvider[];
  private readonly chainChecks: Array<Promise<void> | undefined>;
  private activeIndex = 0;

  constructor(urls: readonly string[] = SEPOLIA_READ_RPC_URLS) {
    if (!urls.length) throw new Error("No Sepolia read endpoints configured.");
    super(urls[0], SEPOLIA_CHAIN_ID, { staticNetwork: true });
    this.endpointProviders = urls.map((url) => new JsonRpcProvider(url, SEPOLIA_CHAIN_ID, { staticNetwork: true }));
    this.chainChecks = Array.from({ length: urls.length });
  }

  private checkEndpoint(index: number) {
    const cached = this.chainChecks[index];
    if (cached) return cached;
    const check = this.endpointProviders[index]
      .send("eth_chainId", [])
      .then((raw) => {
        const chainId = BigInt(raw);
        if (chainId !== BigInt(SEPOLIA_CHAIN_ID)) {
          throw new Error(`Sepolia read endpoint returned chain ${chainId.toString()}.`);
        }
      })
      .catch((error) => {
        // A transient outage should be retried on a later read; a wrong-chain
        // response is also rechecked so an endpoint can recover safely.
        this.chainChecks[index] = undefined;
        throw error;
      });
    this.chainChecks[index] = check;
    return check;
  }

  override async send(method: string, params: Array<unknown>): Promise<unknown> {
    const result = await readWithSepoliaFallback(
      this.endpointProviders.map((provider, index) => ({
        checkChainId: () => this.checkEndpoint(index).then(() => SEPOLIA_CHAIN_ID),
        read: () => provider.send(method, params),
      })),
      this.activeIndex,
    );
    this.activeIndex = result.index;
    return result.value;
  }
}

export { SEPOLIA_READ_RPC_URLS };
export const sepoliaReadProvider = new SepoliaReadProvider();
