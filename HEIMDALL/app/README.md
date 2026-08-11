# Fleet Guardian

Fleet Guardian is a web manager for pfSense fleets. It centralizes inventory,
connection checks, snapshots, backups, baseline compliance and audit logs so the
team does not need to manage more than 100 devices from spreadsheets.

## Stack

- TanStack Start
- React
- TypeScript
- Tailwind CSS
- Supabase

## Development

Use Node.js 22.12+.

```sh
npm install
npm run dev
```

## pfSense Communication

The app has a provider layer under `src/lib/pfsense`.

- `mock`: deterministic development data.
- `restapi`: real communication through pfSense REST API Package v2.

Install and configure the REST API package on each pfSense:

https://github.com/pfrest/pfSense-pkg-RESTAPI

Then set the backend environment:

```sh
PFSENSE_PROVIDER=restapi
PFSENSE_CRED_ENCRYPTION_KEY=<long-random-secret>
PFSENSE_REQUEST_TIMEOUT_MS=15000
```

In the device form, store only the host/IP and port. Do not include `https://`
or URL paths. pfSense API keys are encrypted server-side before they are stored
and are never sent back to the browser.

## Safety Model

- Real pfSense calls stay behind the server-side `PfSenseProvider` interface.
- Credentials are encrypted with AES-256-GCM.
- RBAC controls write actions.
- Destructive actions require explicit confirmation.
- Audit logs record critical operations.
- Baseline drift is shown before any future mass-change workflow.
