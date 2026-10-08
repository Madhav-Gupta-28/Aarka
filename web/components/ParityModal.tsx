"use client";

import {useEffect, useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useAccount} from "wagmi";
import {decodeEventLog, maxUint256} from "viem";
import {publicClient} from "@/lib/client";
import {ADDRESSES, MARKETS, ROUTER_ABI, TOKEN_ABI, hookedPoolKey, marketFor} from "@/lib/contracts";
import {useBalances, useParityAll} from "@/lib/data";
import type {SeriesView} from "@/lib/lens";
import {ago, money, n18, n6, short} from "@/lib/format";
import {explorerAddr, explorerTx, useTx} from "@/lib/tx";
import {PieceSwitch} from "./ActionPanel";
import {WalletButton} from "./Chrome";
import type {Piece} from "@/lib/actions";

/**
 * The Scales, working: the parity numbers for one split, a way to knock them out of line, and
 * every time the hook has put them back.
 *
 * Brought over from the old /parity page so the new site keeps the one thing that shows the hook
 * acting rather than being described. It sits in a modal so no page layout changes.
 */

/** $50k: big enough to open a gap wider than the hook's threshold on these testnet pools. */
const BUY_CASH = 50_000_000_000n;
/** Up to 250 halves of whichever side is chosen, capped at what the wallet holds. */
const SELL_HALVES = 250_000_000_000_000_000_000n;
/** Blocks land every ~0.2s on Robinhood Chain, so a day is roughly 430,000 of them. */
const BLOCKS_PER_DAY = 430_000n;
const HISTORY_DAYS = 4n;

/**
 * Every hook a market has had before its current one: the 15 Sep hooks replaced on 22 Sep, the
 * 22 Sep hooks replaced on 29 Sep, and the 29 Sep hooks replaced on 8 Oct. They are read for history only: what the mechanism has done is a
 * fact about the protocol, not about whichever deployment is current.
 */
const LEGACY_MARKETS: Record<string, `0x${string}`[]> = {
  "0xdfb1acfaa87eaf10136242c3f273fe4cea606ac7": ["0x533f1ee34100eFF09031D3d5DE802d290dBc0040"],
  "0xbc25a8f80b30622aacfeefa054dc44125c1cd9e7": ["0x39aC5d768D0Dd32c1Fd133391308aC638A89c040"],
  "0x46a335b9611d6e542f7dc6339097c90b7804881a": ["0x6de83EC68484355746F205B9A822785d7e714040"],
  "0x2b51ed3125cf98262b1c9bf075b81371315c29af": ["0xce07DfbeE7254c08E773dd7C04a7A7e444B54040"],
  "0xce14497468dfcfba0dfad442af8561d2f956e4e7": ["0x5e8C54dd0ed38bFb7b610e200FEE4741e6AEc040", "0x7fbd3d2aA2285cee5014bce41584F1A288C94040"],
  "0x81105a4a2d74cb353655469c815f55d392ceabb7": ["0xF964F74F6c9E9E50024ce3b69d695A0ECd6e4040", "0x794bb110Bfb78CEeF57d859FfC29103770478040"],
  "0xcc0dde80ce590e2092f00cf5b82016ffd17163f4": ["0x697e9F586C5cbf2A8b04fc1A3199fe60d16A0040", "0x9b11f7704dAd01428d6D477623696b3821E00040"],
  "0xcb18e35ec23b9595ca8752d5ffea09cffd5e1a87": ["0x1E11c14a6A2EadA61Ca024c1514B2DaFBC7A8040", "0x06a5881b0a358E779b1f9bA81b6d9d64bbea0040"],
  "0x7d31f372d747edb24db9242d5e48cf68aa8dbdcf": ["0xFd7Ac12730eFAE6e0B4e7e5Beb29780989D04040", "0x553f8d548b85b078152A6901fA19bEa19D8a0040", "0x8870eAd4E4147cE352F1B33943543031a7c80640"],
  "0x13b5ea7eeafcfabef731a97f4410e5db941a4819": ["0x198296A48A6695064d0eb3c6ac384DFfE477C040", "0x086AA3fd893EE5CEcea6eBFaFd5b5dDaa5874040", "0x6d316696b4c80f71ec66F43Cd8F801D638158640"],
  "0xa34968cdb62a753aff8b3e172a931e1c76706e3e": ["0x18362F957046037EEe5E640067658cd96B338040", "0x578Ed50250440813887Db1723E8bb8d04F804040", "0xd41CCb4C5E91b89034e75A44712b5c92B9750640"],
  "0x9f755706bf8d5cdce4bae8e96e0d7b4942536f89": ["0x5BD834aad040ca50707Ed5fF69701DE1697f8040", "0x3B14541fc6D434CA29a0f5575F0881d7974F0040", "0xc117478b0b0689E1295E832E72C98cf911e8C640"],
  "0xdf4f52a5158567a357e91ca6e5d39e111dcfbffb": ["0x0a7154C1FdABeCb18f3B7CF216264BDa19e88040", "0x7dd74c60E65138103891cB1E557c31E65b1B0640"],
  "0x3c3166b3aaa1fde7349818e7df6d19fc9079f6c0": ["0x7F75Ec34366D6373480c65b983AdEA9310df0040", "0xBba9E3124A2511e2Cf501Eb51CEDCf28496A4640"],
  "0xb6253f080eca3de2ff6c4c0ad1bcacbad2f3d28b": ["0xF1c210002bFC398dEC493BF5Eeb86B597f4F4040", "0x68D08E3B92497F78D2016b0003266dEd33338640"],
};

