# HEIMDALL Fleet Guardian - Whitelabel System

This document explains how to configure and use the whitelabel system for HEIMDALL Fleet Guardian.

## Overview

The HEIMDALL Fleet Guardian application supports whitelabel deployment, allowing different organizations to customize the application's branding, colors, features, and messaging without modifying the core codebase.

## Configuration Options

Whitelabel settings can be configured through environment variables. The following environment variables are supported:

| Environment Variable | Description | Default Value |
|---------------------|-------------|---------------|
| `WHITELABEL_APP_NAME` | Application name displayed in UI | "HEIMDALL Fleet Guardian" |
| `WHITELABEL_COMPANY_NAME` | Company name for branding | "HEIMDALL" |
| `WHITELABEL_COMPANY_LOGO` | Path to company logo | "/logo.png" |
| `WHITELABEL_SUPPORT_EMAIL` | Support email address | "support@heimdall.com.br" |
| `WHITELABEL_PRIMARY_COLOR` | Primary branding color (hex) | "#3b82f6" |
| `WHITELABEL_SECONDARY_COLOR` | Secondary branding color (hex) | "#1e40af" |
| `WHITELABEL_ACCENT_COLOR` | Accent branding color (hex) | "#93c5fd" |
| `WHITELABEL_ENABLE_BIOMETRIC_AUTH` | Enable biometric authentication | true |
| `WHITELABEL_ENABLE_GPS_LOCATION` | Enable GPS location tracking | true |
| `WHITELABEL_ENABLE_FILE_UPLOAD` | Enable file upload functionality | true |
| `WHITELABEL_WELCOME_MESSAGE` | Welcome message on login page | "Bem-vindo ao HEIMDALL Fleet Guardian" |
| `WHITELABEL_LOGIN_TITLE` | Login page title | "Acesso ao Sistema" |
| `WHITELABEL_LOGIN_SUBTITLE` | Login page subtitle | "Gerencie seus firewalls de forma centralizada" |
| `WHITELABEL_FOOTER_TEXT` | Footer text | "© 2026 HEIMDALL. Todos os direitos reservados." |
| `WHITELABEL_COPYRIGHT_YEAR` | Copyright year | Current year |

## Usage

### 1. Using Environment Variables

Set the environment variables when running the application:

```bash
# Example with docker run
docker run -e WHITELABEL_APP_NAME="My Company Name" \
           -e WHITELABEL_COMPANY_NAME="My Company" \
           -e WHITELABEL_SUPPORT_EMAIL="support@mycompany.com" \
           -e WHITELABEL_PRIMARY_COLOR="#ff0000" \
           my-heimdall-image:latest
```

### 2. Using Docker Compose

In your `docker-compose.yml` file:

```yaml
version: '3.8'
services:
  heimdall:
    image: my-heimdall-image:latest
    environment:
      - WHITELABEL_APP_NAME=My Company Name
      - WHITELABEL_COMPANY_NAME=My Company
      - WHITELABEL_SUPPORT_EMAIL=support@mycompany.com
      - WHITELABEL_PRIMARY_COLOR=#ff0000
```

### 3. Building with Custom Configuration

For Docker builds, the `whitelabel-init.js` script will automatically process environment variables and create a configuration file during container startup.

## Files Created

- `whitelabel-config.json`: Contains processed whitelabel settings
- `whitelabel-init.js`: Initialization script that processes environment variables
- `test-whitelabel.js`: Test script to verify whitelabel configuration

## Testing

To test your whitelabel configuration:

```bash
# Run the initialization script
node whitelabel-init.js

# Run the test script
node test-whitelabel.js
```

The test will verify that:
1. The configuration file is created successfully
2. All required fields are present
3. Configuration values are correctly parsed

## Implementation Details

The whitelabel system uses a two-phase approach:

1. **Runtime Configuration**: Environment variables are processed during container initialization
2. **Configuration File Generation**: A JSON configuration file is generated with all settings
3. **Application Integration**: The application reads this configuration at startup

This approach allows for easy customization while maintaining the integrity of the core application code.