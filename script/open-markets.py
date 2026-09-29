#!/usr/bin/env python3
"""Open a market on each series: a parity hook plus a Uniswap v4 pool for each half.

A hook is bound to one series at construction, so a market per series means a hook per series.
This runs DeployHook.runLive once per series. Each half pool opens at a Black-Scholes split of the
stock pool's price (40% vol, 4% rate) so the two halves sum exactly to the stock and the first trade
starts at parity. The model is a starting point, not a price the protocol has an opinion on.

    python3 script/open-markets.py <NVDA_POOL_PRICE> <TSLA_POOL_PRICE> <SERIES>...
    python3 script/open-markets.py --keep <SERIES>=<OLD_HOOK>...

`--keep` replaces an existing market without moving its prices: each half pool opens where the old
hook's pools trade now, against the stock pool's current price, so a redeploy changes the hook
under a market and nothing a user sees. The old pools and hooks stay on chain untouched.

Pass the price the stock's own NVDA/USDG or TSLA/USDG pool trades at, not the feed price, so the
shared stock pool is not moved for markets that already exist. A stock with no pool yet is opened
at the price given. Reads PRIVATE_KEY from .env. Prints each hook and its opening parity.
"""
import json, math, os, re, subprocess, sys, time

RPC = os.environ.get("RPC", "https://rpc.testnet.chain.robinhood.com")
USDG = "0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097"
SWAP_ROUTER = "0x83b5D54866A826426f4E413b668B587c052Ab824"
HOOK_LENS = "0x414326E556667b5AE9931F67cDb267D1BAF7D1D0"
PARITY = "parity(address)((address,address,address,uint256,uint256,uint256,uint256,uint256,bool,uint128,uint128,uint128,uint256,uint256,bool))"

def load_env():
    env = dict(os.environ)
    for line in open(".env"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env.setdefault(k, v)
    return env

def run(args, env):
    r = subprocess.run(args, capture_output=True, text=True, env=env)
    return r.stdout + r.stderr

def call(env, to, sig, *args):
    return run(["cast", "call", to, sig, *args, "--rpc-url", RPC], env).strip()

def black_scholes_call(spot, strike, years, vol=0.40, rate=0.04):
    n = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    d1 = (math.log(spot / strike) + (rate + vol * vol / 2) * years) / (vol * math.sqrt(years))
    return spot * n(d1) - strike * math.exp(-rate * years) * n(d1 - vol * math.sqrt(years))

def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    env = load_env()
    keep = sys.argv[1] == "--keep"
    if keep:
        targets = [a.split("=") for a in sys.argv[2:]]
    else:
        pool_price = {"NVDA": float(sys.argv[1]), "TSLA": float(sys.argv[2])}
        targets = [(a, None) for a in sys.argv[3:]]
    opened = []
    for series, old_hook in targets:
        stock = call(env, series, "underlying()(address)")
        symbol = call(env, stock, "symbol()(string)").strip('"')
        strike = int(call(env, series, "strike()(uint256)").split()[0]) / 1e8
        expiry = int(call(env, series, "expiry()(uint64)").split()[0])

        if old_hook:
            # The old market's live prices: the stock pool, and the upside where it trades. The floor
            # takes the rest, so the three open exactly at parity with the stock pool unmoved.
            was = [int(x) for x in re.findall(r"(?<![0-9a-fA-Fx])(\d+)(?: \[[^\]]*\])?",
                   call(env, HOOK_LENS, PARITY, old_hook).replace("\n", "").split(",", 3)[3])]
            p_stock, p_upside = was[0], max(1, was[2])
            p_floor = p_stock - p_upside
        else:
            spot = pool_price[symbol]
            years = (expiry - time.time()) / (365 * 24 * 3600)
            p_stock = round(spot * 1e6)
            p_upside = max(1, round(black_scholes_call(spot, strike, years) * 1e6))
            p_floor = p_stock - p_upside

        out = run(["forge", "script", "script/DeployHook.s.sol", "--rpc-url", RPC,
                   "--broadcast", "--private-key", env["PRIVATE_KEY"], "--gas-limit", "900000000",
                   # Exact estimates run out on an Orbit chain, whose L1 data fee moves between
                   # simulation and inclusion; the 22 Sep run lost three approvals to it.
                   "--gas-estimate-multiplier", "200",
                   "--sig", "runLive(address,address,address,address,uint256,uint256,uint256)",
                   series, stock, USDG, SWAP_ROUTER, str(p_stock), str(p_floor), str(p_upside)], env)
        found = re.search(r"AarkaParityHook\s+(0x[0-9a-fA-F]{40})", out)
        if not found or "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" not in out:
            print(out[-3000:])
            sys.exit(f"failed on {series}")
        hook = found.group(1)

        reading = call(env, HOOK_LENS, PARITY, hook).replace("\n", "")
        nums = [int(x) for x in re.findall(r"(?<![0-9a-fA-Fx])(\d+)(?: \[[^\]]*\])?", reading.split(",", 3)[3])]
        print(f"{symbol} ${strike:.0f} {expiry}  hook {hook}  "
              f"stock {nums[0]/1e6:.2f} = floor {nums[1]/1e6:.2f} + upside {nums[2]/1e6:.2f}  gap {nums[4]} bps", flush=True)
        opened.append({"series": series, "hook": hook, "replaced": old_hook, "ticker": symbol, "strike": strike, "expiry": expiry})

    print(json.dumps(opened, indent=1))

if __name__ == "__main__":
    main()
