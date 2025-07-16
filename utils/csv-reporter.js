const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const logger = require('./logger');

class CSVReporter {
  constructor() {
    this.reportsDir = path.join(__dirname, '..', 'reports');
    this.ensureReportsDir();
  }

  // Helper function to provide default fields for CSV consistency
  getDefaultFields() {
    return {
      hubspot_close_date: null,
      activecampaign_close_date: null,
      correct_close_date: null,
      days_difference: null
    };
  }

  ensureReportsDir() {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  async writeDuplicateReport(duplicates, filename) {
    const csvData = [];
    
    // Process all duplicate categories
    Object.entries(duplicates).forEach(([objectType, categories]) => {
      Object.entries(categories).forEach(([category, items]) => {
        if (Array.isArray(items)) {
          items.forEach(item => {
            let identifier, records, priority = 'MEDIUM';
            
            // Handle different duplicate structures
            if (item.email) {
              identifier = item.email;
              records = item.contacts || [];
              priority = 'HIGH';
            } else if (item.phone) {
              identifier = item.phone;
              records = item.contacts || [];
              priority = 'MEDIUM';
            } else if (item.name) {
              identifier = item.name;
              records = item.contacts || [];
              priority = 'LOW';
            } else if (item.domain) {
              identifier = item.domain;
              records = item.companies || [];
              priority = 'HIGH';
            } else if (item.company) {
              identifier = item.company;
              records = item.companies || [];
              priority = 'MEDIUM';
            } else if (item.deal) {
              identifier = item.deal;
              records = item.deals || [];
              priority = 'MEDIUM';
            } else if (item.identifier) {
              identifier = item.identifier;
              records = item.records || [];
              priority = item.priority || 'MEDIUM';
            } else {
              // Skip unknown structures
              return;
            }

            csvData.push({
              object_type: objectType,
              duplicate_type: category,
              priority: priority,
              identifier: identifier,
              count: item.count || records.length,
              record_ids: records.map(r => r.id).join(', '),
              hubspot_links: records.map(r => r.hubspot_url || '').join(', '),
              details: item.details || ''
            });
          });
        }
      });
    });

    // Sort by priority (HIGH first) and count (descending)
    const priorityRank = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    csvData.sort((a, b) => {
      if (priorityRank[a.priority] !== priorityRank[b.priority]) {
        return priorityRank[b.priority] - priorityRank[a.priority];
      }
      return b.count - a.count;
    });

    const csvWriter = createCsvWriter({
      path: path.join(this.reportsDir, filename),
      header: [
        { id: 'object_type', title: 'Object Type' },
        { id: 'duplicate_type', title: 'Duplicate Type' },
        { id: 'priority', title: 'Priority' },
        { id: 'identifier', title: 'Identifier' },
        { id: 'count', title: 'Count' },
        { id: 'record_ids', title: 'Record IDs' },
        { id: 'hubspot_links', title: 'HubSpot Links' },
        { id: 'details', title: 'Details' }
      ]
    });

    await csvWriter.writeRecords(csvData);
    logger.info(`Duplicate report written to ${filename}`);
    return csvData.length;
  }

  async writeGapReport(gaps, filename) {
    const csvData = [];
    
    // Process missing contacts
    gaps.contacts.missingInHubSpot.forEach(contact => {
      csvData.push({
        gap_type: 'missing_in_hubspot',
        object_type: 'contact',
        priority: 'HIGH',
        identifier: contact.email,
        ...this.getDefaultFields(),
        details: `Name: ${contact.firstName || ''} ${contact.lastName || ''}`,
        action: 'Import to HubSpot'
      });
    });

    gaps.contacts.missingInActiveCampaign.forEach(contact => {
      csvData.push({
        gap_type: 'missing_in_activecampaign',
        object_type: 'contact',
        priority: 'LOW',
        identifier: contact.email,
        ...this.getDefaultFields(),
        details: `Name: ${contact.firstName || ''} ${contact.lastName || ''}`,
        action: 'Import to ActiveCampaign'
      });
    });

    // Process field mismatches
    gaps.contacts.fieldMismatches.forEach(mismatch => {
      csvData.push({
        gap_type: 'field_mismatch',
        object_type: 'contact',
        priority: 'MEDIUM',
        identifier: mismatch.email,
        ...this.getDefaultFields(),
        details: `${mismatch.mismatches.length} field(s) different: ${mismatch.mismatches.map(d => d.field).join(', ')}`,
        action: 'Review and update'
      });
    });

    // Process empty field analysis
    gaps.contacts.emptyFields.forEach(fieldData => {
      if (fieldData.count > 0) {
        const priority = fieldData.percentage > 50 ? 'HIGH' : 'MEDIUM';
        csvData.push({
          gap_type: 'empty_field',
          object_type: 'contact',
          priority,
          identifier: fieldData.field,
          ...this.getDefaultFields(),
          details: `${fieldData.count} contacts (${fieldData.percentage}%) missing ${fieldData.field}`,
          action: `Populate ${fieldData.field} from ActiveCampaign or external sources`
        });
      }
    });

    // Process company empty fields
    if (gaps.companies && gaps.companies.emptyFields) {
      gaps.companies.emptyFields.forEach(fieldData => {
        if (fieldData.count > 0) {
          const priority = fieldData.percentage > 50 ? 'HIGH' : 'MEDIUM';
          csvData.push({
            gap_type: 'empty_field',
            object_type: 'company',
            priority,
            identifier: fieldData.field,
            hubspot_close_date: null,
            activecampaign_close_date: null,
            correct_close_date: null,
            days_difference: null,
            details: `${fieldData.count} companies (${fieldData.percentage}%) missing ${fieldData.field}`,
            action: `Populate ${fieldData.field} from external sources`
          });
        }
      });
    }

    // Process deal empty fields
    if (gaps.deals && gaps.deals.emptyFields) {
      gaps.deals.emptyFields.forEach(fieldData => {
        if (fieldData.count > 0) {
          const priority = fieldData.percentage > 50 ? 'HIGH' : 'MEDIUM';
          csvData.push({
            gap_type: 'empty_field',
            object_type: 'deal',
            priority,
            identifier: fieldData.field,
            hubspot_close_date: null,
            activecampaign_close_date: null,
            correct_close_date: null,
            days_difference: null,
            details: `${fieldData.count} deals (${fieldData.percentage}%) missing ${fieldData.field}`,
            action: `Populate ${fieldData.field} for better pipeline management`
          });
        }
      });
    }

    // Process deal-specific gaps
    if (gaps.deals) {
      // Missing deals in HubSpot
      if (gaps.deals.missingInHubSpot) {
        gaps.deals.missingInHubSpot.forEach(deal => {
          csvData.push({
            gap_type: 'missing_in_hubspot',
            object_type: 'deal',
            priority: 'HIGH',
            identifier: deal.title,
            hubspot_close_date: null,
            activecampaign_close_date: deal.closeDate ? new Date(deal.closeDate).toLocaleDateString() : null,
            correct_close_date: null,
            days_difference: null,
            details: `Value: $${(deal.value / 100).toFixed(2)}, Status: ${deal.status}, AC ID: ${deal.id}`,
            action: 'Import deal from ActiveCampaign to HubSpot'
          });
        });
      }

      // Missing deals in ActiveCampaign
      if (gaps.deals.missingInActiveCampaign) {
        gaps.deals.missingInActiveCampaign.forEach(deal => {
          csvData.push({
            gap_type: 'missing_in_activecampaign',
            object_type: 'deal',
            priority: 'LOW',
            identifier: deal.name,
            hubspot_close_date: deal.closeDate ? new Date(deal.closeDate).toLocaleDateString() : null,
            activecampaign_close_date: null,
            correct_close_date: null,
            days_difference: null,
            details: `Amount: $${deal.amount}, Stage: ${deal.stage}, HS ID: ${deal.id}`,
            action: 'Deal exists in HubSpot but not ActiveCampaign'
          });
        });
      }

      // Deal status mismatches
      if (gaps.deals.statusMismatches) {
        gaps.deals.statusMismatches.forEach(mismatch => {
          csvData.push({
            gap_type: 'status_mismatch',
            object_type: 'deal',
            priority: 'HIGH',
            identifier: mismatch.dealName,
            hubspot_close_date: null,
            activecampaign_close_date: null,
            correct_close_date: null,
            days_difference: null,
            details: `HubSpot: ${mismatch.hubspotStatus} vs ActiveCampaign: ${mismatch.activeCampaignStatus}`,
            action: 'Review and sync deal status between platforms'
          });
        });
      }

      // Deal value mismatches
      if (gaps.deals.valueMismatches) {
        gaps.deals.valueMismatches.forEach(mismatch => {
          csvData.push({
            gap_type: 'value_mismatch',
            object_type: 'deal',
            priority: 'HIGH',
            identifier: mismatch.dealName,
            hubspot_close_date: null,
            activecampaign_close_date: null,
            correct_close_date: null,
            days_difference: null,
            details: `HubSpot: $${mismatch.hubspotAmount} vs ActiveCampaign: $${mismatch.activeCampaignAmount} (diff: $${mismatch.difference})`,
            action: 'Review and sync deal amounts between platforms'
          });
        });
      }

      // Deal date mismatches
      if (gaps.deals.dateMismatches) {
        gaps.deals.dateMismatches.forEach(mismatch => {
          const priority = mismatch.priority || 'HIGH';
          const hsDate = mismatch.hubspotCloseDate ? new Date(mismatch.hubspotCloseDate).toLocaleDateString() : null;
          const acDate = mismatch.activeCampaignCloseDate ? new Date(mismatch.activeCampaignCloseDate).toLocaleDateString() : null;
          const correctDate = mismatch.correctCloseDate ? new Date(mismatch.correctCloseDate).toLocaleDateString() : null;
          const daysDiff = mismatch.daysDifference ? Math.abs(mismatch.daysDifference) : null;
          
          let details = mismatch.concern || 'Close date mismatch';
          if (mismatch.isMigrationDate) {
            details += ' [MIGRATION DATE - NEEDS UPDATE]';
          }
          
          csvData.push({
            gap_type: 'close_date_issue',
            object_type: 'deal',
            priority: priority,
            identifier: mismatch.dealName,
            hubspot_close_date: hsDate,
            activecampaign_close_date: acDate,
            correct_close_date: correctDate,
            days_difference: daysDiff,
            details: details,
            action: mismatch.recommendation || 'Review and sync close dates between platforms'
          });
        });
      }

      // Migration issues
      if (gaps.deals.migrationIssues) {
        gaps.deals.migrationIssues.forEach(issue => {
          csvData.push({
            gap_type: 'migration_issue',
            object_type: 'deal',
            priority: 'HIGH',
            identifier: issue.dealName,
            hubspot_close_date: issue.closeDate ? new Date(issue.closeDate).toLocaleDateString() : null,
            activecampaign_close_date: null,
            correct_close_date: null,
            days_difference: null,
            details: `Issues: ${issue.issues.join(', ')}`,
            action: 'Fix migration data inconsistencies'
          });
        });
      }
    }

    // Sort by priority and impact
    const priorityRank = { 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    csvData.sort((a, b) => {
      if (a.priority !== b.priority) {
        return priorityRank[a.priority] - priorityRank[b.priority];
      }
      return a.gap_type === 'missing_in_hubspot' ? -1 : 1;
    });

    const csvWriter = createCsvWriter({
      path: path.join(this.reportsDir, filename),
      header: [
        { id: 'gap_type', title: 'Gap Type' },
        { id: 'object_type', title: 'Object Type' },
        { id: 'priority', title: 'Priority' },
        { id: 'identifier', title: 'Identifier' },
        { id: 'hubspot_close_date', title: 'HubSpot Close Date' },
        { id: 'activecampaign_close_date', title: 'ActiveCampaign Close Date' },
        { id: 'correct_close_date', title: 'Correct Close Date' },
        { id: 'days_difference', title: 'Days Difference' },
        { id: 'details', title: 'Details' },
        { id: 'action', title: 'Recommended Action' }
      ]
    });

    await csvWriter.writeRecords(csvData);
    logger.info(`Gap analysis report written to ${filename}`);
    return csvData.length;
  }

  async writeTextSummary(content, filename) {
    const filePath = path.join(this.reportsDir, filename);
    fs.writeFileSync(filePath, content);
    logger.info(`Summary written to ${filename}`);
  }

  async writeJsonReport(data, filename) {
    const filePath = path.join(this.reportsDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    logger.info(`JSON report written to ${filename}`);
  }
}

module.exports = CSVReporter;
