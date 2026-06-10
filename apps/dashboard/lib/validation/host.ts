// Host-format whitelist for SSH/MQTT targets: hostnames, IPv4, IPv6 (tailnet fd7a:…),
// and MagicDNS names. The colon enables IPv6 addresses for mesh-VPN hosts.
// This is a sanity/anti-injection filter only — node-ssh and mqtt validate the real
// address when a connection is attempted.
export const HOST_REGEX = /^[a-zA-Z0-9.:-]+$/
