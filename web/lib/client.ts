import {createPublicClient, http} from "viem";
import {robinhoodTestnet} from "./chain";

export const publicClient = createPublicClient({
  chain: robinhoodTestnet,
  transport: http(),
});
