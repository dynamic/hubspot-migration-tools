const config = require('./config');
const logger = require('./utils/logger');

console.log('🚀 HubSpot Migration Tools');
console.log('==========================');

// Validate configuration
try {
  logger.info('Validating configuration...');
  
  if (!config.hubspot.accessToken) {
    throw new Error('HubSpot access token is required');
  }
  
  if (!config.activecampaign.apiKey) {
    throw new Error('ActiveCampaign API key is required');
  }
  
  logger.info('✅ Configuration valid');
  
  console.log('\nAvailable commands:');
  console.log('  npm run analyze      - Run duplicate analysis on HubSpot contacts');
  console.log('  npm run sync-check   - Check sync status with ActiveCampaign');
  console.log('  npm run gap-analysis - Compare data between HubSpot and ActiveCampaign');
  console.log('  node scripts/[script-name].js - Run specific script');
  console.log('\nFirst time setup:');
  console.log('  1. Copy .env.example to .env');
  console.log('  2. Fill in your API credentials');
  console.log('  3. Run npm install');
  console.log('  4. Run npm run analyze');
  
} catch (error) {
  logger.error('❌ Configuration error:', error.message);
  console.log('\n❌ Configuration error:', error.message);
  console.log('\nPlease check your .env file and ensure all required variables are set.');
  console.log('Copy .env.example to .env and fill in your API credentials.');
  process.exit(1);
}
