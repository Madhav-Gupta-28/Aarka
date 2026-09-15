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

mirror_once() {
  for row in "${FEEDS[@]}"; do
    read -r ticker mainnet testnet <<<"$row"

    # Fields come back one per line: roundId, answer, startedAt, updatedAt, answeredInRound.
    main=$(cast call "$mainnet" "$ROUND_SIG" --rpc-url "$MAINNET_RPC" | awk '{print $1}')
    answer=$(sed -n 2p <<<"$main")
    main_at=$(sed -n 4p <<<"$main")
    test_at=$(cast call "$testnet" "$ROUND_SIG" --rpc-url "$TESTNET_RPC" | awk '{print $1}' | sed -n 4p)

    if [ "$main_at" -le "$test_at" ]; then
      echo "$(date -u +%FT%TZ) $ticker up to date ($main_at)"
      continue
    fi

    price=$(python3 -c "print(f'{$answer/1e8:.2f}')")
    tx=$(cast send "$testnet" "pushRoundAt(int256,uint256)" "$answer" "$main_at" \
      --rpc-url "$TESTNET_RPC" --private-key "$PRIVATE_KEY" --json \
      | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
    echo "$(date -u +%FT%TZ) $ticker \$$price at $main_at  $tx"
  done
}

if [ -n "${LOOP:-}" ]; then
  while true; do
    mirror_once || echo "$(date -u +%FT%TZ) run failed, retrying next interval"
    sleep "$LOOP"
  done
else
  mirror_once
fi
