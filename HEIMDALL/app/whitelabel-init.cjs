/**
 * Whitelabel initialization script for HEIMDALL Fleet Guardian
 * This script prepares the application for whitelabel deployment by setting
 * environment variables and preparing configuration files.
 */

// Import necessary modules
const fs = require('fs');
const path = require('path');

// Define default whitelabel settings
const DEFAULT_WHITELABEL_CONFIG = {
  appName: "HEIMDALL Fleet Guardian",
  companyName: "HEIMDALL",
  companyLogo: "/logo.png",
  supportEmail: "support@heimdall.com.br",
  primaryColor: "#3b82f6",
  secondaryColor: "#1e40af",
  accentColor: "#93c5fd",
  enableBiometricAuth: true,
  enableGPSLocation: true,
  enableFileUpload: true,
  welcomeMessage: "Bem-vindo ao HEIMDALL Fleet Guardian",
  loginTitle: "Acesso ao Sistema",
  loginSubtitle: "Gerencie seus firewalls de forma centralizada",
  footerText: "© 2026 HEIMDALL. Todos os direitos reservados.",
  copyrightYear: new Date().getFullYear(),
};

// Function to get environment variables with defaults
function getEnvVar(name, defaultValue) {
  return process.env[name] || defaultValue;
}

// Function to get boolean environment variables with defaults
function getEnvBool(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

// Main initialization function
function initializeWhitelabel() {
  console.log("Initializing whitelabel configuration...");
  
  // Create the whitelabel config object
  const whitelabelConfig = {
    appName: getEnvVar('WHITELABEL_APP_NAME', DEFAULT_WHITELABEL_CONFIG.appName),
    companyName: getEnvVar('WHITELABEL_COMPANY_NAME', DEFAULT_WHITELABEL_CONFIG.companyName),
    companyLogo: getEnvVar('WHITELABEL_COMPANY_LOGO', DEFAULT_WHITELABEL_CONFIG.companyLogo),
    supportEmail: getEnvVar('WHITELABEL_SUPPORT_EMAIL', DEFAULT_WHITELABEL_CONFIG.supportEmail),
    primaryColor: getEnvVar('WHITELABEL_PRIMARY_COLOR', DEFAULT_WHITELABEL_CONFIG.primaryColor),
    secondaryColor: getEnvVar('WHITELABEL_SECONDARY_COLOR', DEFAULT_WHITELABEL_CONFIG.secondaryColor),
    accentColor: getEnvVar('WHITELABEL_ACCENT_COLOR', DEFAULT_WHITELABEL_CONFIG.accentColor),
    enableBiometricAuth: getEnvBool('WHITELABEL_ENABLE_BIOMETRIC_AUTH', DEFAULT_WHITELABEL_CONFIG.enableBiometricAuth),
    enableGPSLocation: getEnvBool('WHITELABEL_ENABLE_GPS_LOCATION', DEFAULT_WHITELABEL_CONFIG.enableGPSLocation),
    enableFileUpload: getEnvBool('WHITELABEL_ENABLE_FILE_UPLOAD', DEFAULT_WHITELABEL_CONFIG.enableFileUpload),
    welcomeMessage: getEnvVar('WHITELABEL_WELCOME_MESSAGE', DEFAULT_WHITELABEL_CONFIG.welcomeMessage),
    loginTitle: getEnvVar('WHITELABEL_LOGIN_TITLE', DEFAULT_WHITELABEL_CONFIG.loginTitle),
    loginSubtitle: getEnvVar('WHITELABEL_LOGIN_SUBTITLE', DEFAULT_WHITELABEL_CONFIG.loginSubtitle),
    footerText: getEnvVar('WHITELABEL_FOOTER_TEXT', DEFAULT_WHITELABEL_CONFIG.footerText),
    copyrightYear: parseInt(getEnvVar('WHITELABEL_COPYRIGHT_YEAR', DEFAULT_WHITELABEL_CONFIG.copyrightYear.toString()), 10),
  };
  
  // Create a JSON configuration file
  const configPath = path.join(process.cwd(), 'whitelabel-config.json');
  fs.writeFileSync(configPath, JSON.stringify(whitelabelConfig, null, 2));
  
  console.log("Whitelabel configuration initialized successfully!");
  console.log(`Configuration saved to: ${configPath}`);
  console.log("Configuration:", whitelabelConfig);
}

// Run initialization
try {
  initializeWhitelabel();
} catch (error) {
  console.error('Failed to initialize whitelabel:', error);
  process.exit(1);
}