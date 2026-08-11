# Fleet Guardian API standard

## RESTAPI v2

Use on pfSense `2.7.2`, `2.8.x` and newer RESTAPI v2 installs.

- Enabled: enabled
- Keep Backup: enabled
- Represent Interfaces As: Internal ID
- Allowed Interfaces: `wan,lo0` while Fleet Guardian connects by DDNS/WAN; later restrict to the management VPN/interface
- Read Only: disabled
- Authentication Methods: Key
- JWT Expiration: 3600
- Login Protection: enabled
- Expose Sensitive Fields: disabled
- Enable HATEOAS: disabled
- Allow Pre-releases: disabled
- HA Sync: disabled unless the firewall pair uses HA and you intentionally want RESTAPI settings synced

Create one key named `Fleet Guardian` on the `Keys` tab. Store the key only in Fleet Guardian or the encrypted credential store.

## API v1

Use on pfSense `2.5.x`, `2.6.x`, `2.7.0` and `2.7.1`.

- Enable API: enabled
- Persist/Keep Backup: enabled
- Allowed Interfaces: `wan,lo0` while Fleet Guardian connects by DDNS/WAN; later restrict to the management VPN/interface
- Authentication Mode: API token
- Key Hash: SHA256
- Key Bytes: 32
- Read Only: disabled
- Login Protection: enabled

Generate one client token for Fleet Guardian and store the returned `client-id` and `client-token`.
