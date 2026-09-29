#!/usr/bin/env python3
"""Verify the live Robinhood Chain testnet deployment on its Blockscout explorer.

The project builds with two compilers, and a source only verifies against the one that built it.
The tests import Uniswap's PoolManager, which pins solc 0.8.26, so a plain `forge build` leaves
0.8.26 artifacts in out/. The deploy scripts import only v4's interfaces and test routers, which do
not pin a version, so every deployed contract — hooks and router included — was built with 0.8.33.
Verifying against out/ fails with nothing more useful than "Unable to verify".

So this compares each address's runtime code against a build from each compiler, ignoring immutable
slots, and submits with whichever matches. An address neither matches is reported and skipped
rather than submitted with a guess.

    forge build src --use 0.8.33 --out /tmp/out833 --cache-path /tmp/cache833
    forge build src --use 0.8.26 --out /tmp/out826 --cache-path /tmp/cache826
    python3 script/verify-testnet.py

Series and their two tokens are discovered from the factory, and hooks from the web app's market
list, so a new series or market needs no edit here.

Blockscout shows source for an address whose bytecode matches one already verified — a "twin" —
without marking that address verified, and forge's own check then reports it as done and skips it.
Twelve series and twenty-four tokens share bytecode, so almost all of them would silently stay
unverified. This skips forge's check and trusts only the explorer's `is_verified` flag.
"""
import json, os, re, subprocess, sys, time

RPC = "https://rpc.testnet.chain.robinhood.com"
EXPLORER = "https://explorer.testnet.chain.robinhood.com"
BUILDS = {"0.8.26": "/tmp/out826", "0.8.33": "/tmp/out833"}

POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951"
FACTORY = "0x69caa2b3d4f732861A36e78b5A3992d18faA9BcA"
CALENDAR = "0x111040a3CfA607EF19693A023b157e9f806C622b"
USDG = "0xcF787ba06F58Af9c2B078Ec85B1a4E9AfA5f1097"
ZERO = "0x0000000000000000000000000000000000000000"

def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout.strip()

def call(to, sig, *args):
    return sh("cast", "call", to, sig, *args, "--rpc-url", RPC)

def first(value):
    return value.split()[0] if value else value

def verified(address):
    out = sh("curl", "-s", f"{EXPLORER}/api/v2/smart-contracts/{address}")
    try:
        return bool(json.loads(out).get("is_verified"))
    except ValueError:
        return False

