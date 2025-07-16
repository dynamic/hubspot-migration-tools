const hubspot = require('@hubspot/api-client');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class DataGapAnalyzer {
  constructor() {
    this.hubspotClient = new hubspot.Client({
      accessToken: config.hubspot.accessToken
    });
    
    this.acClient = axios.create({
      baseURL: config.activecampaign.apiUrl,
      headers: {
        'Api-Token': config.activecampaign.apiKey
      }
    });
    
    this.hubspotContacts = [];
    this.hubspotCompanies = [];
    this.hubspotDeals = [];
    this.acContacts = [];
    this.acDeals = [];
    this.gaps = {
      contacts: {
        missingInHubspot: [],
        missingInActiveCampaign: [],
        fieldMismatches: [],
        emptyFields: []
      },
      companies: {
        emptyFields: []
      },
      deals: {
        emptyFields: []
      }
    };
  }

  async getHubSpotContacts() {
    logger.info('Fetching HubSpot contacts...');
    let after = undefined;
    let allContacts = [];

    do {
      try {
        const response = await this.hubspotClient.crm.contacts.getAll({
          properties: [
            'email', 'firstname', 'lastname', 'phone', 'company',
            'createdate', 'lastmodifieddate', 'lifecyclestage', 'jobtitle',
            'website', 'city', 'state', 'country'
          ],
          limit: 100,
          after: after
        });

        allContacts = allContacts.concat(response.results);
        after = response.paging?.next?.after;
        
        await this.delay(config.settings.apiRateLimitDelay);
        
      } catch (error) {
        logger.error('Error fetching HubSpot contacts:', error.message);
        throw error;
      }
    } while (after);

    this.hubspotContacts = allContacts;
    logger.info(`HubSpot contacts fetched: ${allContacts.length}`);
    return allContacts;
  }

  async getHubSpotCompanies() {
    logger.info('Fetching HubSpot companies...');
    let after = undefined;
    let allCompanies = [];

    try {
      do {
        const response = await this.hubspotClient.crm.companies.getAll({
          properties: [
            'name', 'domain', 'website', 'phone', 'city', 'state',
            'createdate', 'lastmodifieddate', 'industry', 'numberofemployees'
          ],
          limit: 100,
          after: after
        });

        allCompanies = allCompanies.concat(response.results);
        after = response.paging?.next?.after;
        
        await this.delay(config.settings.apiRateLimitDelay);
        
      } while (after);
    } catch (error) {
      if (error.message.includes('403') || error.message.includes('402')) {
        logger.warn('Companies API not available (likely free tier limitation)');
        return [];
      }
      logger.error('Error fetching HubSpot companies:', error.message);
      throw error;
    }

    this.hubspotCompanies = allCompanies;
    logger.info(`HubSpot companies fetched: ${allCompanies.length}`);
    return allCompanies;
  }

  async getHubSpotDeals() {
    logger.info('Fetching HubSpot deals...');
    let after = undefined;
    let allDeals = [];

    try {
      do {
        const response = await this.hubspotClient.crm.deals.getAll({
          properties: [
            'dealname', 'amount', 'dealstage', 'pipeline',
            'createdate', 'lastmodifieddate', 'closedate', 'dealtype'
          ],
          limit: 100,
          after: after
        });

        allDeals = allDeals.concat(response.results);
        after = response.paging?.next?.after;
        
        await this.delay(config.settings.apiRateLimitDelay);
        
      } while (after);
    } catch (error) {
      if (error.message.includes('403') || error.message.includes('402')) {
        logger.warn('Deals API not available (likely free tier limitation)');
        return [];
      }
      logger.error('Error fetching HubSpot deals:', error.message);
      throw error;
    }

    this.hubspotDeals = allDeals;
    logger.info(`HubSpot deals fetched: ${allDeals.length}`);
    return allDeals;
  }

  async getActiveCampaignDeals() {
    logger.info('Fetching ActiveCampaign deals...');
    let allDeals = [];
    let offset = 0;
    const limit = 100;
    
    try {
      do {
        const response = await this.acClient.get('/api/3/deals', {
          params: {
            limit,
            offset
          }
        });
        
        const deals = response.data.deals;
        allDeals = allDeals.concat(deals);
        
        if (deals.length < limit) {
          break;
        }
        
        offset += limit;
        await this.delay(config.settings.apiRateLimitDelay);
        
      } while (true);
      
    } catch (error) {
      logger.error('Error fetching ActiveCampaign deals:', error.message);
      // ActiveCampaign deals might not be available
      return [];
    }
    
    this.acDeals = allDeals;
    logger.info(`ActiveCampaign deals fetched: ${allDeals.length}`);
    return allDeals;
  }

  async getActiveCampaignContacts() {
    logger.info('Fetching ActiveCampaign contacts...');
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
        
        if (contacts.length < limit) {
          break;
        }
        
        offset += limit;
        await this.delay(config.settings.apiRateLimitDelay);
        
      } while (true);
      
    } catch (error) {
      logger.error('Error fetching ActiveCampaign contacts:', error.message);
      throw error;
    }
    
    this.acContacts = allContacts;
    logger.info(`ActiveCampaign contacts fetched: ${allContacts.length}`);
    return allContacts;
  }

  analyzeContactGaps() {
    logger.info('Analyzing contact gaps between platforms...');
    
    // Create email-based lookup maps
    const hubspotByEmail = new Map();
    const acByEmail = new Map();
    
    this.hubspotContacts.forEach(contact => {
      const email = contact.properties.email?.toLowerCase();
      if (email) {
        hubspotByEmail.set(email, contact);
      }
    });
    
    this.acContacts.forEach(contact => {
      const email = contact.email?.toLowerCase();
      if (email) {
        acByEmail.set(email, contact);
      }
    });
    
    // Find contacts missing in HubSpot
    acByEmail.forEach((contact, email) => {
      if (!hubspotByEmail.has(email)) {
        this.gaps.contacts.missingInHubspot.push({
          email: email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone,
          createdDate: contact.cdate
        });
      }
    });
    
    // Find contacts missing in ActiveCampaign
    hubspotByEmail.forEach((contact, email) => {
      if (!acByEmail.has(email)) {
        this.gaps.contacts.missingInActiveCampaign.push({
          email: email,
          firstName: contact.properties.firstname,
          lastName: contact.properties.lastname,
          phone: contact.properties.phone,
          company: contact.properties.company,
          createdDate: contact.properties.createdate
        });
      }
    });
    
    logger.info(`Found ${this.gaps.contacts.missingInHubspot.length} contacts missing in HubSpot`);
    logger.info(`Found ${this.gaps.contacts.missingInActiveCampaign.length} contacts missing in ActiveCampaign`);
  }

  analyzeFieldMismatches() {
    logger.info('Analyzing field mismatches...');
    
    const hubspotByEmail = new Map();
    this.hubspotContacts.forEach(contact => {
      const email = contact.properties.email?.toLowerCase();
      if (email) {
        hubspotByEmail.set(email, contact);
      }
    });
    
    this.acContacts.forEach(acContact => {
      const email = acContact.email?.toLowerCase();
      if (email && hubspotByEmail.has(email)) {
        const hsContact = hubspotByEmail.get(email);
        const mismatches = [];
        
        // Compare names
        if (acContact.firstName !== hsContact.properties.firstname) {
          mismatches.push({
            field: 'firstName',
            activecampaign: acContact.firstName,
            hubspot: hsContact.properties.firstname
          });
        }
        
        if (acContact.lastName !== hsContact.properties.lastname) {
          mismatches.push({
            field: 'lastName',
            activecampaign: acContact.lastName,
            hubspot: hsContact.properties.lastname
          });
        }
        
        // Compare phone (normalized)
        const acPhone = acContact.phone?.replace(/\D/g, '');
        const hsPhone = hsContact.properties.phone?.replace(/\D/g, '');
        if (acPhone && hsPhone && acPhone !== hsPhone) {
          mismatches.push({
            field: 'phone',
            activecampaign: acContact.phone,
            hubspot: hsContact.properties.phone
          });
        }
        
        if (mismatches.length > 0) {
          this.gaps.contacts.fieldMismatches.push({
            email: email,
            mismatches: mismatches
          });
        }
      }
    });
    
    logger.info(`Found ${this.gaps.contacts.fieldMismatches.length} contacts with field mismatches`);
  }

  analyzeEmptyFields() {
    logger.info('Analyzing empty fields in HubSpot...');
    
    // Contact empty fields
    this.analyzeContactEmptyFields();
    
    // Company empty fields
    if (this.hubspotCompanies.length > 0) {
      this.analyzeCompanyEmptyFields();
    }
    
    // Deal empty fields
    if (this.hubspotDeals.length > 0) {
      this.analyzeDealEmptyFields();
    }
    
    logger.info('Empty field analysis complete');
  }

  analyzeContactEmptyFields() {
    const emptyFieldCounts = {
      firstname: 0,
      lastname: 0,
      phone: 0,
      company: 0,
      jobtitle: 0,
      website: 0,
      city: 0,
      state: 0
    };
    
    const emptyFieldExamples = {
      firstname: [],
      lastname: [],
      phone: [],
      company: [],
      jobtitle: [],
      website: [],
      city: [],
      state: []
    };
    
    this.hubspotContacts.forEach(contact => {
      Object.keys(emptyFieldCounts).forEach(field => {
        if (!contact.properties[field] || contact.properties[field].trim() === '') {
          emptyFieldCounts[field]++;
          if (emptyFieldExamples[field].length < 5) {
            emptyFieldExamples[field].push({
              email: contact.properties.email,
              id: contact.id
            });
          }
        }
      });
    });
    
    this.gaps.contacts.emptyFields = Object.keys(emptyFieldCounts).map(field => ({
      field: field,
      count: emptyFieldCounts[field],
      percentage: ((emptyFieldCounts[field] / this.hubspotContacts.length) * 100).toFixed(1),
      examples: emptyFieldExamples[field]
    }));
  }

  analyzeCompanyEmptyFields() {
    const emptyFieldCounts = {
      name: 0,
      domain: 0,
      website: 0,
      phone: 0,
      city: 0,
      state: 0,
      industry: 0,
      numberofemployees: 0
    };
    
    const emptyFieldExamples = {
      name: [],
      domain: [],
      website: [],
      phone: [],
      city: [],
      state: [],
      industry: [],
      numberofemployees: []
    };
    
    this.hubspotCompanies.forEach(company => {
      Object.keys(emptyFieldCounts).forEach(field => {
        if (!company.properties[field] || company.properties[field].trim() === '') {
          emptyFieldCounts[field]++;
          if (emptyFieldExamples[field].length < 5) {
            emptyFieldExamples[field].push({
              name: company.properties.name,
              id: company.id
            });
          }
        }
      });
    });
    
    this.gaps.companies.emptyFields = Object.keys(emptyFieldCounts).map(field => ({
      field: field,
      count: emptyFieldCounts[field],
      percentage: ((emptyFieldCounts[field] / this.hubspotCompanies.length) * 100).toFixed(1),
      examples: emptyFieldExamples[field]
    }));
  }

  analyzeDealEmptyFields() {
    const emptyFieldCounts = {
      dealname: 0,
      amount: 0,
      dealstage: 0,
      closedate: 0,
      dealtype: 0
    };
    
    const emptyFieldExamples = {
      dealname: [],
      amount: [],
      dealstage: [],
      closedate: [],
      dealtype: []
    };
    
    this.hubspotDeals.forEach(deal => {
      Object.keys(emptyFieldCounts).forEach(field => {
        if (!deal.properties[field] || deal.properties[field].trim() === '') {
          emptyFieldCounts[field]++;
          if (emptyFieldExamples[field].length < 5) {
            emptyFieldExamples[field].push({
              name: deal.properties.dealname,
              id: deal.id
            });
          }
        }
      });
    });
    
    this.gaps.deals.emptyFields = Object.keys(emptyFieldCounts).map(field => ({
      field: field,
      count: emptyFieldCounts[field],
      percentage: ((emptyFieldCounts[field] / this.hubspotDeals.length) * 100).toFixed(1),
      examples: emptyFieldExamples[field]
    }));
  }

  generateGapReport() {
    const report = {
      summary: {
        hubspotContacts: this.hubspotContacts.length,
        hubspotCompanies: this.hubspotCompanies.length,
        hubspotDeals: this.hubspotDeals.length,
        activecampaignContacts: this.acContacts.length,
        activecampaignDeals: this.acDeals.length,
        contactGaps: {
          missingInHubspot: this.gaps.contacts.missingInHubspot.length,
          missingInActiveCampaign: this.gaps.contacts.missingInActiveCampaign.length,
          fieldMismatches: this.gaps.contacts.fieldMismatches.length
        },
        analyzedAt: new Date().toISOString()
      },
      gaps: this.gaps,
      recommendations: this.generateRecommendations()
    };

    // Ensure reports directory exists
    if (!fs.existsSync('reports')) {
      fs.mkdirSync('reports', { recursive: true });
    }

    // Save detailed report
    const reportPath = path.join('reports', 'data-gap-analysis.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    // Generate readable summary
    this.generateGapSummary(report);
    
    logger.info(`Gap analysis report saved to ${reportPath}`);
    return report;
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.gaps.contacts.missingInHubspot.length > 0) {
      recommendations.push({
        type: 'missing_contacts',
        priority: 'high',
        message: `${this.gaps.contacts.missingInHubspot.length} contacts exist in ActiveCampaign but not in HubSpot`,
        action: 'Consider importing these contacts to HubSpot'
      });
    }
    
    if (this.gaps.contacts.fieldMismatches.length > 0) {
      recommendations.push({
        type: 'field_mismatches',
        priority: 'medium',
        message: `${this.gaps.contacts.fieldMismatches.length} contacts have different field values between platforms`,
        action: 'Review and determine which platform has the most accurate data'
      });
    }
    
    // Contact empty fields
    this.gaps.contacts.emptyFields.forEach(field => {
      if (field.count > 0) {
        recommendations.push({
          type: 'empty_contact_fields',
          priority: field.percentage > 50 ? 'high' : 'medium',
          message: `${field.count} contacts (${field.percentage}%) missing ${field.field} data`,
          action: `Consider populating contact ${field.field} from ActiveCampaign if available`
        });
      }
    });

    // Company empty fields
    if (this.gaps.companies.emptyFields) {
      this.gaps.companies.emptyFields.forEach(field => {
        if (field.count > 0) {
          recommendations.push({
            type: 'empty_company_fields',
            priority: field.percentage > 50 ? 'high' : 'medium',
            message: `${field.count} companies (${field.percentage}%) missing ${field.field} data`,
            action: `Consider populating company ${field.field} from external sources`
          });
        }
      });
    }

    // Deal empty fields
    if (this.gaps.deals.emptyFields) {
      this.gaps.deals.emptyFields.forEach(field => {
        if (field.count > 0) {
          recommendations.push({
            type: 'empty_deal_fields',
            priority: field.percentage > 50 ? 'high' : 'medium',
            message: `${field.count} deals (${field.percentage}%) missing ${field.field} data`,
            action: `Consider populating deal ${field.field} data for better pipeline management`
          });
        }
      });
    }

    // Free tier limitations
    if (this.hubspotCompanies.length === 0) {
      recommendations.push({
        type: 'free_tier',
        priority: 'info',
        message: 'Company data not available (HubSpot Free tier limitation)',
        action: 'Consider upgrading to access company management features'
      });
    }

    if (this.hubspotDeals.length === 0) {
      recommendations.push({
        type: 'free_tier',
        priority: 'info',
        message: 'Deal data not available (HubSpot Free tier limitation)',
        action: 'Consider upgrading to access deal pipeline management'
      });
    }
    
    return recommendations;
  }

  generateGapSummary(report) {
    const summary = `
DATA GAP ANALYSIS REPORT
========================
Generated: ${new Date().toLocaleString()}

SUMMARY:
- HubSpot Contacts: ${report.summary.hubspotContacts.toLocaleString()}
- HubSpot Companies: ${report.summary.hubspotCompanies.toLocaleString()}
- HubSpot Deals: ${report.summary.hubspotDeals.toLocaleString()}
- ActiveCampaign Contacts: ${report.summary.activecampaignContacts.toLocaleString()}
- ActiveCampaign Deals: ${report.summary.activecampaignDeals.toLocaleString()}

CONTACT GAPS:
- Missing in HubSpot: ${report.summary.contactGaps.missingInHubspot}
- Missing in ActiveCampaign: ${report.summary.contactGaps.missingInActiveCampaign}
- Field Mismatches: ${report.summary.contactGaps.fieldMismatches}

CONTACT EMPTY FIELD ANALYSIS:
${this.gaps.contacts.emptyFields.map(field => 
  `- ${field.field}: ${field.count} contacts (${field.percentage}%) missing data`
).join('\n')}

COMPANY EMPTY FIELD ANALYSIS:
${this.gaps.companies.emptyFields ? this.gaps.companies.emptyFields.map(field => 
  `- ${field.field}: ${field.count} companies (${field.percentage}%) missing data`
).join('\n') : 'No company data available (free tier limitation)'}

DEAL EMPTY FIELD ANALYSIS:
${this.gaps.deals.emptyFields ? this.gaps.deals.emptyFields.map(field => 
  `- ${field.field}: ${field.count} deals (${field.percentage}%) missing data`
).join('\n') : 'No deal data available (free tier limitation)'}

TOP FIELD MISMATCHES:
${this.gaps.contacts.fieldMismatches.slice(0, 5).map((mismatch, index) => 
  `${index + 1}. ${mismatch.email} - ${mismatch.mismatches.length} field(s) different`
).join('\n')}

RECOMMENDATIONS:
${report.recommendations.map((rec, index) => 
  `${index + 1}. [${rec.priority.toUpperCase()}] ${rec.message}\n   Action: ${rec.action}`
).join('\n\n')}

NEXT STEPS:
1. Review missing contacts - determine if they should be imported
2. Address high-priority empty fields by syncing from ActiveCampaign
3. Resolve field mismatches by choosing the most accurate source
4. Consider upgrading from free tier for companies/deals management
5. Run duplicate analysis after importing missing contacts

Full details saved to: reports/data-gap-analysis.json
`;

    const summaryPath = path.join('reports', 'data-gap-summary.txt');
    fs.writeFileSync(summaryPath, summary);
    console.log(summary);
    logger.info(`Gap analysis summary saved to ${summaryPath}`);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the gap analysis
async function runGapAnalysis() {
  const analyzer = new DataGapAnalyzer();
  
  try {
    logger.info('Starting data gap analysis...');
    
    // Fetch all data
    await analyzer.getHubSpotContacts();
    await analyzer.getHubSpotCompanies();
    await analyzer.getHubSpotDeals();
    await analyzer.getActiveCampaignContacts();
    await analyzer.getActiveCampaignDeals();
    
    // Analyze gaps
    analyzer.analyzeContactGaps();
    analyzer.analyzeFieldMismatches();
    analyzer.analyzeEmptyFields();
    
    const report = analyzer.generateGapReport();
    
    logger.info('✅ Gap analysis complete!');
    console.log('\n✅ Gap analysis complete!');
    console.log('📁 Check reports/data-gap-analysis.json for full details');
    console.log('📄 Check reports/data-gap-summary.txt for summary');
    
    return report;
    
  } catch (error) {
    logger.error('❌ Error during gap analysis:', error.message);
    console.error('❌ Error during gap analysis:', error.message);
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = DataGapAnalyzer;

// Run if called directly
if (require.main === module) {
  runGapAnalysis();
}
