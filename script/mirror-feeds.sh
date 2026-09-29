#!/usr/bin/env bash
# Keep the testnet price feeds tracking the real Robinhood Chain Chainlink feeds.
#
# Testnet has no Chainlink equity feeds, so Aarka's testnet deployment reads TestAggregator
# stand-ins. Left alone they go stale: series creation refuses a price older than four days, the
# site shows no spot, and nothing can settle. This copies each mainnet round across with its
# original price AND its original timestamp, so the testnet feed behaves the way the real one
# does — updating through the week, going quiet at the weekend — and a series settles against the
# real closing price, not one somebody typed in.
#
# A round is only pushed when mainnet has published something newer than the testnet feed's latest,
# so running this often costs nothing extra.
#
#   PRIVATE_KEY=... ./script/mirror-feeds.sh            # once
#   PRIVATE_KEY=... LOOP=1800 ./script/mirror-feeds.sh  # every 30 minutes
set -euo pipefail

MAINNET_RPC="${MAINNET_RPC:-https://rpc.mainnet.chain.robinhood.com}"
TESTNET_RPC="${TESTNET_RPC:-https://rpc.testnet.chain.robinhood.com}"
: "${PRIVATE_KEY:?export PRIVATE_KEY first}"

# ticker  mainnet Chainlink feed                        testnet stand-in
FEEDS=(
  "NVDA 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 0x6a985039287dC8BB054C36804eb75337f69f944F"
  "TSLA 0x4A1166a659A55625345e9515b32adECea5547C38 0x883dA473862A33e32BCdfb5Cf0aA22b0571781Ab"
)

ROUND_SIG='latestRoundData()(uint80,int256,uint256,uint256,uint80)'
ROUND_DATA_SIG='getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)'
# How many missed rounds one run will copy across. A day of 0.5% moves on a volatile stock is well
# under this.
MAX_BACKFILL="${MAX_BACKFILL:-60}"

# Aarka's stopgap sequencer uptime feed. Chainlink publishes none for Robinhood Chain, so this
# keeper is what keeps the guard alive. Reporting nothing reads as down, not as up, so a keeper
# that dies fails closed.
#
# Two of them. The first carries the three 06 NOV 26 series, which store it for life. The second
# has the AUDIT-26 fix and is what the factory hands every series created since 29 Sep 2026. A
# series keeps whichever it was born with, so both are reported until the last series on the first
# has settled.
SEQUENCER_FEEDS="${SEQUENCER_FEEDS:-0x723e4FD23E26eFb48FEeFb2e45CE53627BCf2303 0x4535B4dE5727bFADC6bD5E42242Ae2D25602341A}"
# A sequencer that has not produced a block in this long is not sequencing.
MAX_BLOCK_LAG="${MAX_BLOCK_LAG:-600}"

report_sequencer() {
  # The chain's own clock is the evidence: if the latest block is recent, it is being sequenced.
  # If the RPC cannot be reached at all, nothing is reported and the feed goes stale on its own.
  block_time=$(cast block latest --field timestamp --rpc-url "$TESTNET_RPC") || return 0
  lag=$(( $(date -u +%s) - block_time ))
  if [ "$lag" -le "$MAX_BLOCK_LAG" ]; then up=true; else up=false; fi

  for feed in $SEQUENCER_FEEDS; do
    cast send "$feed" "report(bool)" "$up" \
      --rpc-url "$TESTNET_RPC" --private-key "$PRIVATE_KEY" >/dev/null
  done
  echo "$(date -u +%FT%TZ) sequencer up=$up (last block ${lag}s ago)"
}

mirror_once() {
  for row in "${FEEDS[@]}"; do
    read -r ticker mainnet testnet <<<"$row"

    # Fields come back one per line: roundId, answer, startedAt, updatedAt, answeredInRound.
    main=$(cast call "$mainnet" "$ROUND_SIG" --rpc-url "$MAINNET_RPC" | awk '{print $1}')
    id=$(sed -n 1p <<<"$main")
    main_at=$(sed -n 4p <<<"$main")
    test_at=$(cast call "$testnet" "$ROUND_SIG" --rpc-url "$TESTNET_RPC" | awk '{print $1}' | sed -n 4p)

    if [ "$main_at" -le "$test_at" ]; then
      echo "$(date -u +%FT%TZ) $ticker up to date ($main_at)"
      continue
    fi

    # Every round mainnet published since the last one mirrored, not only the newest. The keeper
    # runs every few hours in practice, and a stock that trades overnight publishes after the close,
    # so copying only the latest round would drop the last price before an expiry and settle the
    # testnet series on an older one. Walk back until the testnet's latest, then push oldest first.
    # A phase boundary makes the previous id revert; the walk stops there.
    rounds=()
    while [ "${#rounds[@]}" -lt "$MAX_BACKFILL" ]; do
      r=$(cast call "$mainnet" "$ROUND_DATA_SIG" "$id" --rpc-url "$MAINNET_RPC" 2>/dev/null | awk '{print $1}') || break
      at=$(sed -n 4p <<<"$r")
      [ -n "$at" ] && [ "$at" -gt "$test_at" ] || break
      rounds=("$(sed -n 2p <<<"$r") $at" ${rounds[@]+"${rounds[@]}"})
      # Round ids are (phase << 64) | round, past what bash arithmetic holds, so step in python.
      id=$(python3 -c "print($id - 1 if $id & 0xFFFFFFFFFFFFFFFF > 1 else '')")
      [ -n "$id" ] || break
    done

    for pair in ${rounds[@]+"${rounds[@]}"}; do
      read -r answer at <<<"$pair"
      price=$(python3 -c "print(f'{$answer/1e8:.2f}')")
      tx=$(cast send "$testnet" "pushRoundAt(int256,uint256)" "$answer" "$at" \
        --rpc-url "$TESTNET_RPC" --private-key "$PRIVATE_KEY" --json \
        | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
      echo "$(date -u +%FT%TZ) $ticker \$$price at $at  $tx"
    done
  done
}

run_once() {
  mirror_once
  report_sequencer
}

if [ -n "${LOOP:-}" ]; then
  while true; do
    run_once || echo "$(date -u +%FT%TZ) run failed, retrying next interval"
    sleep "$LOOP"
  done
else
  run_once
fi
