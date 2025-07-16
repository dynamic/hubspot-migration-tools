const axios = require('axios');
const HubSpotAPI = require('../utils/hubspot-api');
const ActiveCampaignAPI = require('../utils/activecampaign-api');
const CSVReporter = require('../utils/csv-reporter');
const FlagParser = require('../utils/flag-parser');
const config = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class DataGapAnalyzer {
  constructor(options = {}) {
    this.options = {
      includeContacts: options.includeContacts !== false,
      includeCompanies: options.includeCompanies !== false,
      includeDeals: options.includeDeals !== false,
      ...options
    };
    
    this.hubspotAPI = new HubSpotAPI({
      cache: options.cache,
      flushCache: options.flushCache,
      cacheTtl: options.cacheTtl,
      cacheDir: options.cacheDir
    });
    
    this.activeCampaignAPI = new ActiveCampaignAPI({
      cache: options.cache,
      flushCache: options.flushCache,
      cacheTtl: options.cacheTtl,
      cacheDir: options.cacheDir
    });
    
    this.csvReporter = new CSVReporter();
    
    this.hubspotContacts = [];
    this.hubspotCompanies = [];
    this.hubspotDeals = [];
    this.acContacts = [];
    this.acDeals = [];
    this.gaps = {
      contacts: {
        missingInHubSpot: [],
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

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getHubSpotContacts() {
    if (!this.options.includeContacts) return [];
    this.hubspotContacts = await this.hubspotAPI.getAllContacts();
    return this.hubspotContacts;
  }

  async getHubSpotCompanies() {
    if (!this.options.includeCompanies) return [];
    this.hubspotCompanies = await this.hubspotAPI.getAllCompanies();
    return this.hubspotCompanies;
  }

  async getHubSpotDeals() {
    if (!this.options.includeDeals) return [];
    this.hubspotDeals = await this.hubspotAPI.getAllDeals();
    return this.hubspotDeals;
  }

  async getActiveCampaignDeals() {
    this.acDeals = await this.activeCampaignAPI.getAllDeals();
    return this.acDeals;
  }

  async getActiveCampaignContacts() {
    this.acContacts = await this.activeCampaignAPI.getAllContacts();
    return this.acContacts;
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
        this.gaps.contacts.missingInHubSpot.push({
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
    
    logger.info(`Found ${this.gaps.contacts.missingInHubSpot.length} contacts missing in HubSpot`);
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
          missingInHubSpot: this.gaps.contacts.missingInHubSpot.length,
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
    
    if (this.gaps.contacts.missingInHubSpot.length > 0) {
      recommendations.push({
        type: 'missing_contacts',
        priority: 'high',
        message: `${this.gaps.contacts.missingInHubSpot.length} contacts exist in ActiveCampaign but not in HubSpot`,
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
    if (this.gaps.companies.emptyFields && Array.isArray(this.gaps.companies.emptyFields)) {
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
    if (this.gaps.deals.emptyFields && Array.isArray(this.gaps.deals.emptyFields)) {
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
- Missing in HubSpot: ${report.summary.contactGaps.missingInHubSpot}
- Missing in ActiveCampaign: ${report.summary.contactGaps.missingInActiveCampaign}
- Field Mismatches: ${report.summary.contactGaps.fieldMismatches}

CONTACT EMPTY FIELD ANALYSIS:
${this.gaps.contacts.emptyFields.map(field => 
  `- ${field.field}: ${field.count} contacts (${field.percentage}%) missing data`
).join('\n')}

COMPANY EMPTY FIELD ANALYSIS:
${this.gaps.companies.emptyFields && Array.isArray(this.gaps.companies.emptyFields) ? this.gaps.companies.emptyFields.map(field => 
  `- ${field.field}: ${field.count} companies (${field.percentage}%) missing data`
).join('\n') : 'No company data available (free tier limitation)'}

DEAL EMPTY FIELD ANALYSIS:
${this.gaps.deals.emptyFields && Array.isArray(this.gaps.deals.emptyFields) ? this.gaps.deals.emptyFields.map(field => 
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
}

// Run the gap analysis
async function runGapAnalysis() {
  const flagParser = new FlagParser();
  const options = flagParser.parse();
  
  if (options.help) {
    flagParser.showHelp('scripts/data-gap-analyzer.js', 'HubSpot Data Gap Analyzer');
    return;
  }

  const analyzer = new DataGapAnalyzer(options);
  
  // Handle cache operations
  if (options.flushCache) {
    analyzer.hubspotAPI.clearCache();
    analyzer.activeCampaignAPI.clearCache();
    console.log('🗑️  Cache cleared. Fresh data will be fetched from APIs.');
  }
  
  if (options.cacheStats) {
    const hubspotStats = analyzer.hubspotAPI.getCacheStats();
    const acStats = analyzer.activeCampaignAPI.getCacheStats();
    
    console.log('📊 Cache Statistics:');
    console.log('   HubSpot Cache:');
    if (hubspotStats.enabled) {
      Object.entries(hubspotStats.objects || {}).forEach(([type, info]) => {
        console.log(`     ${type}: ${info.count} records (${info.age})`);
      });
    } else {
      console.log('     Disabled');
    }
    
    console.log('   ActiveCampaign Cache:');
    if (acStats.enabled) {
      Object.entries(acStats.objects || {}).forEach(([type, info]) => {
        console.log(`     ${type}: ${info.count} records (${info.age})`);
      });
    } else {
      console.log('     Disabled');
    }
    
    if (!options.flushCache) return;
  }

  flagParser.logFlags(options);
  
  try {
    logger.info('Starting data gap analysis...');
    
    // Fetch data based on flags
    await analyzer.getHubSpotContacts();
    await analyzer.getHubSpotCompanies();
    await analyzer.getHubSpotDeals();
    
    // Always fetch ActiveCampaign data for gap analysis
    await analyzer.getActiveCampaignContacts();
    await analyzer.getActiveCampaignDeals();
    
    // Analyze gaps
    analyzer.analyzeContactGaps();
    analyzer.analyzeFieldMismatches();
    analyzer.analyzeEmptyFields();
    
    const report = analyzer.generateGapReport();
    
    // Generate CSV report
    const csvFilename = `data-gap-report-${new Date().toISOString().split('T')[0]}.csv`;
    const csvRecords = await analyzer.csvReporter.writeGapReport(analyzer.gaps, csvFilename);
    
    logger.info('✅ Gap analysis complete!');
    console.log('\n✅ Gap analysis complete!');
    console.log('📁 Check reports/data-gap-analysis.json for full details');
    console.log('📄 Check reports/data-gap-summary.txt for summary');
    console.log(`📊 Check reports/${csvFilename} for actionable items (${csvRecords} records)`);
    
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
