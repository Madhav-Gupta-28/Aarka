"use client";

import {formatUnits, maxUint256, parseUnits} from "viem";
import {useAccount, useConnect, useSwitchChain} from "wagmi";
import {publicClient} from "./client";
import {robinhoodTestnet} from "./chain";
import {ADDRESSES, ROUTER_ABI, SERIES_ABI, TOKEN_ABI, hookedPoolKey, marketFor} from "./contracts";
import type {Balances, Quote} from "./data";
import type {SeriesView} from "./lens";
import {money, n18, n6, parseAmount, plural, qty, stockName, lineLabel} from "./format";
import {useTx} from "./tx";

/**
 * split     one share in, one Floor and one Upside out (mint)
 * rejoin    one of each in, one share out (redeem). Never switched off.
 * buy       cash in, one half out (swap USDG for it)
 * sell      a half you hold in, cash out (swap it for USDG)
 * splitSell one share in: keep one half, sell the other, one transaction (router)
 */
export type Kind = "split" | "rejoin" | "buy" | "sell" | "splitSell";
export type Piece = "floor" | "upside";

/** Quotes move between the quote and the signature; the call reverts past this. */
export const SLIPPAGE_BPS = 50n;
/** The one fee tier every Aarka pool uses, 0.30%. */
const FEE = 0.003;

type Line = {k: string; v: string; hl?: boolean};
type Cta = {label: string; onClick: () => Promise<`0x${string}` | null>; disabled: boolean; spin?: boolean};

