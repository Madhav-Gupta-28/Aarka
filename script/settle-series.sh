#!/usr/bin/env bash
# Settle a live series on Robinhood Chain testnet.
#
# settle() only accepts a round published at or before expiry, no more than six hours before it,
# with no later round that is also at or before expiry. On mainnet the Chainlink feed already has
# that round. The testnet stand-in only publishes when we push to it, so:
#
#   - if a qualifying round already exists, settle against it
#   - otherwise publish one dated PRICE_AGE seconds before expiry (default 30 minutes) and use that
#
# A round is never dated in the future (see AUDIT-15), and a round dated after expiry is useless,
# which is why the old version of this script, publishing at the current time, could never settle
# anything once the series had actually expired.
#
#   ./script/settle-series.sh <SERIES_ADDRESS> <PRICE_8DP>
#   ./script/settle-series.sh 0x0E67...F68c 26000000000     # $260.00
set -euo pipefail

SERIES="${1:?series address required}"
PRICE="${2:?price in 8 decimals required}"
PRICE_AGE="${PRICE_AGE:-1800}"
RPC="${RPC:-https://rpc.testnet.chain.robinhood.com}"
: "${PRIVATE_KEY:?export PRIVATE_KEY first}"

FEED=$(cast call "$SERIES" "feed()(address)" --rpc-url "$RPC")
EXPIRY=$(cast call "$SERIES" "expiry()(uint64)" --rpc-url "$RPC" | awk '{print $1}')
NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
echo "series  $SERIES"
echo "feed    $FEED"
echo "expiry  $EXPIRY   now $NOW"

if [ "$NOW" -lt "$EXPIRY" ]; then
  echo "not expired yet — $(( (EXPIRY - NOW) / 3600 ))h to go"; exit 1
fi
if [ "$(cast call "$SERIES" "settled()(bool)" --rpc-url "$RPC")" = "true" ]; then
  echo "already settled"; exit 0
fi

round_at() { cast call "$FEED" "getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)" "$1" \
  --rpc-url "$RPC" 2>/dev/null | sed -n 4p | awk '{print $1}'; }

# Look for a round the contract will accept, newest first.
LATEST=$(cast call "$FEED" "latestRound()(uint80)" --rpc-url "$RPC" | awk '{print $1}')
ROUND=""
ID=$LATEST
for _ in $(seq 1 64); do
  AT=$(round_at "$ID" || true)
  if [ -n "$AT" ] && [ "$AT" -le "$EXPIRY" ] && [ $(( EXPIRY - AT )) -le 21600 ]; then
    NEXT=$(round_at "$(python3 -c "print($ID + 1)")" || true)
    if [ -z "$NEXT" ] || [ "$NEXT" -gt "$EXPIRY" ]; then ROUND=$ID; break; fi
  fi
  ID=$(python3 -c "print($ID - 1)")
done

if [ -z "$ROUND" ]; then
  AT=$(( EXPIRY - PRICE_AGE ))
  echo "no qualifying round — publishing \$$(echo "scale=2; $PRICE/100000000" | bc) dated $AT"
  cast send "$FEED" "pushRoundAt(int256,uint256)" "$PRICE" "$AT" \
    --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
  ROUND=$(cast call "$FEED" "latestRound()(uint80)" --rpc-url "$RPC" | awk '{print $1}')
fi
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
