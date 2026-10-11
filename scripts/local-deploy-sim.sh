#!/usr/bin/env bash
# Local deployment rehearsal on anvil (chain 31337). No keys: anvil's unlocked accounts sign.
# It never touches a public network. USDT is the TEST-ONLY MockUSDT deployed by the script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-18546}"
RPC="http://127.0.0.1:${PORT}"
export PATH="$HOME/.foundry/bin:$PATH"

anvil --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done

mapfile -t ACCTS < <(cast rpc eth_accounts --rpc-url "$RPC" | tr -d '[]" ' | tr ',' '\n')
export DEPLOYER="${ACCTS[0]}" SAFE="${ACCTS[1]}" OPERATOR="${ACCTS[2]}" REVIEWER="${ACCTS[3]}"
export PAUSER="${ACCTS[4]}" COMPLIANCE_AGENT="${ACCTS[5]}" FEE_RECIPIENT="${ACCTS[6]}"

cd "$ROOT/contracts"
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --unlocked --sender "$DEPLOYER" --slow -q
RUN="broadcast/Deploy.s.sol/31337/run-latest.json"
addr() { jq -r --arg n "$1" '[.transactions[] | select(.contractName==$n)][0].contractAddress' "$RUN"; }

TIMELOCK=$(addr TimelockController)
ASSETS=$(addr AssetRegistry)
FACTORY=$(addr ProjectFactory)
ROUTER=$(addr SubscriptionRouter)
REFERRAL=$(addr ReferralRewards)
MARKET=$(addr ShareMarket)
ADMIN=0x0000000000000000000000000000000000000000000000000000000000000000

# cast prints big numbers as "86400 [8.64e4]"; compare the first field only.
check() { local got="${2%% *}"; if [ "$got" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (got $2, want $3)"; exit 1; fi; }
check "timelock delay 24h" "$(cast call "$TIMELOCK" 'getMinDelay()(uint256)' --rpc-url "$RPC")" 86400
check "timelock is AssetRegistry admin" "$(cast call "$ASSETS" 'hasRole(bytes32,address)(bool)' $ADMIN "$TIMELOCK" --rpc-url "$RPC")" true
check "deployer is not AssetRegistry admin" "$(cast call "$ASSETS" 'hasRole(bytes32,address)(bool)' $ADMIN "$DEPLOYER" --rpc-url "$RPC")" false
check "timelock is factory admin" "$(cast call "$FACTORY" 'hasRole(bytes32,address)(bool)' $ADMIN "$TIMELOCK" --rpc-url "$RPC")" true
check "timelock is router admin" "$(cast call "$ROUTER" 'hasRole(bytes32,address)(bool)' $ADMIN "$TIMELOCK" --rpc-url "$RPC")" true
check "timelock is referral rewards admin" "$(cast call "$REFERRAL" 'hasRole(bytes32,address)(bool)' $ADMIN "$TIMELOCK" --rpc-url "$RPC")" true
check "referral claims start disabled" "$(cast call "$REFERRAL" 'claimsEnabled()(bool)' --rpc-url "$RPC")" false
check "timelock is share market admin" "$(cast call "$MARKET" 'hasRole(bytes32,address)(bool)' $ADMIN "$TIMELOCK" --rpc-url "$RPC")" true
check "deployer is not share market admin" "$(cast call "$MARKET" 'hasRole(bytes32,address)(bool)' $ADMIN "$DEPLOYER" --rpc-url "$RPC")" false
check "referral binding starts disabled" "$(cast call "$ROUTER" 'referralsEnabled()(bool)' --rpc-url "$RPC")" false

# A direct admin call from the deployer must now fail; only the timelock (via the Safe) can do it.
if cast send "$ASSETS" 'grantRole(bytes32,address)' $ADMIN "$DEPLOYER" --from "$DEPLOYER" --unlocked --rpc-url "$RPC" >/dev/null 2>&1; then
  echo "FAIL deployer could still grant admin"; exit 1
fi
echo "ok   deployer can no longer grant admin"

echo "Local deployment rehearsal passed. Addresses are in contracts/$RUN (local only, never use them elsewhere)."
