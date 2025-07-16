#!/usr/bin/env node

const HubSpotAPI = require('../utils/hubspot-api');
const logger = require('../utils/logger');

class HubSpotFieldsExplorer {
  constructor() {
    this.hubspot = new HubSpotAPI();
  }

  async exploreHubSpotFields() {
    logger.info('Exploring HubSpot deal properties and custom fields...');
    
    try {
      // Get deal properties schema from HubSpot
      logger.info('Fetching HubSpot deal properties schema...');
      const properties = await this.hubspot.getDealProperties();
      
      if (properties && properties.length > 0) {
        logger.info(`Found ${properties.length} deal properties in HubSpot`);
        
        // Filter for custom properties
        const customProperties = properties.filter(prop => 
          prop.name.startsWith('hs_') === false && 
          !this.isStandardProperty(prop.name)
        );
        
        logger.info(`\nCustom properties (${customProperties.length}):`);
        customProperties.forEach(prop => {
          logger.info(`  - ${prop.name}: ${prop.label} (${prop.type})`);
          if (prop.description) {
            logger.info(`    Description: ${prop.description}`);
          }
        });
        
        // Also show some standard properties for reference
        const standardProperties = properties.filter(prop => 
          this.isStandardProperty(prop.name)
        );
        
        logger.info(`\nStandard properties (${standardProperties.length}):`);
        standardProperties.slice(0, 10).forEach(prop => {
          logger.info(`  - ${prop.name}: ${prop.label} (${prop.type})`);
        });
        
      } else {
        logger.info('No properties found or unable to fetch properties schema');
      }
      
      // Get a sample of deals to see actual field usage
      logger.info('\n--- Sample deal properties ---');
      const deals = await this.hubspot.getAllDeals();
      
      if (deals.length > 0) {
        const sampleSize = Math.min(3, deals.length);
        logger.info(`Analyzing first ${sampleSize} deals for property usage:`);
        
        for (let i = 0; i < sampleSize; i++) {
          const deal = deals[i];
          logger.info(`\n--- Deal ${i + 1}: ${deal.properties.dealname} ---`);
          
          // Show all non-empty properties
          const nonEmptyProps = Object.entries(deal.properties).filter(([key, value]) => 
            value !== null && value !== undefined && value !== ''
          );
          
          logger.info(`Properties with values (${nonEmptyProps.length}):`);
          nonEmptyProps.forEach(([key, value]) => {
            // Truncate long values
            const displayValue = typeof value === 'string' && value.length > 100 
              ? value.substring(0, 100) + '...'
              : value;
            logger.info(`  ${key}: ${displayValue}`);
          });
        }
      }
      
    } catch (error) {
      logger.error(`Error exploring HubSpot fields: ${error.message}`);
    }
  }

  isStandardProperty(propName) {
    const standardProps = [
      'dealname', 'dealstage', 'closedate', 'amount', 'pipeline',
      'hubspot_owner_id', 'dealtype', 'createdate', 'hs_lastmodifieddate',
      'hs_object_id', 'hs_created_by', 'hs_updated_by', 'description'
    ];
    
    return standardProps.includes(propName) || propName.startsWith('hs_');
  }
}

async function main() {
  const explorer = new HubSpotFieldsExplorer();
  await explorer.exploreHubSpotFields();
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    logger.error(`Script failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = HubSpotFieldsExplorer;