const RESTORED = {
  type: "event", name: "ParityRestored", inputs: [
    {name: "minted", type: "bool", indexed: false},
    {name: "size", type: "uint256", indexed: false},
    {name: "profit", type: "uint256", indexed: false},
  ],
} as const;

type Restore = {minted: boolean; size: bigint; profit: bigint; block: bigint; at?: number; hash: `0x${string}`; retired: boolean};

/** Every time this split's hooks, current and retired, closed a gap in the last few days. */
function useRestores(series: string) {
  const key = series.toLowerCase();
  const hooks = [MARKETS[key], ...(LEGACY_MARKETS[key] ?? [])].filter(Boolean) as `0x${string}`[];
  return useQuery({
    queryKey: ["restores", key],
    enabled: hooks.length > 0,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Restore[]> => {
      const latest = await publicClient.getBlockNumber();
      const span = BLOCKS_PER_DAY * HISTORY_DAYS;
      const logs = await publicClient.getLogs({address: hooks, event: RESTORED, fromBlock: latest > span ? latest - span : 0n, toBlock: "latest"});
      const rows = logs.map((log) => {
        const {args} = decodeEventLog({abi: [RESTORED], data: log.data, topics: log.topics});
        return {
          minted: args.minted, size: args.size, profit: args.profit, block: log.blockNumber!, hash: log.transactionHash!,
          retired: log.address.toLowerCase() !== MARKETS[key]?.toLowerCase(),
        };
      }).sort((a, b) => Number(b.block - a.block)).slice(0, 8);
      // Timestamps for the handful shown, so each row can say how long ago.
      await Promise.all(rows.map(async (r: Restore) => {
        try { r.at = Number((await publicClient.getBlock({blockNumber: r.block})).timestamp); } catch { /* shown without a time */ }
      }));
      return rows;
    },
  });
}