def compiler_for(address, name):
    onchain = sh("cast", "code", address, "--rpc-url", RPC)[2:]
    for version, out in BUILDS.items():
        path = f"{out}/{name}.sol/{name}.json"
        if not os.path.exists(path):
            continue
        art = json.load(open(path))["deployedBytecode"]
        local = art["object"][2:]
        if len(local) != len(onchain):
            continue
        masked = set()
        for refs in art.get("immutableReferences", {}).values():
            for r in refs:
                masked.update(range(r["start"], r["start"] + r["length"]))
        if all(onchain[2 * i:2 * i + 2] == local[2 * i:2 * i + 2] or i in masked for i in range(len(local) // 2)):
            return version
    return None

def targets(deployer):
    t = [
        (FACTORY, "src/AarkaFactory.sol:AarkaFactory", "constructor(address,address,address)", [deployer, CALENDAR, ZERO]),
        ("0xaE4f737b0f259b1C8A15a73367670090c94bB2d7", "src/AarkaLens.sol:AarkaLens", "constructor(address)", [FACTORY]),
        ("0xb47D3Bf8012fF8dfC56ABfc7142d55735E3508a0", "src/periphery/AarkaRouter.sol:AarkaRouter", "constructor(address,address)", [POOL_MANAGER, FACTORY]),
        ("0x4535B4dE5727bFADC6bD5E42242Ae2D25602341A", "src/adapters/AarkaSequencerFeed.sol:AarkaSequencerFeed", "constructor(address,address)", [deployer, "0xc0fF5A4B8fc5636C3dccaF52d613dc585d5125D5"]),
        ("0x414326E556667b5AE9931F67cDb267D1BAF7D1D0", "src/HookLens.sol:HookLens", "constructor(address)", [POOL_MANAGER]),
        (CALENDAR, "src/ExpiryCalendar.sol:ExpiryCalendar", "constructor(address)", [deployer]),
        ("0x44b27AB4eFD46719C2ddAFD616e88faFD22D8bC1", "src/testnet/TestStockToken.sol:TestStockToken", "constructor(string,string,address)", ["NVIDIA - Aarka Testnet", "NVDA", deployer]),
        ("0x06002571803D40bD20C13Bd835BE30a642623dEA", "src/testnet/TestStockToken.sol:TestStockToken", "constructor(string,string,address)", ["Tesla - Aarka Testnet", "TSLA", deployer]),
        ("0x6a985039287dC8BB054C36804eb75337f69f944F", "src/testnet/TestAggregator.sol:TestAggregator", "constructor(string,int256,address)", ["RHNVDA / USD", "21500000000", deployer]),
        ("0x883dA473862A33e32BCdfb5Cf0aA22b0571781Ab", "src/testnet/TestAggregator.sol:TestAggregator", "constructor(string,int256,address)", ["RHTSLA / USD", "35678030000", deployer]),
        (USDG, "src/testnet/TestUSDG.sol:TestUSDG", None, []),
    ]
    count = int(first(call(FACTORY, "seriesCount()(uint256)")))
    for i in range(count):
        s = call(FACTORY, "allSeries(uint256)(address)", str(i))
        args = [call(s, "underlying()(address)"), call(s, "feed()(address)"), call(s, "sequencerUptime()(address)"),
                first(call(s, "strike()(uint256)")), first(call(s, "expiry()(uint64)"))]
        t.append((s, "src/AarkaSeries.sol:AarkaSeries", "constructor(address,address,address,uint256,uint64)", args))
        for getter in ("floorToken()(address)", "upsideToken()(address)"):
            token = call(s, getter)
            t.append((token, "src/AarkaToken.sol:AarkaToken", "constructor(string,string)",
                      [call(token, "name()(string)").strip('"'), call(token, "symbol()(string)").strip('"')]))
    markets = open("web/lib/contracts.ts").read()
    for series, hook in re.findall(r'"(0x[0-9a-f]{40})": "(0x[0-9a-fA-F]{40})"', markets):
        t.append((hook, "src/hook/AarkaParityHook.sol:AarkaParityHook", "constructor(address,address,address,address)",
                  [POOL_MANAGER, series, USDG, deployer]))
    return t

def main():
    env = {}
    for line in open(".env"):
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.strip().split("=", 1)
            env[k] = v
    deployer = env["DEPLOYER_ADDRESS"]

    done = skipped = failed = 0
    for address, contract, sig, args in targets(deployer):
        label = f"{contract.split(':')[1]:<16} {address}"
        if verified(address):
            print(f"already  {label}", flush=True); done += 1; continue
        version = compiler_for(address, contract.split(":")[1])
        if not version:
            print(f"SKIPPED  {label}  on-chain code matches neither build", flush=True); skipped += 1; continue
        cmd = ["forge", "verify-contract", address, contract, "--chain-id", "46630", "--compiler-version", version,
               "--verifier", "blockscout", "--verifier-url", f"{EXPLORER}/api/", "--watch",
               "--skip-is-verified-check"]
        if sig:
            cmd += ["--constructor-args", sh("cast", "abi-encode", sig, *args)]
        subprocess.run(cmd, capture_output=True, text=True)
        time.sleep(3)
        ok = verified(address)
        print(f"{'verified' if ok else 'FAILED  '} {label}  solc {version}", flush=True)
        done += ok; failed += (not ok)
    print(f"\n{done} verified, {skipped} skipped, {failed} failed")

if __name__ == "__main__":
    main()
