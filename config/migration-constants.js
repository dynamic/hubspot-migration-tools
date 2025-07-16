// Shared configuration constants for migration tools
module.exports = {
  // Migration date - the placeholder close date used during migration
  // This date should be updated with actual close dates from ActiveCampaign
  MIGRATION_DATE: process.env.MIGRATION_DATE || '2025-07-16',
  
  // Date format for consistent parsing
  DATE_FORMAT: 'YYYY-MM-DD',
  
  // Migration-related constants
  MIGRATION_CONSTANTS: {
    // Timezone offset handling - migration date is in UTC
    TIMEZONE_OFFSET: 0,
    
    // Deal statuses that require close dates
    CLOSED_DEAL_STATUSES: ['closedwon', 'closedlost'],
    
    // ActiveCampaign status mappings
    AC_STATUS_MAPPING: {
      '0': 'open',
      '1': 'won',
      '2': 'lost',
      '3': 'open' // in progress
    }
  }
};
