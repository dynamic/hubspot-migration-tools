const dotenv = require('dotenv');
dotenv.config();

const config = {
  hubspot: {
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
    portalId: process.env.HUBSPOT_PORTAL_ID,
    apiUrl: 'https://api.hubapi.com'
  },
  activecampaign: {
    apiUrl: process.env.ACTIVECAMPAIGN_API_URL,
    apiKey: process.env.ACTIVECAMPAIGN_API_KEY
  },
  settings: {
    apiRateLimitDelay: parseInt(process.env.API_RATE_LIMIT_DELAY) || 100,
    batchSize: parseInt(process.env.BATCH_SIZE) || 100,
    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE || 'logs/migration.log',
    cacheTtlMinutes: parseInt(process.env.CACHE_TTL_MINUTES) || 60
  }
};

// Validate required environment variables
const requiredVars = [
  'HUBSPOT_ACCESS_TOKEN',
  'ACTIVECAMPAIGN_API_URL',
  'ACTIVECAMPAIGN_API_KEY'
];

const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`  - ${varName}`));
  console.error('\nPlease copy .env.example to .env and fill in your API credentials.');
  process.exit(1);
}

module.exports = config;
