#!/usr/bin/env node

const ActiveCampaignAPI = require('../utils/activecampaign-api');
const logger = require('../utils/logger');

class CustomFieldsExplorer {
  constructor() {
    this.activeCampaign = new ActiveCampaignAPI();
  }

  async exploreCustomFields() {
    logger.info('Exploring ActiveCampaign custom fields structure...');
    
    try {
      // First, get the custom field metadata
      logger.info('Fetching custom field metadata...');
      const customFieldMeta = await this.activeCampaign.getDealCustomFields();
      
      if (customFieldMeta && customFieldMeta.length > 0) {
        logger.info(`Found ${customFieldMeta.length} custom field definitions:`);
        customFieldMeta.forEach(field => {
          logger.info(`  - ${field.fieldLabel} (${field.fieldType}): ${field.fieldKey}`);
        });
      } else {
        logger.info('No custom field definitions found');
      }
      
      // Get deals with custom fields
      const deals = await this.activeCampaign.getDealsWithCustomFields();
      logger.info(`Loaded ${deals.length} deals with custom fields from ActiveCampaign`);
      
      if (deals.length === 0) {
        logger.info('No deals found to analyze');
        return;
      }
      
      // Analyze the first few deals to understand custom fields structure
      const sampleSize = Math.min(5, deals.length);
      logger.info(`\nAnalyzing first ${sampleSize} deals for custom fields structure:`);
      
      for (let i = 0; i < sampleSize; i++) {
        const deal = deals[i];
        logger.info(`\n--- Deal ${i + 1}: ${deal.title} ---`);
        
        // Log the full deal structure (truncated for readability)
        const dealKeys = Object.keys(deal);
        logger.info(`Deal properties: ${dealKeys.join(', ')}`);
        
        // Check for custom fields in different locations
        if (deal.fields) {
          logger.info('Custom fields in deal.fields:');
          for (const [key, value] of Object.entries(deal.fields)) {
            logger.info(`  ${key}: ${value}`);
          }
        }
        
        if (deal.dealCustomFieldData) {
          logger.info('Custom fields in deal.dealCustomFieldData:');
          deal.dealCustomFieldData.forEach(field => {
            logger.info(`  ${field.fieldKey}: ${field.fieldValue} (${field.fieldLabel})`);
          });
        }
        
        // Check for any other properties that might contain custom data
        const customProps = dealKeys.filter(key => 
          key.startsWith('custom_') || 
          key.includes('field') || 
          key.includes('data')
        );
        
        if (customProps.length > 0) {
          logger.info('Other potential custom properties:');
          customProps.forEach(prop => {
            logger.info(`  ${prop}: ${typeof deal[prop] === 'object' ? JSON.stringify(deal[prop]) : deal[prop]}`);
          });
        }
      }
      
      // Look for patterns in all deals
      logger.info('\n--- Analyzing all deals for custom field patterns ---');
      const customFieldAnalysis = this.analyzeCustomFieldPatterns(deals);
      this.reportCustomFieldAnalysis(customFieldAnalysis);
      
    } catch (error) {
      logger.error(`Error exploring custom fields: ${error.message}`);
    }
  }

  analyzeCustomFieldPatterns(deals) {
    const patterns = {
      fieldsProperty: new Set(),
      dealCustomFieldData: new Set(),
      otherCustomProps: new Set()
    };
    
    deals.forEach(deal => {
      // Analyze deal.fields
      if (deal.fields) {
        Object.keys(deal.fields).forEach(key => patterns.fieldsProperty.add(key));
      }
      
      // Analyze deal.dealCustomFieldData
      if (deal.dealCustomFieldData) {
        deal.dealCustomFieldData.forEach(field => {
          patterns.dealCustomFieldData.add(field.fieldKey);
        });
      }
      
      // Look for other custom properties
      Object.keys(deal).forEach(key => {
        if (key.startsWith('custom_') || (key.includes('field') && key !== 'dealCustomFieldData')) {
          patterns.otherCustomProps.add(key);
        }
      });
    });
    
    return patterns;
  }

  reportCustomFieldAnalysis(patterns) {
    logger.info('\n=== CUSTOM FIELDS ANALYSIS ===');
    
    if (patterns.fieldsProperty.size > 0) {
      logger.info('\nFields found in deal.fields:');
      Array.from(patterns.fieldsProperty).forEach(field => {
        logger.info(`  - ${field}`);
      });
    }
    
    if (patterns.dealCustomFieldData.size > 0) {
      logger.info('\nFields found in deal.dealCustomFieldData:');
      Array.from(patterns.dealCustomFieldData).forEach(field => {
        logger.info(`  - ${field}`);
      });
    }
    
    if (patterns.otherCustomProps.size > 0) {
      logger.info('\nOther custom properties found:');
      Array.from(patterns.otherCustomProps).forEach(prop => {
        logger.info(`  - ${prop}`);
      });
    }
    
    if (patterns.fieldsProperty.size === 0 && patterns.dealCustomFieldData.size === 0 && patterns.otherCustomProps.size === 0) {
      logger.info('\nNo custom fields found in the analyzed deals.');
    }
  }
}

async function main() {
  const explorer = new CustomFieldsExplorer();
  await explorer.exploreCustomFields();
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    logger.error(`Script failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = CustomFieldsExplorer;
