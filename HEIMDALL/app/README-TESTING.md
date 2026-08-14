# How to Test Fleet Guardian Application

## Prerequisites
- Node.js 22.12+ installed
- npm or Bun package manager

## Setup Instructions

1. Open WSL terminal
2. Navigate to the application directory:
   ```bash
   cd /mnt/c/LAB/arcanjo-firewall/arcanjo-firewall/HEIMDALL/app
   ```

3. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## Testing the Application

The application will start on http://localhost:8080 by default.

### Key Features to Test:

1. **Device Management**:
   - Add new pfSense devices
   - View device status (online/offline)
   - Device connection checks

2. **Baseline Compliance**:
   - View baseline compliance reports
   - Check for drift detection
   - Review audit logs

3. **Backup and Snapshot**:
   - Perform backups
   - View snapshot history

## Development Mode

The application supports local demo mode which can be enabled with:
```bash
LOCAL_DEMO_MODE=true npm run dev
```

This will use mock data instead of real pfSense device communication.

## pfSense Integration

For real pfSense integration, you need to:

1. Install the REST API package on each pfSense device
2. Configure environment variables:
   ```
   PFSENSE_PROVIDER=restapi
   PFSENSE_CRED_ENCRYPTION_KEY=<long-random-secret>
   PFSENSE_REQUEST_TIMEOUT_MS=15000
   ```

3. Store only host/IP and port in the device form (without https:// or URL paths)

## Important Notes

- All credentials are encrypted with AES-256-GCM before storage
- RBAC controls write actions
- Destructive actions require explicit confirmation
- Audit logs record critical operations