export function useAction({s, q, bal, kind, piece, amount}: {
  s?: SeriesView; q?: Quote; bal?: Balances; kind: Kind; piece: Piece; amount: string;
}) {
  const {address, isConnected, chainId} = useAccount();
  const {connect, connectors} = useConnect();
  const {switchChain} = useSwitchChain();
  const tx = useTx();

  const hook = s ? marketFor(s.series) : undefined;
  const name = s ? stockName(s.underlyingSymbol) : "";
  const K = q ? lineLabel(q.strike) : "";
  const n = parseAmount(amount);
  const pl = (w: string) => plural(n, w);
  const pieceName = piece === "floor" ? "Floor" : "Upside";
  const piecePx = q ? (piece === "floor" ? q.floor : q.upside) : 0;
  const cashIn = kind === "buy";
  const decimals = cashIn ? 6 : 18;

  let wei = 0n;
  try { wei = parseUnits(amount && n > 0 ? amount : "0", decimals); } catch { /* not a number yet */ }

  // What the wallet holds of the thing being given, and who has to be allowed to move it.
  const holding = !bal ? 0n
    : kind === "split" || kind === "splitSell" ? bal.share
      : kind === "rejoin" ? (bal.floor < bal.upside ? bal.floor : bal.upside)
        : kind === "buy" ? bal.cash
          : piece === "floor" ? bal.floor : bal.upside;
  const allowance = !bal ? 0n
    : kind === "split" ? bal.shareToSeries
      : kind === "splitSell" ? bal.shareToRouter
        : kind === "buy" ? bal.cashToRouter
          : kind === "sell" ? (piece === "floor" ? bal.floorToRouter : bal.upsideToRouter)
            : maxUint256;
  const permToken = !s ? undefined
    : kind === "split" || kind === "splitSell" ? s.underlying
      : kind === "buy" ? (ADDRESSES.usdg as `0x${string}`)
        : kind === "sell" ? (piece === "floor" ? s.floorToken : s.upsideToken) : undefined;
  const spender = kind === "split" ? s?.series : (ADDRESSES.router as `0x${string}`);

  const needsMarket = kind === "buy" || kind === "sell" || kind === "splitSell";
  const noMarket = needsMarket && (!hook || q?.source !== "market");
  const ended = !!s && s.status !== 0;
  const closed = ended && kind !== "rejoin";
  const needsApproval = kind !== "rejoin" && wei > 0n && allowance < wei;
  const max = cashIn ? n6(holding) : n18(holding);
  const tooMuch = isConnected && !!bal && wei > holding;

  // Dollars first: what goes in, what comes out, estimated from the pool price less the fee.
  const sold = kind === "splitSell" ? (piece === "floor" ? "floor" : "upside") : piece;
  const soldPx = q ? (sold === "floor" ? q.floor : q.upside) : 0;
  const keptName = kind === "splitSell" ? (piece === "floor" ? "Upside" : "Floor") : "";
  const keptPx = q ? (kind === "splitSell" ? (piece === "floor" ? q.upside : q.floor) : 0) : 0;
  const cashOut = kind === "sell" ? n * piecePx * (1 - FEE) : kind === "splitSell" ? n * soldPx * (1 - FEE) : 0;
  const piecesOut = cashIn && piecePx > 0 ? (n / piecePx) * (1 - FEE) : 0;

  const give: Line[] = [];
  const get: Line[] = [];
  let undo = "";
  if (q) {
    if (kind === "split") {
      give.push({k: `${qty(n)} ${name} ${pl("share")}`, v: money(q.spot * n)});
      get.push({k: `${qty(n)} ${pl("Floor")}`, v: money(q.floor * n), hl: true}, {k: `${qty(n)} ${pl("Upside")}`, v: money(q.upside * n), hl: true});
      undo = "Yes. Put them back together anytime to get your share back.";
    } else if (kind === "rejoin") {
      give.push({k: `${qty(n)} ${pl("Floor")}`, v: money(q.floor * n)}, {k: `${qty(n)} ${pl("Upside")}`, v: money(q.upside * n)});
      get.push({k: `${qty(n)} ${name} ${pl("share")}`, v: money(q.spot * n), hl: true});
      undo = "Yes. You can split it again anytime.";
    } else if (kind === "buy") {
      give.push({k: "Cash", v: money(n)});
      get.push({k: `About ${qty(piecesOut, 3)} ${plural(piecesOut, pieceName)}`, v: money(n * (1 - FEE)), hl: true});
      undo = "Not directly. You can sell it later at whatever it is worth then.";
    } else if (kind === "sell") {
      give.push({k: `${qty(n)} ${pl(pieceName)}`, v: money(n * piecePx)});
      get.push({k: "Cash, today", v: money(cashOut), hl: true});
      undo = `Not directly. You could buy ${piece === "floor" ? "a Floor" : "an Upside"} back later at whatever it costs then.`;
    } else {
      give.push({k: `${qty(n)} ${name} ${pl("share")}`, v: money(q.spot * n)});
      get.push({k: "Cash, today", v: money(cashOut), hl: true}, {k: `${qty(n)} ${plural(n, keptName)} kept`, v: money(keptPx * n)});
      undo = `Not directly. You could buy ${piece === "floor" ? "a Floor" : "an Upside"} back later at whatever it costs then.`;
    }
  }

  let err: string | null = null;
  if (tooMuch) {
    const unit = kind === "split" || kind === "splitSell" ? `${name} ${plural(max, "share")}`
      : kind === "rejoin" ? plural(max, "matching pair") : kind === "buy" ? "in cash" : plural(max, pieceName);
    err = kind === "buy" ? `You have ${money(max)} in cash. Try ${money(max)} or less.`
      : `You have ${qty(max)} ${unit}. Try ${qty(max)} or fewer.`;
  }

  const useMax = () => (cashIn ? formatUnits(holding, 6) : formatUnits(holding, 18));

  const toastText = () => {
    if (kind === "split") return {toast: "Split complete", body: `You now hold ${qty(n)} ${pl("Floor")} and ${qty(n)} ${pl("Upside")}.`};
    if (kind === "rejoin") return {toast: "Put back together", body: `You now hold ${qty(n)} more ${name} ${pl("share")}.`};
    if (kind === "buy") return {toast: `Bought ${plural(piecesOut, pieceName)}`, body: `About ${qty(piecesOut, 3)} ${plural(piecesOut, pieceName)}, for ${money(n)}.`};
    return {toast: `You got about ${money(cashOut)} in cash`, body: kind === "splitSell" ? `You kept ${qty(n)} ${plural(n, keptName)}.` : "It's in your wallet."};
  };

  async function approve() {
    if (!permToken || !spender) return null;
    return tx.run({address: permToken, abi: TOKEN_ABI, functionName: "approve", args: [spender, maxUint256]},
                  {toast: "Permission given", body: "Nothing has moved yet. Now confirm the main step."});
  }

  async function submit() {
    if (!s || !address || wei === 0n) return null;
    const done = toastText();
    if (kind === "split") return tx.run({address: s.series, abi: SERIES_ABI, functionName: "mint", args: [wei, address]}, done);
    if (kind === "rejoin") return tx.run({address: s.series, abi: SERIES_ABI, functionName: "redeem", args: [wei, address]}, done);
    if (!hook) return null;

    // The minimum comes from simulating the exact call a moment before it is sent.
    const router = ADDRESSES.router as `0x${string}`;
    try {
      if (kind === "splitSell") {
        const sellUpside = piece === "upside";
        const {key} = hookedPoolKey(sellUpside ? s.upsideToken : s.floorToken, hook);
        const {result} = await publicClient.simulateContract({address: router, abi: ROUTER_ABI, functionName: "splitAndSell", args: [s.series, sellUpside, wei, key, 0n, address], account: address});
        const min = (result as bigint) * (10_000n - SLIPPAGE_BPS) / 10_000n;
        return tx.run({address: router, abi: ROUTER_ABI, functionName: "splitAndSell", args: [s.series, sellUpside, wei, key, min, address]}, done);
      }
      const asset = piece === "floor" ? s.floorToken : s.upsideToken;
      const {key, assetIsZero} = hookedPoolKey(asset, hook);
      const zeroForOne = kind === "buy" ? !assetIsZero : assetIsZero;
      const {result} = await publicClient.simulateContract({address: router, abi: ROUTER_ABI, functionName: "swapExactIn", args: [key, zeroForOne, wei, 0n, address], account: address});
      const min = (result as bigint) * (10_000n - SLIPPAGE_BPS) / 10_000n;
      return tx.run({address: router, abi: ROUTER_ABI, functionName: "swapExactIn", args: [key, zeroForOne, wei, min, address]}, done);
    } catch (e) {
      return tx.fail(e);
    }
  }

  const wrongChain = isConnected && chainId !== robinhoodTestnet.id;

  /** One button that always does the next right thing. */
  const idle = async () => null;
  const cta: Cta = (() => {
    if (!isConnected) return {label: "Connect wallet to continue", onClick: async () => { if (connectors[0]) connect({connector: connectors[0]}); return null; }, disabled: !connectors[0]};
    if (wrongChain) return {label: "Switch network", onClick: async () => { switchChain({chainId: robinhoodTestnet.id}); return null; }, disabled: false};
    if (closed) return {label: "This split has ended", onClick: idle, disabled: true};
    if (noMarket) return {label: "No market for this split yet", onClick: idle, disabled: true};
    if (tx.phase === "wallet") return {label: "Confirm in your wallet…", onClick: idle, disabled: true, spin: true};
    if (tx.phase === "mining") return {label: "Writing it to the network…", onClick: idle, disabled: true, spin: true};
    if (n <= 0 || err) return {label: "Enter an amount", onClick: idle, disabled: true};
    if (needsApproval) return {label: "Step 1: Give permission", onClick: approve, disabled: false};
    const labels: Record<Kind, string> = {
      split: `Split ${qty(n)} ${pl("share")}`,
      rejoin: `Put ${qty(n)} ${pl("pair")} back together`,
      buy: `Buy ${pieceName === "Upside" ? "Upsides" : "Floors"} for ${money(n)}`,
      sell: `Sell ${qty(n)} ${pl(pieceName)} for ${money(cashOut)}`,
      splitSell: `Keep the ${keptName}, get ${money(cashOut)}`,
    };
    return {label: labels[kind], onClick: submit, disabled: false};
  })();

  const steps = kind === "rejoin" ? "1 STEP · CONFIRM IN YOUR WALLET"
    : needsApproval ? "2 STEPS · GIVE PERMISSION, THEN CONFIRM" : "1 STEP · CONFIRM IN YOUR WALLET";

  const minGet = kind === "buy" ? `about ${qty(piecesOut * 0.995, 3)} ${plural(piecesOut, pieceName)}` : money(cashOut * 0.995);

  return {
    n, wei, max, err, give, get, undo, needsApproval, noMarket, ended, closed, cta, steps, minGet, useMax,
    piecesOut, cashOut, piecePx, keptName, name, K, phase: tx.phase, busy: tx.busy, txError: tx.error, hash: tx.hash, reset: tx.reset,
    connected: isConnected && !wrongChain,
  };
}

export const FEE_TEXT = "Network fee: a little testnet ETH";
