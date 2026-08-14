/**
 * Test script for whitelabel functionality
 * This script tests if the whitelabel configuration is working properly
 */

// Simple test to verify that our config file can be read and parsed
const fs = require('fs');
const path = require('path');

function testWhitelabelConfig() {
  try {
    // Check if the config file exists
    const configPath = path.join(process.cwd(), 'whitelabel-config.json');
    
    if (!fs.existsSync(configPath)) {
      console.log("❌ Whitelabel configuration file not found");
      return false;
    }
    
    // Read and parse the config file
    const configFileContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configFileContent);
    
    console.log("✅ Whitelabel configuration file found and parsed successfully");
    console.log("Configuration:", JSON.stringify(config, null, 2));
    
    // Basic validation of required fields
    if (!config.appName) {
      console.log("❌ Missing appName in configuration");
      return false;
    }
    
    if (!config.companyName) {
      console.log("❌ Missing companyName in configuration");
      return false;
    }
    
    if (!config.supportEmail) {
      console.log("❌ Missing supportEmail in configuration");
      return false;
    }
    
    console.log("✅ All required configuration fields are present");
    return true;
    
  } catch (error) {
    console.error("❌ Error testing whitelabel configuration:", error.message);
    return false;
  }
}

// Run the test
console.log("Testing whitelabel configuration...");
const success = testWhitelabelConfig();

if (success) {
  console.log("\n🎉 Whitelabel functionality test PASSED");
  process.exit(0);
} else {
  console.log("\n💥 Whitelabel functionality test FAILED");
  process.exit(1);
}