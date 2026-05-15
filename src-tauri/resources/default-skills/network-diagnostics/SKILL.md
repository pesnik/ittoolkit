---
name: network-diagnostics
description: Diagnose connectivity issues — slow/no internet, can't reach a specific site, DNS problems. Use when the user reports network trouble.
when_to_use: "internet not working", "can't reach", "slow connection", "wifi", "DNS", "connection refused", "site won't load".
allowed-tools:
  - execute_command
arguments:
  - target
argument-hint: "[hostname]  e.g. /network-diagnostics google.com"
---

# Network diagnostics

You are triaging a connectivity issue. Target: **$ARGUMENTS** (defaults to `8.8.8.8` and `google.com` if blank).

## Layer 1 — link & default route

```!
if [ "$(uname)" = "Darwin" ]; then
  ifconfig 2>/dev/null | grep -E "^(en|wlan|eth|wlp|enp)" -A 4 | head -30
  echo "---"
  route -n get default 2>/dev/null | head -10
elif command -v ip >/dev/null 2>&1; then
  ip -brief addr 2>/dev/null
  echo "---"
  ip route show default 2>/dev/null
else
  echo "(no supported ip/ifconfig tool)"
fi
```

## Layer 2 — can we reach the gateway and the wider internet?

```!
TARGET="${ARGUMENTS:-8.8.8.8}"
TARGET=$(echo "$TARGET" | awk '{print $1}')
[ -z "$TARGET" ] && TARGET="8.8.8.8"
ping -c 3 -W 2 "$TARGET" 2>&1 | tail -8
```

## Layer 3 — DNS

```!
TARGET="${ARGUMENTS:-google.com}"
TARGET=$(echo "$TARGET" | awk '{print $1}')
[ -z "$TARGET" ] && TARGET="google.com"
if command -v dig >/dev/null 2>&1; then
  dig +short "$TARGET" 2>/dev/null | head -5
  echo "---"
  dig +short -x $(dig +short "$TARGET" 2>/dev/null | head -1) 2>/dev/null | head -3
elif command -v nslookup >/dev/null 2>&1; then
  nslookup "$TARGET" 2>/dev/null | tail -10
else
  echo "(no dns tool found)"
fi
```

## Interpreting the output

Run through the layers in order — the first one that fails is usually the root cause.

- **No link / no IP** in Layer 1 → cable unplugged, Wi-Fi not connected, DHCP failed. Tell the user to check Wi-Fi menu / Ethernet cable.
- **Can't ping gateway** → local network problem. Reboot the router; check if other devices work.
- **Can ping gateway, can't ping 8.8.8.8** → ISP outage or the router has lost its WAN side.
- **Can ping 8.8.8.8, can't resolve names** → DNS problem. Suggest trying `1.1.1.1` or `8.8.8.8` as DNS servers.
- **Resolves, but specific site fails** → it's the site's problem (or it's blocked by a firewall / VPN / parental controls).

## Next steps to suggest

- `traceroute $TARGET` to find where packets are dropping.
- `curl -v https://$TARGET` if HTTP is the failing layer (cert errors, redirects, etc.).
- For corporate VPN issues: disconnect & reconnect; check that the VPN client's status is green.
- For Wi-Fi: "Forget" the network and rejoin; reset network settings on the device as a last resort.

## What NOT to do

- Don't change network configuration without telling the user (no auto-flushing DNS caches, no toggling adapters).
- Don't run `sudo` — if a fix needs elevation, instruct the user to run it themselves.
- Don't probe targets the user didn't name (no port scans of random hosts).
