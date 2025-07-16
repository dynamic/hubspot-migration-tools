const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class ActiveCampaignSyncChecker {
  constructor() {
    this.acClient = axios.create({
      baseURL: config.activecampaign.apiUrl,
      headers: {
        'Api-Token': config.activecampaign.apiKey
      }
    });
  }

  async getAllContacts() {
    logger.info('Fetching contacts from ActiveCampaign...');
    let allContacts = [];
    let offset = 0;
    const limit = 100;
    
    try {
      do {
        const response = await this.acClient.get('/api/3/contacts', {
          params: {
            limit,
            offset
          }
        });
        
        const contacts = response.data.contacts;
        allContacts = allContacts.concat(contacts);
        
        logger.info(`Fetched ${allContacts.length} contacts from ActiveCampaign...`);
        
        // Break if we got fewer contacts than the limit (last page)
        if (contacts.length < limit) {
          break;
        }
        
        offset += limit;
        
        // Rate limiting
        await this.delay(config.settings.apiRateLimitDelay);
        
      } while (true);
      
    } catch (error) {
      logger.error('Error fetching ActiveCampaign contacts:', error.message);
      throw error;
    }
    
    logger.info(`Total ActiveCampaign contacts: ${allContacts.length}`);
    return allContacts;
  }

  async getCustomFields() {
    logger.info('Fetching custom fields from ActiveCampaign...');
    
    try {
      const response = await this.acClient.get('/api/3/fields');
      const fields = response.data.fields;
      
      logger.info(`Found ${fields.length} custom fields in ActiveCampaign`);
      return fields;
      
    } catch (error) {
      logger.error('Error fetching custom fields:', error.message);
      throw error;
    }
  }

  async checkSyncStatus() {
    logger.info('Checking sync status between ActiveCampaign and HubSpot...');
    
    try {
      const [acContacts, acFields] = await Promise.all([
        this.getAllContacts(),
        this.getCustomFields()
      ]);
      
      const report = {
        activecampaign: {
          totalContacts: acContacts.length,
          customFields: acFields.length,
          sampleContacts: acContacts.slice(0, 5).map(contact => ({
            id: contact.id,
            email: contact.email,
            firstName: contact.firstName,
            lastName: contact.lastName,
            createdDate: contact.cdate,
            updatedDate: contact.udate
          })),
          customFieldsList: acFields.map(field => ({
            id: field.id,
            title: field.title,
            type: field.type,
            isRequired: field.isrequired === '1'
          }))
        },
        analyzedAt: new Date().toISOString()
      };
      
      // Save report
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync('reports')) {
        fs.mkdirSync('reports', { recursive: true });
      }
      
      const reportPath = path.join('reports', 'activecampaign-sync-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      
      // Generate summary
      const summary = `
ACTIVECAMPAIGN SYNC STATUS REPORT
=================================
Generated: ${new Date().toLocaleString()}

ACTIVECAMPAIGN DATA:
- Total Contacts: ${report.activecampaign.totalContacts.toLocaleString()}
- Custom Fields: ${report.activecampaign.customFields}

CUSTOM FIELDS AVAILABLE:
${report.activecampaign.customFieldsList.map((field, index) => 
  `${index + 1}. ${field.title} (${field.type}) ${field.isRequired ? '- Required' : ''}`
).join('\n')}

SAMPLE CONTACTS:
${report.activecampaign.sampleContacts.map((contact, index) => 
  `${index + 1}. ${contact.firstName} ${contact.lastName} (${contact.email})`
).join('\n')}

NEXT STEPS:
1. Compare this data with your HubSpot contacts
2. Identify missing custom fields that need to be synced
3. Plan data enhancement strategy
4. Consider running the duplicate analyzer on HubSpot data

Full details saved to: ${reportPath}
`;
      
      const summaryPath = path.join('reports', 'activecampaign-sync-summary.txt');
      fs.writeFileSync(summaryPath, summary);
      
      console.log(summary);
      logger.info(`Reports saved to reports/ directory`);
      
      return report;
      
    } catch (error) {
      logger.error('Error checking sync status:', error.message);
      throw error;
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the sync check
async function runSyncCheck() {
  const checker = new ActiveCampaignSyncChecker();
  
  try {
    logger.info('Starting ActiveCampaign sync check...');
    
    const report = await checker.checkSyncStatus();
    
    logger.info('✅ Sync check complete!');
    console.log('\n✅ Sync check complete!');
    console.log('📁 Check reports/activecampaign-sync-report.json for full details');
    console.log('📄 Check reports/activecampaign-sync-summary.txt for summary');
    
    return report;
    
  } catch (error) {
    logger.error('❌ Error during sync check:', error.message);
    console.error('❌ Error during sync check:', error.message);
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = ActiveCampaignSyncChecker;

// Run if called directly
if (require.main === module) {
  runSyncCheck();
}
