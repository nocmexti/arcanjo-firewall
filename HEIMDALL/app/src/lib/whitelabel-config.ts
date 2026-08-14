Porq/**
 * Whitelabel configuration for HEIMDALL Fleet Guardian
 * This file provides configuration options for customizing the application
 * for different clients while maintaining core functionality.
 */

export interface WhitelabelConfig {
  // Application metadata
  appName: string;
  companyName: string;
  companyLogo?: string;
  supportEmail: string;
  
  // Branding colors
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  
  // Features and capabilities
  enableBiometricAuth: boolean;
  enableGPSLocation: boolean;
  enableFileUpload: boolean;
  
  // Custom messages
  welcomeMessage: string;
  loginTitle: string;
  loginSubtitle: string;
  
  // Footer information
  footerText: string;
  copyrightYear: number;
}

// Default configuration
export const DEFAULT_WHITELABEL_CONFIG: WhitelabelConfig = {
  appName: "HEIMDALL Fleet Guardian",
  companyName: "HEIMDALL",
  companyLogo: "/logo.png",
  supportEmail: "support@heimdall.com.br",
  
  // Branding colors - default blue theme
  primaryColor: "#3b82f6",   // blue-500
  secondaryColor: "#1e40af", // blue-700
  accentColor: "#93c5fd",    // blue-300
  
  // Features
  enableBiometricAuth: true,
  enableGPSLocation: true,
  enableFileUpload: true,
  
  // Custom messages
  welcomeMessage: "Bem-vindo ao HEIMDALL Fleet Guardian",
  loginTitle: "Acesso ao Sistema",
  loginSubtitle: "Gerencie seus firewalls de forma centralizada",
  
  // Footer information
  footerText: "© 2026 HEIMDALL. Todos os direitos reservados.",
  copyrightYear: new Date().getFullYear(),
};

// Get whitelabel configuration based on environment variables (server-side)
export function getWhitelabelConfig(): WhitelabelConfig {
  const config = { ...DEFAULT_WHITELABEL_CONFIG };
  
  // This will be replaced with actual environment variable values during build or server startup
  // For now, we return the default config to avoid TypeScript errors in client code
  return config;
}