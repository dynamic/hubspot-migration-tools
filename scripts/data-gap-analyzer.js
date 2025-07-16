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
      focusOnDeals: options.focusOnDeals || false,
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
        emptyFields: [],
        missingInHubSpot: [],
        missingInActiveCampaign: [],
        statusMismatches: [],
        dateMismatches: [],
        valueMismatches: [],
        migrationIssues: []
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

  filterMigrationDeals(deals) {
    const MIGRATION_DATE = '2025-07-16';
    return deals.filter(deal => {
      const closeDate = deal.properties.closedate;
      if (!closeDate) return false;
      
      const dealDate = new Date(closeDate).toISOString().split('T')[0];
      return dealDate === MIGRATION_DATE;
    });
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
        dealGaps: {
          missingInHubSpot: this.gaps.deals.missingInHubSpot.length,
          missingInActiveCampaign: this.gaps.deals.missingInActiveCampaign.length,
          statusMismatches: this.gaps.deals.statusMismatches.length,
          dateMismatches: this.gaps.deals.dateMismatches.length,
          valueMismatches: this.gaps.deals.valueMismatches.length,
          migrationIssues: this.gaps.deals.migrationIssues.length
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

    // Deal gap recommendations
    if (this.gaps.deals.missingInHubSpot.length > 0) {
      recommendations.push({
        type: 'missing_deals_in_hubspot',
        priority: 'high',
        message: `${this.gaps.deals.missingInHubSpot.length} deals exist in ActiveCampaign but not in HubSpot`,
        action: 'Review and import missing deals from ActiveCampaign to HubSpot'
      });
    }
    
    if (this.gaps.deals.statusMismatches.length > 0) {
      recommendations.push({
        type: 'deal_status_mismatches',
        priority: 'high',
        message: `${this.gaps.deals.statusMismatches.length} deals have different status between platforms`,
        action: 'Review deal statuses and update HubSpot to match ActiveCampaign or vice versa'
      });
    }
    
    if (this.gaps.deals.dateMismatches.length > 0) {
      recommendations.push({
        type: 'deal_date_mismatches',
        priority: 'medium',
        message: `${this.gaps.deals.dateMismatches.length} deals have different close dates between platforms`,
        action: 'Review and sync close dates between platforms'
      });
    }
    
    if (this.gaps.deals.valueMismatches.length > 0) {
      recommendations.push({
        type: 'deal_value_mismatches',
        priority: 'high',
        message: `${this.gaps.deals.valueMismatches.length} deals have different amounts between platforms`,
        action: 'Review and sync deal amounts between platforms'
      });
    }
    
    if (this.gaps.deals.migrationIssues.length > 0) {
      recommendations.push({
        type: 'migration_issues',
        priority: 'high',
        message: `${this.gaps.deals.migrationIssues.length} deals have potential migration data inconsistencies`,
        action: 'Review and fix migration issues such as missing close dates on closed deals'
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

DEAL GAPS:
- Missing in HubSpot: ${report.summary.dealGaps.missingInHubSpot}
- Missing in ActiveCampaign: ${report.summary.dealGaps.missingInActiveCampaign}
- Status Mismatches: ${report.summary.dealGaps.statusMismatches}
- Date Mismatches: ${report.summary.dealGaps.dateMismatches}
- Value Mismatches: ${report.summary.dealGaps.valueMismatches}
- Migration Issues: ${report.summary.dealGaps.migrationIssues}

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

  async analyzeData() {
    logger.info('Starting comprehensive data analysis...');
    
    // Filter deals for migration-only analysis if requested
    if (this.options.migrationDealsOnly) {
      logger.info('🎯 Filtering to migration deals only (close date = 2025-07-16)...');
      this.hubspotDeals = this.filterMigrationDeals(this.hubspotDeals);
      logger.info(`Found ${this.hubspotDeals.length} HubSpot deals with migration close date`);
    }
    
    // If focusing on deals, skip contact analysis
    if (this.options.focusDeals) {
      logger.info('🎯 Focusing on deals analysis only...');
      // Only analyze deals comprehensively
      if (this.options.includeDeals) {
        await this.analyzeDealsComprehensively();
      }
      
      // Only analyze deal empty fields
      if (this.hubspotDeals.length > 0) {
        this.analyzeDealEmptyFields();
      }
    } else {
      // Full analysis
      // Contact analysis
      if (this.options.includeContacts) {
        this.analyzeContactGaps();
      }
      
      // Deal analysis (enhanced for migration focus)
      if (this.options.includeDeals) {
        await this.analyzeDealsComprehensively();
      }
      
      // Empty field analysis
      this.analyzeEmptyFields();
    }
    
    logger.info('Data analysis complete');
  }

  async analyzeDealsComprehensively() {
    logger.info('🔍 Analyzing deals comprehensively between platforms...');
    
    // Create lookup maps for deal comparison
    const hubspotDealsByName = new Map();
    const acDealsByTitle = new Map();
    
    // Process HubSpot deals
    this.hubspotDeals.forEach(deal => {
      const name = deal.properties.dealname?.toLowerCase().trim();
      if (name) {
        if (!hubspotDealsByName.has(name)) {
          hubspotDealsByName.set(name, []);
        }
        hubspotDealsByName.get(name).push(deal);
      }
    });
    
    // Process ActiveCampaign deals
    this.acDeals.forEach(deal => {
      const title = deal.title?.toLowerCase().trim();
      if (title) {
        if (!acDealsByTitle.has(title)) {
          acDealsByTitle.set(title, []);
        }
        acDealsByTitle.get(title).push(deal);
      }
    });
    
    // Find missing deals
    this.findMissingDeals(hubspotDealsByName, acDealsByTitle);
    
    // Analyze deal mismatches
    this.analyzeDealMismatches(hubspotDealsByName, acDealsByTitle);
    
    // Analyze migration issues
    this.analyzeMigrationIssues();
    
    // Analyze close date issues for won/lost deals
    this.analyzeCloseDateIssues();
    
    logger.info(`✅ Deal analysis complete: ${this.acDeals.length} AC deals vs ${this.hubspotDeals.length} HubSpot deals`);
  }

  findMissingDeals(hubspotDealsByName, acDealsByTitle) {
    logger.info('🔍 Finding missing deals between platforms...');
    
    // Find deals in ActiveCampaign but not in HubSpot
    for (const [title, acDeals] of acDealsByTitle) {
      if (!hubspotDealsByName.has(title)) {
        // Deal exists in AC but not in HubSpot
        acDeals.forEach(deal => {
          this.gaps.deals.missingInHubSpot.push({
            id: deal.id,
            title: deal.title,
            value: deal.value,
            status: this.getACDealStatus(deal.status),
            stage: deal.stage,
            createdDate: deal.cdate,
            modifiedDate: deal.mdate,
            closeDate: deal.edate,
            organization: deal.organization,
            owner: deal.owner,
            migrationConcern: 'Deal exists in ActiveCampaign but not found in HubSpot'
          });
        });
      }
    }
    
    // Find deals in HubSpot but not in ActiveCampaign
    for (const [name, hubspotDeals] of hubspotDealsByName) {
      if (!acDealsByTitle.has(name)) {
        // Deal exists in HubSpot but not in AC
        hubspotDeals.forEach(deal => {
          this.gaps.deals.missingInActiveCampaign.push({
            id: deal.id,
            name: deal.properties.dealname,
            amount: deal.properties.amount,
            stage: deal.properties.dealstage,
            closeDate: deal.properties.closedate,
            createDate: deal.properties.createdate,
            pipeline: deal.properties.pipeline,
            migrationConcern: 'Deal exists in HubSpot but not found in ActiveCampaign'
          });
        });
      }
    }
    
    logger.info(`Found ${this.gaps.deals.missingInHubSpot.length} deals in AC but not in HubSpot`);
    logger.info(`Found ${this.gaps.deals.missingInActiveCampaign.length} deals in HubSpot but not in AC`);
  }

  analyzeDealMismatches(hubspotDealsByName, acDealsByTitle) {
    logger.info('🔍 Analyzing deal field mismatches...');
    
    for (const [name, hubspotDeals] of hubspotDealsByName) {
      const acDeals = acDealsByTitle.get(name);
      if (acDeals) {
        // We have matching deals, let's compare them
        hubspotDeals.forEach(hsDeal => {
          acDeals.forEach(acDeal => {
            this.compareDealFields(hsDeal, acDeal);
          });
        });
      }
    }
    
    logger.info(`Found ${this.gaps.deals.statusMismatches.length} status mismatches`);
    logger.info(`Found ${this.gaps.deals.dateMismatches.length} date mismatches`);
    logger.info(`Found ${this.gaps.deals.valueMismatches.length} value mismatches`);
  }

  compareDealFields(hsDeal, acDeal) {
    const comparison = {
      hubspotId: hsDeal.id,
      activeCampaignId: acDeal.id,
      dealName: hsDeal.properties.dealname,
      mismatches: []
    };
    
    // Compare status/stage
    const hsStatus = this.getHubSpotDealStatus(hsDeal.properties.dealstage);
    const acStatus = this.getACDealStatus(acDeal.status);
    
    if (hsStatus !== acStatus) {
      this.gaps.deals.statusMismatches.push({
        ...comparison,
        hubspotStatus: hsStatus,
        activeCampaignStatus: acStatus,
        hubspotStage: hsDeal.properties.dealstage,
        activeCampaignStage: acDeal.stage,
        concern: 'Deal status differs between platforms'
      });
    }
    
    // Compare values
    const hsAmount = parseFloat(hsDeal.properties.amount || '0');
    const acAmount = parseFloat(acDeal.value || '0') / 100; // AC stores in cents
    
    if (Math.abs(hsAmount - acAmount) > 0.01) {
      this.gaps.deals.valueMismatches.push({
        ...comparison,
        hubspotAmount: hsAmount,
        activeCampaignAmount: acAmount,
        difference: hsAmount - acAmount,
        concern: 'Deal amount differs between platforms'
      });
    }
    
    // Enhanced close date comparison - focus on won/lost deals
    this.analyzeCloseDateMismatch(hsDeal, acDeal, comparison);
  }

  analyzeCloseDateMismatch(hsDeal, acDeal, comparison) {
    const hsCloseDate = hsDeal.properties.closedate;
    const acCloseDate = acDeal.edate;
    const hsStatus = this.getHubSpotDealStatus(hsDeal.properties.dealstage);
    const acStatus = this.getACDealStatus(acDeal.status);
    
    // Migration date check - deals with this date need to be updated
    const MIGRATION_DATE = '2025-07-16';
    const isMigrationDate = hsCloseDate && new Date(hsCloseDate).toISOString().split('T')[0] === MIGRATION_DATE;
    
    // Only analyze close dates for won/lost deals
    if (hsStatus === 'won' || hsStatus === 'lost' || acStatus === 'won' || acStatus === 'lost') {
      
      // Case 1: AC has close date but HubSpot doesn't (common migration issue)
      if (acCloseDate && !hsCloseDate) {
        this.gaps.deals.dateMismatches.push({
          ...comparison,
          hubspotCloseDate: null,
          activeCampaignCloseDate: acCloseDate,
          correctCloseDate: acCloseDate,
          issueType: 'missing_close_date_in_hubspot',
          priority: 'HIGH',
          isMigrationDate: false,
          concern: 'HubSpot missing close date - should use ActiveCampaign date',
          recommendation: `Set HubSpot close date to ${new Date(acCloseDate).toLocaleDateString()}`
        });
      }
      
      // Case 2: HubSpot has migration date - needs to be updated to AC date
      else if (isMigrationDate && acCloseDate) {
        this.gaps.deals.dateMismatches.push({
          ...comparison,
          hubspotCloseDate: hsCloseDate,
          activeCampaignCloseDate: acCloseDate,
          correctCloseDate: acCloseDate,
          issueType: 'migration_date_needs_update',
          priority: 'HIGH',
          isMigrationDate: true,
          concern: 'HubSpot has migration date (7/15/2025) - should use ActiveCampaign date',
          recommendation: `Update HubSpot close date from migration date to ${new Date(acCloseDate).toLocaleDateString()}`
        });
      }
      
      // Case 3: Both have close dates but they differ (and not migration date)
      else if (hsCloseDate && acCloseDate && !isMigrationDate) {
        const hsDate = new Date(hsCloseDate);
        const acDate = new Date(acCloseDate);
        
        // Check if dates differ by more than 1 day
        if (Math.abs(hsDate.getTime() - acDate.getTime()) > 86400000) {
          const daysDifference = Math.round((hsDate.getTime() - acDate.getTime()) / 86400000);
          
          this.gaps.deals.dateMismatches.push({
            ...comparison,
            hubspotCloseDate: hsCloseDate,
            activeCampaignCloseDate: acCloseDate,
            correctCloseDate: acCloseDate,
            daysDifference: daysDifference,
            issueType: 'close_date_mismatch',
            priority: 'HIGH',
            isMigrationDate: false,
            concern: `Close dates differ by ${Math.abs(daysDifference)} days - should use ActiveCampaign date`,
            recommendation: `Update HubSpot close date from ${hsDate.toLocaleDateString()} to ${acDate.toLocaleDateString()}`
          });
        }
      }
      
      // Case 4: HubSpot has close date but AC doesn't (unusual but possible)
      else if (hsCloseDate && !acCloseDate && !isMigrationDate) {
        this.gaps.deals.dateMismatches.push({
          ...comparison,
          hubspotCloseDate: hsCloseDate,
          activeCampaignCloseDate: null,
          correctCloseDate: hsCloseDate,
          issueType: 'missing_close_date_in_ac',
          priority: 'MEDIUM',
          isMigrationDate: false,
          concern: 'ActiveCampaign missing close date - HubSpot has it',
          recommendation: `Review: HubSpot has close date ${new Date(hsCloseDate).toLocaleDateString()} but AC doesn't`
        });
      }
      
      // Case 5: Neither has close date but deal is won/lost (major issue)
      else if (!hsCloseDate && !acCloseDate && (hsStatus === 'won' || hsStatus === 'lost' || acStatus === 'won' || acStatus === 'lost')) {
        this.gaps.deals.dateMismatches.push({
          ...comparison,
          hubspotCloseDate: null,
          activeCampaignCloseDate: null,
          correctCloseDate: null,
          issueType: 'both_missing_close_date',
          priority: 'HIGH',
          isMigrationDate: false,
          concern: 'Won/Lost deal missing close date in both platforms',
          recommendation: 'Manual review required - determine actual close date'
        });
      }
    }
  }

  analyzeMigrationIssues() {
    logger.info('🔍 Analyzing potential migration issues...');
    
    // Check for deals with problematic statuses and close dates
    this.hubspotDeals.forEach(deal => {
      const issues = [];
      const dealStage = deal.properties.dealstage;
      const closeDate = deal.properties.closedate;
      const amount = deal.properties.amount;
      
      // Check for missing close dates on closed deals
      if ((dealStage === 'closedwon' || dealStage === 'closedlost') && !closeDate) {
        issues.push('Closed deal missing close date - migration issue');
      }
      
      // Check for missing amounts on won deals
      if (dealStage === 'closedwon' && (!amount || parseFloat(amount) === 0)) {
        issues.push('Won deal missing or zero amount');
      }
      
      // Check for inconsistent stage naming - open deals with close dates
      if (dealStage && !['closedwon', 'closedlost'].includes(dealStage)) {
        // This might be an open deal, check if it has a close date
        if (closeDate) {
          issues.push('Open deal has close date - possible migration issue');
        }
      }
      
      // Check for deals with "appointment" or "qualified" stage that might need close dates
      if (dealStage && (dealStage.includes('appointment') || dealStage.includes('qualified'))) {
        if (!closeDate) {
          // This might be OK for active deals, but flag for review
          issues.push('Active deal stage without close date - verify if correct');
        }
      }
      
      if (issues.length > 0) {
        this.gaps.deals.migrationIssues.push({
          hubspotId: deal.id,
          dealName: deal.properties.dealname,
          stage: dealStage,
          amount: amount,
          closeDate: closeDate,
          issues: issues,
          concern: 'Potential migration data inconsistency',
          needsCloseDateReview: issues.some(issue => issue.includes('close date'))
        });
      }
    });
    
    logger.info(`Found ${this.gaps.deals.migrationIssues.length} potential migration issues`);
  }

  getHubSpotDealStatus(stage) {
    if (!stage) return 'unknown';
    
    const lowerStage = stage.toLowerCase();
    if (lowerStage.includes('closedwon') || lowerStage.includes('won')) return 'won';
    if (lowerStage.includes('closedlost') || lowerStage.includes('lost')) return 'lost';
    return 'open';
  }

  getACDealStatus(status) {
    switch (status) {
      case '0': return 'open';
      case '1': return 'won';
      case '2': return 'lost';
      case '3': return 'open'; // in progress
      default: return 'unknown';
    }
  }

  analyzeMigrationIssues() {
    logger.info('🔍 Analyzing potential migration issues...');
    
    // Check for deals with problematic statuses and close dates
    this.hubspotDeals.forEach(deal => {
      const issues = [];
      const dealStage = deal.properties.dealstage;
      const closeDate = deal.properties.closedate;
      const amount = deal.properties.amount;
      
      // Check for missing close dates on closed deals
      if ((dealStage === 'closedwon' || dealStage === 'closedlost') && !closeDate) {
        issues.push('Closed deal missing close date - migration issue');
      }
      
      // Check for missing amounts on won deals
      if (dealStage === 'closedwon' && (!amount || parseFloat(amount) === 0)) {
        issues.push('Won deal missing or zero amount');
      }
      
      // Check for inconsistent stage naming - open deals with close dates
      if (dealStage && !['closedwon', 'closedlost'].includes(dealStage)) {
        // This might be an open deal, check if it has a close date
        if (closeDate) {
          issues.push('Open deal has close date - possible migration issue');
        }
      }
      
      // Check for deals with "appointment" or "qualified" stage that might need close dates
      if (dealStage && (dealStage.includes('appointment') || dealStage.includes('qualified'))) {
        if (!closeDate) {
          // This might be OK for active deals, but flag for review
          issues.push('Active deal stage without close date - verify if correct');
        }
      }
      
      if (issues.length > 0) {
        this.gaps.deals.migrationIssues.push({
          hubspotId: deal.id,
          dealName: deal.properties.dealname,
          stage: dealStage,
          amount: amount,
          closeDate: closeDate,
          issues: issues,
          concern: 'Potential migration data inconsistency',
          needsCloseDateReview: issues.some(issue => issue.includes('close date'))
        });
      }
    });
    
    logger.info(`Found ${this.gaps.deals.migrationIssues.length} potential migration issues`);
  }

  analyzeCloseDateIssues() {
    logger.info('🔍 Analyzing close date issues for won/lost deals...');
    
    // Find all HubSpot deals that are won/lost but missing close dates
    const wonLostDealsWithoutCloseDate = this.hubspotDeals.filter(deal => {
      const stage = deal.properties.dealstage;
      const closeDate = deal.properties.closedate;
      return (stage === 'closedwon' || stage === 'closedlost') && !closeDate;
    });
    
    // Try to find matching AC deals to get the close date
    wonLostDealsWithoutCloseDate.forEach(hsDeal => {
      const dealName = hsDeal.properties.dealname?.toLowerCase().trim();
      if (dealName) {
        const matchingAcDeals = this.acDeals.filter(acDeal => 
          acDeal.title?.toLowerCase().trim() === dealName
        );
        
        if (matchingAcDeals.length > 0) {
          const acDeal = matchingAcDeals[0]; // Take the first match
          if (acDeal.edate) {
            // Found a matching AC deal with a close date
            this.gaps.deals.dateMismatches.push({
              hubspotId: hsDeal.id,
              activeCampaignId: acDeal.id,
              dealName: hsDeal.properties.dealname,
              hubspotCloseDate: null,
              activeCampaignCloseDate: acDeal.edate,
              correctCloseDate: acDeal.edate,
              issueType: 'missing_close_date_in_hubspot',
              priority: 'HIGH',
              concern: 'Won/Lost deal missing close date in HubSpot - found in ActiveCampaign',
              recommendation: `Set HubSpot close date to ${new Date(acDeal.edate).toLocaleDateString()}`
            });
          }
        }
      }
    });
    
    logger.info(`Found ${wonLostDealsWithoutCloseDate.length} won/lost deals without close dates`);
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
    
    // Analyze gaps using new comprehensive method
    await analyzer.analyzeData();
    
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
