const hubspot = require('@hubspot/api-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const config = require('../config');
const logger = require('../utils/logger');

const hubspotClient = new hubspot.Client({
  accessToken: config.hubspot.accessToken
});

// Create axios instance for direct API calls
const apiClient = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: {
    'Authorization': `Bearer ${config.hubspot.accessToken}`,
    'Content-Type': 'application/json'
  }
});

class DuplicateAnalyzer {
  constructor(options = {}) {
    this.options = {
      includeContacts: options.includeContacts !== false,
      includeCompanies: options.includeCompanies !== false,
      includeDeals: options.includeDeals !== false,
      ...options
    };
    this.contacts = [];
    this.companies = [];
    this.deals = [];
    this.duplicates = {
      contacts: {
        byEmail: [],
        byPhone: [],
        byName: [],
        byCompany: []
      },
      companies: {
        byName: [],
        byDomain: []
      },
      deals: {
        byName: [],
        byCompanyAndName: []
      }
    };
  }

  async getAllContacts() {
    logger.info('Fetching all contacts from HubSpot...');
    let after = undefined;
    let allContacts = [];

    do {
      try {
        const params = {
          limit: 100,
          properties: [
            'email', 'firstname', 'lastname', 'phone', 'company',
            'createdate', 'lastmodifieddate', 'hs_object_id',
            'lifecyclestage', 'hubspotscore', 'jobtitle', 'website'
          ].join(',')
        };
        
        if (after) {
          params.after = after;
        }

        const response = await apiClient.get('/crm/v3/objects/contacts', { params });
        
        allContacts = allContacts.concat(response.data.results);
        after = response.data.paging?.next?.after;
        
        logger.info(`Fetched ${allContacts.length} contacts so far...`);
        
        // Rate limiting
        await this.delay(config.settings.apiRateLimitDelay);
        
      } catch (error) {
        logger.error('Error fetching contacts:', error.message);
        throw error;
      }
    } while (after);

    this.contacts = allContacts;
    logger.info(`Total contacts fetched: ${this.contacts.length}`);
    return allContacts;
  }

  async getAllCompanies() {
    logger.info('Fetching all companies from HubSpot...');
    let after = undefined;
    let allCompanies = [];

    do {
      try {
        const params = {
          limit: 100,
          properties: [
            'name', 'domain', 'website', 'phone', 'city', 'state',
            'createdate', 'lastmodifieddate', 'hs_object_id',
            'industry', 'numberofemployees', 'annualrevenue'
          ].join(',')
        };
        
        if (after) {
          params.after = after;
        }

        const response = await apiClient.get('/crm/v3/objects/companies', { params });
        
        allCompanies = allCompanies.concat(response.data.results);
        after = response.data.paging?.next?.after;
        
        logger.info(`Fetched ${allCompanies.length} companies so far...`);
        
        // Rate limiting
        await this.delay(config.settings.apiRateLimitDelay);
        
      } catch (error) {
        logger.error('Error fetching companies:', error.message);
        // On free tier, companies might not be available
        if (error.response?.status === 403 || error.response?.status === 402) {
          logger.warn('Companies API not available (likely free tier limitation)');
          return [];
        }
        throw error;
      }
    } while (after);

    this.companies = allCompanies;
    logger.info(`Total companies fetched: ${this.companies.length}`);
    return allCompanies;
  }

