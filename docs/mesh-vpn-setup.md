# Mesh-VPN setup (connecting Recalbox machines across homes)

When the dashboard server and the Recalbox machines live in **different homes** (behind
separate NATs), they cannot reach each other over the LAN. A mesh VPN puts every machine
on one private overlay network so the existing SSH/MQTT pipeline keeps working — only the
`host` value of each Recalbox changes to a tailnet address.

This guide uses **Tailscale** (hosted) as the primary path. A **Headscale** (self-hosted)
annex is at the end.

## Topology

```
                         ┌─────────────────────────┐
                         │  Central dashboard host  │
                         │  (always-on, on tailnet) │
                         │  --accept-routes         │
                         └────────────┬─────────────┘
                                      │  tailnet (WireGuard mesh)
                 ┌────────────────────┼────────────────────┐
                 │                                          │
      ┌──────────┴───────────┐                  ┌───────────┴──────────┐
      │  Home A subnet router │                  │  Home B subnet router │
      │  (Pi / mini-PC)       │                  │  (Pi / mini-PC)       │
      │  --advertise-routes   │                  │  --advertise-routes   │
      │   =10.10.0.0/24       │                  │   =10.20.0.0/24       │
      └──────────┬───────────┘                  └───────────┬──────────┘
                 │ LAN                                       │ LAN
        ┌────────┴────────┐                         ┌────────┴────────┐
        │ Recalbox (10.10.0.5) │                    │ Recalbox (10.20.0.5) │
        │ unchanged             │                    │ unchanged            │
        └──────────────────────┘                    └──────────────────────┘
```

The Recalbox OS is read-only and locked down, so **nothing is installed on the Recalbox**.
Each home runs one always-on **subnet router** that advertises its LAN into the tailnet;
the central server reaches each Recalbox by its LAN IP through that router.

## 1. Create a Tailscale account

1. Sign up at <https://tailscale.com> and create a tailnet.
2. Leave **MagicDNS** enabled (Admin console → DNS) — it gives each node a stable name.

## 2. Per home: install a subnet router

On an always-on device in each home (Raspberry Pi, mini-PC, or a router with Tailscale
support):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
# Advertise this home's LAN. Use a UNIQUE CIDR per home (see the warning below).
sudo tailscale up --advertise-routes=10.10.0.0/24
```

Then in the Tailscale admin console → **Machines** → the subnet router → **Edit route
settings**, approve the advertised subnet. Routes are not active until approved.

## 3. Central server: accept routes

On the always-on host that runs the dashboard container:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-routes
```

The server can now reach every approved home subnet.

## 4. Point the dashboard at each Recalbox

In the dashboard, edit each Recalbox and set its **host** to the LAN IP it has inside its
home (e.g. `10.10.0.5`), or a MagicDNS name if you assigned one. SSH port, MQTT port, and
credentials are unchanged. Use the **Test connection** button on the edit page to confirm
SSH and MQTT both succeed.

## 5. Lock it down (ACLs)

In the Tailscale admin console → **Access controls**, restrict traffic so the dashboard
host reaches only what it needs — the Recalbox SSH and MQTT ports. Example policy fragment:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:dashboard"],
      "dst": ["10.10.0.5:22,1883", "10.20.0.5:22,1883"]
    }
  ]
}
```

Tag the dashboard host with `tag:dashboard` (Machines → Edit ACL tags). Consider enabling
**tailnet lock** if you want device-key approval for new nodes.

## ⚠️ Overlapping subnets (the #1 pitfall)

If two homes both use `192.168.1.0/24` (the most common default), advertising both into the
same tailnet creates an **overlapping-route collision** and traffic will go to the wrong
home. Fix it one of these ways:

- Give each home a **unique LAN CIDR** (e.g. Home A `10.10.0.0/24`, Home B `10.20.0.0/24`).
  Change the router's DHCP range; the Recalbox picks up the new subnet on reconnect.
- Or use Tailscale **4via6** subnet routers, which map each overlapping subnet to a unique
  IPv6 range. See <https://tailscale.com/kb/1201/4via6-subnets>.

Plan unique CIDRs **before** onboarding the second home — it is far easier than renumbering
later.

## Troubleshooting

- **Can't reach the Recalbox:** confirm the subnet route is *approved* in the admin console
  and the server was brought up with `--accept-routes`.
- **MagicDNS name doesn't resolve:** MagicDNS covers tailnet nodes, not LAN devices behind a
  subnet router — use the Recalbox's LAN IP for those.
- **High latency / drops:** check `tailscale status` for a relayed (DERP) connection; a
  direct connection needs UDP reachability. `tailscale ping <node>` shows the path.

## Annex: self-hosting with Headscale

If you outgrow Tailscale's free plan (its user/seat limits) or want to self-host the
coordinator, [Headscale](https://github.com/juanfont/headscale) is an open-source,
API-compatible control server. Run it on the same always-on host as the dashboard (see
`docs/deployment.md`), point each node at it with `tailscale up --login-server=https://…`,
and approve subnet routes with `headscale routes enable`. The node-side setup, subnet
routers, and overlapping-subnet rules above are identical; only the coordinator changes.