export function ParityModal({s, onClose}: {s: SeriesView; onClose: () => void}) {
  const {address, isConnected} = useAccount();
  const {data: parity} = useParityAll([s]);
  const {data: bal} = useBalances(s);
  const restores = useRestores(s.series);
  const tx = useTx();
  const [piece, setPiece] = useState<Piece>("floor");
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = overflow; };
  }, [onClose]);

  const p = parity?.[s.series.toLowerCase()];
  const hook = marketFor(s.series);
  const asset = piece === "floor" ? s.floorToken : s.upsideToken;
  const symbol = piece === "floor" ? s.floorSymbol : s.upsideSymbol;
  const router = ADDRESSES.router as `0x${string}`;

  const cash = bal?.cash ?? 0n;
  const held = piece === "floor" ? bal?.floor ?? 0n : bal?.upside ?? 0n;
  const sellAmount = held < SELL_HALVES ? held : SELL_HALVES;
  const cashAllowed = (bal?.cashToRouter ?? 0n) >= BUY_CASH;
  const halfAllowed = (piece === "floor" ? bal?.floorToRouter ?? 0n : bal?.upsideToRouter ?? 0n) >= sellAmount;
  const atParity = p ? p.gapBps < p.minDeviationBps : true;

  const approve = (token: `0x${string}`, label: string) =>
    tx.run({address: token, abi: TOKEN_ABI, functionName: "approve", args: [router, maxUint256]},
           {toast: "Permission given", body: `The router may now move your ${label}.`});

  // No minimum output on purpose: the point is to move the price far enough to open a gap.
  const swap = (dir: "buy" | "sell") => {
    if (!hook || !address) return;
    const {key, assetIsZero} = hookedPoolKey(asset, hook);
    return tx.run({
      address: router, abi: ROUTER_ABI, functionName: "swapExactIn",
      args: [key, dir === "buy" ? !assetIsZero : assetIsZero, dir === "buy" ? BUY_CASH : sellAmount, 0n, address],
    }, {toast: dir === "buy" ? `Bought ${symbol}` : `Sold your ${symbol}`, body: "Check the difference below: it is what survived the hook."});
  };

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
         style={{position: "fixed", inset: 0, zIndex: 80, background: "rgba(8,9,12,.72)", display: "grid", placeItems: "center", padding: 16, overflowY: "auto"}}>
      <div role="dialog" aria-modal="true" aria-label="The Scales, working" className="card"
           style={{width: "min(620px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", padding: 28, background: "var(--bg)"}}>
        <div className="row" style={{justifyContent: "space-between", alignItems: "flex-start", gap: 16}}>
          <div className="stack gap-4">
            <span className="kicker">The Scales · {s.underlyingSymbol}</span>
            <strong className="h-card display">The two halves have to add up</strong>
          </div>
          <button ref={closeBtn} className="term-btn" onClick={onClose} aria-label="Close">CLOSE</button>
        </div>

        <p className="small" style={{margin: "14px 0 20px"}}>
          Floor plus Upside must equal one share. When the pools drift apart, the hook mints or redeems
          inside the same swap to close the gap. It fronts no capital: every leg settles in one Uniswap lock.
        </p>

        {!hook ? (
          <p className="small">This split has no pools yet.</p>
        ) : !p ? (
          <p className="small muted">Reading the pools…</p>
        ) : (
          <div className="kv">
            <div><span className="k">FLOOR POOL</span><span className="v"><span><span className="n">{money(n6(p.floorPrice))}</span></span></span></div>
            <div><span className="k">UPSIDE POOL</span><span className="v"><span><span className="n">{money(n6(p.upsidePrice))}</span></span></span></div>
            <div><span className="k">TOGETHER</span><span className="v"><span><span className="n">{money(n6(p.sumOfHalves))}</span></span></span></div>
            <div><span className="k">STOCK POOL</span><span className="v"><span><span className="n">{money(n6(p.underlyingPrice))}</span></span></span></div>
            <div><span className="k">GAP</span><span className="v"><span>
              <span className={`n ${atParity ? "up" : "down"}`}>{p.gapBps.toString()} bps</span>
              <span className="muted">{atParity ? "at parity" : p.halvesDear ? "halves dear" : "halves cheap"}</span>
            </span></span></div>
          </div>
        )}

        {hook && (
          <>
            <div className="divider tight" />
            <div className="stack gap-12">
              <span className="kicker">Break it yourself</span>
              <PieceSwitch piece={piece} setPiece={setPiece} verb="Move" />
              {!isConnected ? (
                <div className="row gap-12" style={{alignItems: "center"}}>
                  <span className="small">Connect a wallet to try it.</span>
                  <WalletButton compact />
                </div>
              ) : (
                <div className="row gap-12" style={{flexWrap: "wrap"}}>
                  {cashAllowed ? (
                    <button className="btn btn-sm" disabled={tx.busy || cash < BUY_CASH} onClick={() => swap("buy")}>
                      {cash < BUY_CASH ? "Get test cash on Practice first" : `Buy $50k of ${symbol}`}
                    </button>
                  ) : (
                    <button className="btn btn-sm" disabled={tx.busy} onClick={() => approve(ADDRESSES.usdg as `0x${string}`, "cash")}>Allow cash</button>
                  )}
                  {halfAllowed || sellAmount === 0n ? (
                    <button className="btn btn-sm btn-secondary" disabled={tx.busy || sellAmount === 0n} onClick={() => swap("sell")}>
                      {sellAmount === 0n ? `Split a share to hold ${symbol}` : `Sell your ${symbol}`}
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-secondary" disabled={tx.busy} onClick={() => approve(asset, symbol)}>Allow {symbol}</button>
                  )}
                </div>
              )}
              {tx.busy && <span className="small muted">{tx.phase === "wallet" ? "Confirm in your wallet…" : "Writing it to the network…"}</span>}
              <span className="small muted">
                Buying a half pushes its price up: the pair goes dear and the hook mints. Selling pushes it down:
                the pair goes cheap and the hook redeems.{" "}
                <a href={explorerAddr(hook)} target="_blank" rel="noreferrer">Hook {short(hook)}</a>
              </span>
            </div>
          </>
        )}

        <div className="divider tight" />
        <div className="stack gap-12">
          <span className="kicker">Every time the hook has acted · last {HISTORY_DAYS.toString()} days</span>
          {restores.isLoading ? <span className="small muted">Reading the chain…</span>
            : restores.isError ? <span className="small muted">Couldn&apos;t read the history right now. Try again in a moment.</span>
            : !restores.data?.length ? <span className="small muted">Nothing yet in this window. Break parity above and it appears here.</span>
            : (
              <div className="kv">
                {restores.data.map((r) => (
                  <div key={r.hash + r.size.toString()}>
                    <span className="k">{r.minted ? "MINTED" : "REDEEMED"}</span>
                    <span className="v"><span>
                      <span className="n">{n18(r.size).toFixed(2)} {s.underlyingSymbol} · {money(n6(r.profit))} to LPs</span>
                      <a href={explorerTx(r.hash)} target="_blank" rel="noreferrer" className="muted">
                        {r.at ? ago(r.at) : "tx"}{r.retired ? " · old hook" : ""}
                      </a>
                    </span></span>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
