#!/usr/bin/env bash
# Settle a live series on Robinhood Chain testnet.
#
# Publishes a settlement price dated NOW (never in the future — a future-dated round breaks the
# chronological ordering real feeds guarantee, and used to panic series creation, see AUDIT-15),
# then finds the round the contract will accept and settles against it.
#
#   ./script/settle-series.sh <SERIES_ADDRESS> <PRICE_8DP>
#   ./script/settle-series.sh 0x0E67...F68c 26000000000     # $260.00
set -euo pipefail

SERIES="${1:?series address required}"
PRICE="${2:?price in 8 decimals required}"
RPC="${RPC:-https://rpc.testnet.chain.robinhood.com}"
FEED=0x6a985039287dC8BB054C36804eb75337f69f944F
: "${PRIVATE_KEY:?export PRIVATE_KEY first}"

EXPIRY=$(cast call "$SERIES" "expiry()(uint64)" --rpc-url "$RPC" | awk '{print $1}')
NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
echo "series  $SERIES"
echo "expiry  $EXPIRY   now $NOW"

if [ "$NOW" -lt "$EXPIRY" ]; then
  echo "not expired yet — $(( (EXPIRY - NOW) / 3600 ))h to go"; exit 1
fi
if [ "$(cast call "$SERIES" "settled()(bool)" --rpc-url "$RPC")" = "true" ]; then
  echo "already settled"; exit 0
fi

echo "publishing \$$(echo "scale=2; $PRICE/100000000" | bc) at the current block time"
cast send "$FEED" "pushRound(int256)" "$PRICE" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
ROUND=$(cast call "$FEED" "latestRound()(uint80)" --rpc-url "$RPC" | awk '{print $1}')
echo "round   $ROUND"

echo "settling…"
cast send "$SERIES" "settle(uint80)" "$ROUND" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" \
  | grep -E "^(status|transactionHash)"

echo
echo "settled at   $(cast call "$SERIES" "settlementPrice()(uint256)" --rpc-url "$RPC" | awk '{print $1}')"
F=$(cast call "$SERIES" "floorPayoutPerUnit()(uint256)" --rpc-url "$RPC" | awk '{print $1}')
U=$(cast call "$SERIES" "upsidePayoutPerUnit()(uint256)" --rpc-url "$RPC" | awk '{print $1}')
python3 -c "
f=$F; u=$U
print(f'floor        {f/1e18*100:.2f}%')
print(f'upside       {u/1e18*100:.2f}%')
print(f'sum          {f+u} == 1e18 ? {f+u==10**18}')"
