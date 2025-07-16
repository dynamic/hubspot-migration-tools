const fs = require('fs');
const path = require('path');
const HubSpotAPI = require('../utils/hubspot-api');
const CSVReporter = require('../utils/csv-reporter');
const FlagParser = require('../utils/flag-parser');
const logger = require('../utils/logger');

class DuplicateAnalyzer {
  constructor(options = {}) {
    this.options = {
      includeContacts: options.includeContacts !== false,
      includeCompanies: options.includeCompanies !== false,
      includeDeals: options.includeDeals !== false,
      ...options
    };
    
    this.hubspotAPI = new HubSpotAPI({
      forceRefresh: options.flushCache,
      cache: true
    });
    this.csvReporter = new CSVReporter();
    
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
    this.contacts = await this.hubspotAPI.getAllContacts();
    return this.contacts;
  }

  async getAllCompanies() {
    this.companies = await this.hubspotAPI.getAllCompanies();
    return this.companies;
  }

  async getAllDeals() {
    this.deals = await this.hubspotAPI.getAllDeals();
    return this.deals;
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
    // Add HubSpot URLs to all duplicate records
    this.addHubSpotUrls();
    
    const csvFilename = `hubspot-duplicate-report-${new Date().toISOString().split('T')[0]}.csv`;
    const recordCount = await this.csvReporter.writeDuplicateReport(this.duplicates, csvFilename);
    
    logger.info(`CSV report generated: reports/${csvFilename}`);
    logger.info(`Total actionable items: ${recordCount}`);
    
    return csvFilename;
  }

  addHubSpotUrls() {
    // Add HubSpot URLs to all duplicate records
    Object.entries(this.duplicates).forEach(([objectType, categories]) => {
      if (categories && typeof categories === 'object') {
        Object.entries(categories).forEach(([category, items]) => {
          if (Array.isArray(items)) {
            items.forEach(item => {
              if (item && Array.isArray(item.records)) {
                item.records.forEach(record => {
                  if (record && record.id) {
                    record.hubspot_url = this.hubspotAPI.getRecordUrl(objectType, record.id);
                  }
                });
              }
            });
          }
        });
      }
    });
  }
}

// Parse command line arguments
// Run the analysis
async function runAnalysis() {
  const flagParser = new FlagParser();
  const options = flagParser.parse();
  
  if (options.help) {
    flagParser.showHelp('scripts/hubspot-duplicate-analyzer.js', 'HubSpot Duplicate Analyzer');
    return;
  }

  const analyzer = new DuplicateAnalyzer(options);
  
  // Handle cache operations
  if (options.flushCache) {
    analyzer.hubspotAPI.clearCache();
    console.log('🗑️  Cache cleared. Fresh data will be fetched from APIs.');
  }
  
  if (options.cacheStats) {
    const stats = analyzer.hubspotAPI.getCacheStats();
    console.log('📊 Cache Statistics:');
    console.log(`   Memory cache entries: ${stats.memoryCache}`);
    console.log(`   Disk cache files: ${stats.diskCache}`);
    console.log(`   Total cache size: ${stats.totalSizeMB} MB`);
    if (!options.flushCache) return;
  }

  flagParser.logFlags(options);
  
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