  async getAllDeals() {
    logger.info('Fetching all deals from HubSpot...');
    let after = undefined;
    let allDeals = [];

    do {
      try {
        const params = {
          limit: 100,
          properties: [
            'dealname', 'amount', 'dealstage', 'pipeline',
            'createdate', 'lastmodifieddate', 'hs_object_id',
            'closedate', 'dealtype', 'hubspot_owner_id'
          ].join(',')
        };
        
        if (after) {
          params.after = after;
        }

        const response = await apiClient.get('/crm/v3/objects/deals', { params });
        
        allDeals = allDeals.concat(response.data.results);
        after = response.data.paging?.next?.after;
        
        logger.info(`Fetched ${allDeals.length} deals so far...`);
        
        // Rate limiting
        await this.delay(config.settings.apiRateLimitDelay);
        
      } catch (error) {
        logger.error('Error fetching deals:', error.message);
        // On free tier, deals might not be available
        if (error.response?.status === 403 || error.response?.status === 402) {
          logger.warn('Deals API not available (likely free tier limitation)');
          return [];
        }
        throw error;
      }
    } while (after);

    this.deals = allDeals;
    logger.info(`Total deals fetched: ${this.deals.length}`);
    return allDeals;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  findDuplicatesByEmail() {
    logger.info('Analyzing contact email duplicates...');
    const emailGroups = {};
    
    this.contacts.forEach(contact => {
      const email = contact.properties.email?.toLowerCase().trim();
      if (email && email !== '') {
        if (!emailGroups[email]) {
          emailGroups[email] = [];
        }
        emailGroups[email].push(contact);
      }
    });

    // Find groups with multiple contacts
    Object.keys(emailGroups).forEach(email => {
      if (emailGroups[email].length > 1) {
        this.duplicates.contacts.byEmail.push({
          email: email,
          count: emailGroups[email].length,
          contacts: emailGroups[email].map(c => ({
            id: c.id,
            name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
            company: c.properties.company || '',
            createdate: c.properties.createdate,
            lifecyclestage: c.properties.lifecyclestage,
            hubspotscore: c.properties.hubspotscore
          }))
        });
      }
    });

    logger.info(`Found ${this.duplicates.contacts.byEmail.length} email duplicates`);
  }

  findDuplicatesByPhone() {
    logger.info('Analyzing contact phone duplicates...');
    const phoneGroups = {};
    
    this.contacts.forEach(contact => {
      let phone = contact.properties.phone?.replace(/\D/g, ''); // Remove non-digits
      if (phone && phone.length >= 10) {
        // Normalize to last 10 digits for US numbers
        phone = phone.slice(-10);
        if (!phoneGroups[phone]) {
          phoneGroups[phone] = [];
        }
        phoneGroups[phone].push(contact);
      }
    });

    Object.keys(phoneGroups).forEach(phone => {
      if (phoneGroups[phone].length > 1) {
        this.duplicates.contacts.byPhone.push({
          phone: phone,
          count: phoneGroups[phone].length,
          contacts: phoneGroups[phone].map(c => ({
            id: c.id,
            name: `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim(),
            email: c.properties.email || '',
            rawPhone: c.properties.phone,
            company: c.properties.company || ''
          }))
        });
      }
    });

    logger.info(`Found ${this.duplicates.contacts.byPhone.length} phone duplicates`);
  }

  findDuplicatesByName() {
    logger.info('Analyzing contact name duplicates...');
    const nameGroups = {};
    
    this.contacts.forEach(contact => {
      const firstName = contact.properties.firstname?.toLowerCase().trim() || '';
      const lastName = contact.properties.lastname?.toLowerCase().trim() || '';
      
      if (firstName && lastName) {
        const fullName = `${firstName} ${lastName}`;
        if (!nameGroups[fullName]) {
          nameGroups[fullName] = [];
        }
        nameGroups[fullName].push(contact);
      }
    });

    Object.keys(nameGroups).forEach(name => {
      if (nameGroups[name].length > 1) {
        this.duplicates.contacts.byName.push({
          name: name,
          count: nameGroups[name].length,
          contacts: nameGroups[name].map(c => ({
            id: c.id,
            email: c.properties.email || '',
            company: c.properties.company || '',
            phone: c.properties.phone || '',
            lifecyclestage: c.properties.lifecyclestage
          }))
        });
      }
    });

    logger.info(`Found ${this.duplicates.contacts.byName.length} name duplicates`);
  }

  findDuplicatesByCompanyAndName() {
    logger.info('Analyzing contact company + name duplicates...');
    const companyNameGroups = {};
    
    this.contacts.forEach(contact => {
      const firstName = contact.properties.firstname?.toLowerCase().trim() || '';
      const lastName = contact.properties.lastname?.toLowerCase().trim() || '';
      const company = contact.properties.company?.toLowerCase().trim() || '';
      
      if (firstName && lastName && company) {
        const key = `${company}|${firstName} ${lastName}`;
        if (!companyNameGroups[key]) {
          companyNameGroups[key] = [];
        }
        companyNameGroups[key].push(contact);
      }
    });

    Object.keys(companyNameGroups).forEach(key => {
      if (companyNameGroups[key].length > 1) {
        const [company, name] = key.split('|');
        this.duplicates.contacts.byCompany.push({
          company: company,
          name: name,
          count: companyNameGroups[key].length,
          contacts: companyNameGroups[key].map(c => ({
            id: c.id,
            email: c.properties.email || '',
            phone: c.properties.phone || '',
            jobtitle: c.properties.jobtitle || '',
            lifecyclestage: c.properties.lifecyclestage
          }))
        });
      }
    });

    logger.info(`Found ${this.duplicates.contacts.byCompany.length} company + name duplicates`);
  }

  findCompanyDuplicates() {
    if (this.companies.length === 0) {
      logger.info('No companies to analyze (likely free tier limitation)');
      return;
    }

    logger.info('Analyzing company duplicates...');
    
    // Duplicates by company name
    const nameGroups = {};
    this.companies.forEach(company => {
      const name = company.properties.name?.toLowerCase().trim();
      if (name && name !== '') {
        if (!nameGroups[name]) {
          nameGroups[name] = [];
        }
        nameGroups[name].push(company);
      }
    });

    Object.keys(nameGroups).forEach(name => {
      if (nameGroups[name].length > 1) {
        this.duplicates.companies.byName.push({
          name: name,
          count: nameGroups[name].length,
          companies: nameGroups[name].map(c => ({
            id: c.id,
            domain: c.properties.domain || '',
            website: c.properties.website || '',
            phone: c.properties.phone || '',
            city: c.properties.city || '',
            industry: c.properties.industry || ''
          }))
        });
      }
    });

    // Duplicates by domain
    const domainGroups = {};
    this.companies.forEach(company => {
      const domain = company.properties.domain?.toLowerCase().trim();
      if (domain && domain !== '') {
        if (!domainGroups[domain]) {
          domainGroups[domain] = [];
        }
        domainGroups[domain].push(company);
      }
    });

    Object.keys(domainGroups).forEach(domain => {
      if (domainGroups[domain].length > 1) {
        this.duplicates.companies.byDomain.push({
          domain: domain,
          count: domainGroups[domain].length,
          companies: domainGroups[domain].map(c => ({
            id: c.id,
            name: c.properties.name || '',
            website: c.properties.website || '',
            phone: c.properties.phone || '',
            city: c.properties.city || ''
          }))
        });
      }
    });

    logger.info(`Found ${this.duplicates.companies.byName.length} company name duplicates`);
    logger.info(`Found ${this.duplicates.companies.byDomain.length} company domain duplicates`);
  }

  findDealDuplicates() {
    if (this.deals.length === 0) {
      logger.info('No deals to analyze (likely free tier limitation)');
      return;
    }

    logger.info('Analyzing deal duplicates...');
    
    // Duplicates by deal name
    const nameGroups = {};
    this.deals.forEach(deal => {
      const name = deal.properties.dealname?.toLowerCase().trim();
      if (name && name !== '') {
        if (!nameGroups[name]) {
          nameGroups[name] = [];
        }
        nameGroups[name].push(deal);
      }
    });

    Object.keys(nameGroups).forEach(name => {
      if (nameGroups[name].length > 1) {
        this.duplicates.deals.byName.push({
          name: name,
          count: nameGroups[name].length,
          deals: nameGroups[name].map(d => ({
            id: d.id,
            amount: d.properties.amount || '',
            dealstage: d.properties.dealstage || '',
            pipeline: d.properties.pipeline || '',
            closedate: d.properties.closedate || '',
            createdate: d.properties.createdate || ''
          }))
        });
      }
    });

    logger.info(`Found ${this.duplicates.deals.byName.length} deal name duplicates`);
  }

  generateReport() {
    const report = {
      summary: {
        totalContacts: this.contacts.length,
        totalCompanies: this.companies.length,
        totalDeals: this.deals.length,
        contactDuplicates: {
          byEmail: this.duplicates.contacts.byEmail.length,
          byPhone: this.duplicates.contacts.byPhone.length,
          byName: this.duplicates.contacts.byName.length,
          byCompany: this.duplicates.contacts.byCompany.length
        },
        companyDuplicates: {
          byName: this.duplicates.companies.byName.length,
          byDomain: this.duplicates.companies.byDomain.length
        },
        dealDuplicates: {
          byName: this.duplicates.deals.byName.length
        },
        analyzedAt: new Date().toISOString()
      },
      duplicates: this.duplicates,
      recommendations: this.generateRecommendations()
    };

    // Ensure reports directory exists
    if (!fs.existsSync('reports')) {
      fs.mkdirSync('reports', { recursive: true });
    }

    // Save detailed report
    const reportPath = path.join('reports', 'hubspot-duplicate-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    // Generate readable summary
    this.generateSummaryReport(report);
    
    logger.info(`Report saved to ${reportPath}`);
    return report;
  }

  generateRecommendations() {
    const recommendations = [];
    
    // Contact recommendations
    if (this.duplicates.contacts.byEmail.length > 0) {
      recommendations.push({
        type: 'contact_email',
        priority: 'high',
        message: `${this.duplicates.contacts.byEmail.length} contact email duplicates found. These should be merged as they likely represent the same person.`,
        action: 'Review and merge contacts with identical email addresses'
      });
    }

    if (this.duplicates.contacts.byPhone.length > 0) {
      recommendations.push({
        type: 'contact_phone',
        priority: 'medium',
        message: `${this.duplicates.contacts.byPhone.length} contact phone duplicates found. Review these as they may be family members or colleagues.`,
        action: 'Manually review phone duplicates before merging'
      });
    }

    if (this.duplicates.contacts.byName.length > 10) {
      recommendations.push({
        type: 'contact_name',
        priority: 'low',
        message: `${this.duplicates.contacts.byName.length} contact name duplicates found. Common names may not be true duplicates.`,
        action: 'Cross-reference with email/phone/company data before merging'
      });
    }

    if (this.duplicates.contacts.byCompany.length > 0) {
      recommendations.push({
        type: 'contact_company',
        priority: 'medium',
        message: `${this.duplicates.contacts.byCompany.length} contact company + name duplicates found. These are likely true duplicates.`,
        action: 'High confidence merges - review job titles for accuracy'
      });
    }

    // Company recommendations
    if (this.duplicates.companies.byDomain.length > 0) {
      recommendations.push({
        type: 'company_domain',
        priority: 'high',
        message: `${this.duplicates.companies.byDomain.length} company domain duplicates found. Same domain = same company.`,
        action: 'Merge companies with identical domains immediately'
      });
    }

    if (this.duplicates.companies.byName.length > 0) {
      recommendations.push({
        type: 'company_name',
        priority: 'medium',
        message: `${this.duplicates.companies.byName.length} company name duplicates found. May include variations of the same company.`,
        action: 'Review company names for variations (Inc, LLC, Corp, etc.)'
      });
    }

    // Deal recommendations
    if (this.duplicates.deals.byName.length > 0) {
      recommendations.push({
        type: 'deal_name',
        priority: 'medium',
        message: `${this.duplicates.deals.byName.length} deal name duplicates found. May be duplicate opportunities.`,
        action: 'Review deal stages and amounts - merge if same opportunity'
      });
    }

    // Free tier limitations
    if (this.companies.length === 0) {
      recommendations.push({
        type: 'free_tier',
        priority: 'info',
        message: 'Company data not available (HubSpot Free tier limitation)',
        action: 'Consider upgrading to access company and deal management features'
      });
    }

    if (this.deals.length === 0) {
      recommendations.push({
        type: 'free_tier',
        priority: 'info',
        message: 'Deal data not available (HubSpot Free tier limitation)',
        action: 'Consider upgrading to access deal pipeline management'
      });
    }

    return recommendations;
  }

  generateSummaryReport(report) {
    const summary = `
HUBSPOT DUPLICATE ANALYSIS REPORT
=================================
Generated: ${new Date().toLocaleString()}

SUMMARY:
- Total Contacts: ${report.summary.totalContacts.toLocaleString()}
- Total Companies: ${report.summary.totalCompanies.toLocaleString()}
- Total Deals: ${report.summary.totalDeals.toLocaleString()}

CONTACT DUPLICATES:
- Email Duplicates: ${report.summary.contactDuplicates.byEmail}
- Phone Duplicates: ${report.summary.contactDuplicates.byPhone}
- Name Duplicates: ${report.summary.contactDuplicates.byName}
- Company + Name Duplicates: ${report.summary.contactDuplicates.byCompany}

COMPANY DUPLICATES:
- Name Duplicates: ${report.summary.companyDuplicates.byName}
- Domain Duplicates: ${report.summary.companyDuplicates.byDomain}

DEAL DUPLICATES:
- Name Duplicates: ${report.summary.dealDuplicates.byName}

TOP CONTACT EMAIL DUPLICATES:
${this.duplicates.contacts.byEmail.slice(0, 10).map((dup, index) => 
  `${index + 1}. ${dup.email} (${dup.count} contacts)`
).join('\n') || 'None found'}

TOP CONTACT PHONE DUPLICATES:
${this.duplicates.contacts.byPhone.slice(0, 5).map((dup, index) => 
  `${index + 1}. ${dup.phone} (${dup.count} contacts)`
).join('\n') || 'None found'}

TOP COMPANY DOMAIN DUPLICATES:
${this.duplicates.companies.byDomain.slice(0, 5).map((dup, index) => 
  `${index + 1}. ${dup.domain} (${dup.count} companies)`
).join('\n') || 'None found (may be free tier limitation)'}

RECOMMENDATIONS:
${report.recommendations.map((rec, index) => 
  `${index + 1}. [${rec.priority.toUpperCase()}] ${rec.message}\n   Action: ${rec.action}`
).join('\n\n')}

NEXT STEPS:
1. Review the detailed JSON report at reports/hubspot-duplicate-report.json
2. Start with HIGH priority duplicates (emails, company domains)
3. Use HubSpot's merge tool or create a merge script
4. Consider upgrading from free tier for company/deal management
5. Verify data integrity after merging

Full details saved to: reports/hubspot-duplicate-report.json
`;

    const summaryPath = path.join('reports', 'hubspot-duplicate-summary.txt');
    fs.writeFileSync(summaryPath, summary);
    console.log(summary);
    logger.info(`Summary saved to ${summaryPath}`);
  }

  async generateCSVReport() {
    const csvData = [];
    
    // Add contact duplicates
    if (this.options.includeContacts) {
      // Email duplicates
      this.duplicates.contacts.byEmail.forEach(duplicate => {
        duplicate.contacts.forEach((contact, index) => {
          if (index > 0) { // Skip first as it's the "primary"
            csvData.push({
              issue_type: 'Contact Email Duplicate',
              priority: 'HIGH',
              object_type: 'Contact',
              record_id: contact.id,
              record_name: contact.name,
              duplicate_value: duplicate.email,
              hubspot_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${contact.id}`,
              primary_record_id: duplicate.contacts[0].id,
              primary_record_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${duplicate.contacts[0].id}`,
              action_needed: 'Merge records - same email address'
            });
          }
        });
      });

      // Phone duplicates  
      this.duplicates.contacts.byPhone.forEach(duplicate => {
        duplicate.contacts.forEach((contact, index) => {
          if (index > 0) {
            csvData.push({
              issue_type: 'Contact Phone Duplicate',
              priority: 'MEDIUM',
              object_type: 'Contact',
              record_id: contact.id,
              record_name: contact.name,
              duplicate_value: contact.rawPhone,
              hubspot_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${contact.id}`,
              primary_record_id: duplicate.contacts[0].id,
              primary_record_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${duplicate.contacts[0].id}`,
              action_needed: 'Review - may be family members or colleagues'
            });
          }
        });
      });

      // Name duplicates
      this.duplicates.contacts.byName.forEach(duplicate => {
        duplicate.contacts.forEach((contact, index) => {
          if (index > 0) {
            csvData.push({
              issue_type: 'Contact Name Duplicate',
              priority: 'LOW',
              object_type: 'Contact',
              record_id: contact.id,
              record_name: contact.name,
              duplicate_value: duplicate.name,
              hubspot_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${contact.id}`,
              primary_record_id: duplicate.contacts[0].id,
              primary_record_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${duplicate.contacts[0].id}`,
              action_needed: 'Cross-reference with email/phone/company before merging'
            });
          }
        });
      });

      // Company + Name duplicates
      this.duplicates.contacts.byCompany.forEach(duplicate => {
        duplicate.contacts.forEach((contact, index) => {
          if (index > 0) {
            csvData.push({
              issue_type: 'Contact Company+Name Duplicate',
              priority: 'MEDIUM',
              object_type: 'Contact',
              record_id: contact.id,
              record_name: contact.name,
              duplicate_value: `${duplicate.company} | ${duplicate.name}`,
              hubspot_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${contact.id}`,
              primary_record_id: duplicate.contacts[0].id,
              primary_record_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/contact/${duplicate.contacts[0].id}`,
              action_needed: 'High confidence merge - review job titles for accuracy'
            });
          }
        });
      });
    }

    // Add company duplicates
    if (this.options.includeCompanies) {
      // Company name duplicates
      this.duplicates.companies.byName.forEach(duplicate => {
        duplicate.companies.forEach((company, index) => {
          if (index > 0) {
            csvData.push({
              issue_type: 'Company Name Duplicate',
              priority: 'MEDIUM',
              object_type: 'Company',
              record_id: company.id,
              record_name: company.name,
              duplicate_value: duplicate.name,
              hubspot_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/company/${company.id}`,
              primary_record_id: duplicate.companies[0].id,
              primary_record_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/company/${duplicate.companies[0].id}`,
              action_needed: 'Review for variations (Inc, LLC, Corp, etc.)'
            });
          }
        });
      });

      // Company domain duplicates
      this.duplicates.companies.byDomain.forEach(duplicate => {
        duplicate.companies.forEach((company, index) => {
          if (index > 0) {
            csvData.push({
              issue_type: 'Company Domain Duplicate',
              priority: 'HIGH',
              object_type: 'Company',
              record_id: company.id,
              record_name: company.name,
              duplicate_value: duplicate.domain,
              hubspot_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/company/${company.id}`,
              primary_record_id: duplicate.companies[0].id,
              primary_record_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/company/${duplicate.companies[0].id}`,
              action_needed: 'Merge immediately - same domain = same company'
            });
          }
        });
      });
    }

    // Add deal duplicates
    if (this.options.includeDeals) {
      // Deal name duplicates
      this.duplicates.deals.byName.forEach(duplicate => {
        duplicate.deals.forEach((deal, index) => {
          if (index > 0) {
            csvData.push({
              issue_type: 'Deal Name Duplicate',
              priority: 'MEDIUM',
              object_type: 'Deal',
              record_id: deal.id,
              record_name: deal.name,
              duplicate_value: duplicate.name,
              hubspot_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/deal/${deal.id}`,
              primary_record_id: duplicate.deals[0].id,
              primary_record_url: `https://app.hubspot.com/contacts/${config.hubspot.portalId}/deal/${duplicate.deals[0].id}`,
              action_needed: 'Review deal stages and amounts - merge if same opportunity'
            });
          }
        });
      });
    }

    // Write CSV file
    if (csvData.length > 0) {
      const csvPath = path.join(__dirname, '../reports/hubspot-duplicate-issues.csv');
      const csvWriter = createCsvWriter({
        path: csvPath,
        header: [
          { id: 'issue_type', title: 'Issue Type' },
          { id: 'priority', title: 'Priority' },
          { id: 'object_type', title: 'Object Type' },
          { id: 'record_id', title: 'Record ID' },
          { id: 'record_name', title: 'Record Name' },
          { id: 'duplicate_value', title: 'Duplicate Value' },
          { id: 'hubspot_url', title: 'HubSpot URL' },
          { id: 'primary_record_id', title: 'Primary Record ID' },
          { id: 'primary_record_url', title: 'Primary Record URL' },
          { id: 'action_needed', title: 'Action Needed' }
        ]
      });

      await csvWriter.writeRecords(csvData);
      logger.info(`CSV report saved to ${csvPath}`);
      console.log(`📊 CSV report saved to ${csvPath}`);
    } else {
      logger.info('No duplicates found - no CSV file generated');
      console.log('📊 No duplicates found - no CSV file generated');
    }

    return csvData;
  }
}

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    includeContacts: true,
    includeCompanies: true,
    includeDeals: true,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--contacts-only':
        options.includeContacts = true;
        options.includeCompanies = false;
        options.includeDeals = false;
        break;
      case '--companies-only':
        options.includeContacts = false;
        options.includeCompanies = true;
        options.includeDeals = false;
        break;
      case '--deals-only':
        options.includeContacts = false;
        options.includeCompanies = false;
        options.includeDeals = true;
        break;
      case '--no-contacts':
        options.includeContacts = false;
        break;
      case '--no-companies':
        options.includeCompanies = false;
        break;
      case '--no-deals':
        options.includeDeals = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.log(`Unknown argument: ${arg}`);
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
HubSpot Duplicate Analyzer
==========================

Usage: node scripts/hubspot-duplicate-analyzer.js [options]

Options:
  --contacts-only     Analyze only contacts (skip companies and deals)
  --companies-only    Analyze only companies (skip contacts and deals)
  --deals-only        Analyze only deals (skip contacts and companies)
  --no-contacts       Skip contact analysis
  --no-companies      Skip company analysis
  --no-deals          Skip deal analysis
  --help, -h          Show this help message

Examples:
  node scripts/hubspot-duplicate-analyzer.js                    # Analyze all objects
  node scripts/hubspot-duplicate-analyzer.js --contacts-only    # Only contacts
  node scripts/hubspot-duplicate-analyzer.js --no-deals         # Skip deals
  
The script is READ-ONLY and will not modify any data in HubSpot.
It generates:
  - JSON report: reports/hubspot-duplicate-report.json
  - Text summary: reports/hubspot-duplicate-summary.txt
  - CSV with links: reports/hubspot-duplicate-issues.csv
`);
}

// Run the analysis
async function runAnalysis() {
  const options = parseArguments();
  
  if (options.help) {
    showHelp();
    return;
  }

  const analyzer = new DuplicateAnalyzer(options);
  
  try {
    logger.info('Starting HubSpot duplicate analysis...');
    
    // Fetch data based on options
    if (options.includeContacts) {
      await analyzer.getAllContacts();
    }
    if (options.includeCompanies) {
      await analyzer.getAllCompanies();
    }
    if (options.includeDeals) {
      await analyzer.getAllDeals();
    }
    
    // Analyze duplicates based on options
    if (options.includeContacts) {
      analyzer.findDuplicatesByEmail();
      analyzer.findDuplicatesByPhone();
      analyzer.findDuplicatesByName();
      analyzer.findDuplicatesByCompanyAndName();
    }
    if (options.includeCompanies) {
      analyzer.findCompanyDuplicates();
    }
    if (options.includeDeals) {
      analyzer.findDealDuplicates();
    }
    
    const report = analyzer.generateReport();
    await analyzer.generateCSVReport();
    
    logger.info('✅ Analysis complete!');
    console.log('\n✅ Analysis complete!');
    console.log('📁 Check reports/hubspot-duplicate-report.json for full details');
    console.log('📄 Check reports/hubspot-duplicate-summary.txt for summary');
    console.log('📊 Check reports/hubspot-duplicate-issues.csv for actionable items');
    
    return report;
    
  } catch (error) {
    logger.error('❌ Error during analysis:', error.message);
    console.error('❌ Error during analysis:', error.message);
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = DuplicateAnalyzer;

// Run if called directly
if (require.main === module) {
  runAnalysis();
}
