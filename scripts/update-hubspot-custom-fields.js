#!/usr/bin/env node

const HubSpotAPI = require('../utils/hubspot-api');
const ActiveCampaignAPI = require('../utils/activecampaign-api');
const logger = require('../utils/logger');
const FlagParser = require('../utils/flag-parser');
const { MIGRATION_DATE, isMigrationDate, getHubSpotDealStatus, getACDealStatus } = require('../config/migration-constants');

class HubSpotCustomFieldsUpdater {
  constructor() {
    this.hubspot = new HubSpotAPI();
    this.activeCampaign = new ActiveCampaignAPI();
    this.updatedCount = 0;
    this.skippedCount = 0;
    this.errorCount = 0;
    this.dryRun = false;
    
    // Field mappings for the 3 missing custom fields
    this.fieldMappings = {
      'Service': 'deal_service',        // AC Service -> HubSpot Deal Service
      'Deal Type': 'dealtype',          // AC Deal Type -> HubSpot Deal Type
      'Proposal Type': 'agreement_type' // AC Proposal Type -> HubSpot Agreement Type
    };
    
    // Field metadata for lookup
    this.acFieldMetadata = new Map();
    this.dealCustomFieldData = new Map();
  }

  async updateCustomFields(dryRun = false) {
    this.dryRun = dryRun;
    
    logger.info(`Starting custom fields update process${dryRun ? ' (DRY RUN)' : ''}`);
    
    if (Object.keys(this.fieldMappings).length === 0) {
      logger.warn('No field mappings configured. Please configure field mappings before running.');
      return;
    }
    
    // Get deals from both platforms
    const dealPairs = await this.identifyDealPairs();
    logger.info(`Found ${dealPairs.length} deal pairs to process`);

    if (dealPairs.length === 0) {
      logger.info('No deal pairs found - nothing to update');
      return;
    }

    // Process each deal pair
    for (const dealPair of dealPairs) {
      await this.processDealPair(dealPair);
    }

    // Summary
    logger.info('\n=== UPDATE SUMMARY ===');
    logger.info(`Total deals processed: ${dealPairs.length}`);
    logger.info(`Successfully updated: ${this.updatedCount}`);
    logger.info(`Skipped: ${this.skippedCount}`);
    logger.info(`Errors: ${this.errorCount}`);
    
    if (dryRun) {
      logger.info('\nThis was a DRY RUN - no actual updates were made');
      logger.info('Run without --dry-run flag to apply changes');
    }
  }

  async identifyDealPairs() {
    logger.info('Fetching deals from both platforms...');
    
    // Get custom field metadata from ActiveCampaign
    const acFieldMeta = await this.activeCampaign.getDealCustomFields();
    acFieldMeta.forEach(field => {
      this.acFieldMetadata.set(field.id, field);
    });
    
    // Get deals from both platforms
    const hubspotDeals = await this.hubspot.getAllDeals();
    const acDealsResponse = await this.activeCampaign.getDealsWithCustomFields();
    
    logger.info(`Loaded ${hubspotDeals.length} HubSpot deals and ${acDealsResponse.deals.length} ActiveCampaign deals`);
    
    // Build lookup for AC custom field data
    const acCustomFieldData = acDealsResponse.dealCustomFieldData || [];
    acCustomFieldData.forEach(fieldData => {
      this.dealCustomFieldData.set(fieldData.id, fieldData);
    });
    
    // Create lookup map for AC deals
    const acDealsByTitle = new Map();
    acDealsResponse.deals.forEach(deal => {
      const title = deal.title?.toLowerCase().trim();
      if (title) {
        acDealsByTitle.set(title, deal);
      }
    });
    
    const dealPairs = [];
    
    // Find matching deals between platforms
    for (const hsDeal of hubspotDeals) {
      const dealName = hsDeal.properties.dealname?.toLowerCase().trim();
      
      if (dealName) {
        const matchingAcDeal = acDealsByTitle.get(dealName);
        
        if (matchingAcDeal) {
          // Check if this deal has any custom fields that need updating
          const hasCustomFieldsToUpdate = this.checkForCustomFieldsToUpdate(hsDeal, matchingAcDeal);
          
          if (hasCustomFieldsToUpdate) {
            dealPairs.push({
              hubspotDeal: hsDeal,
              activeCampaignDeal: matchingAcDeal,
              dealName: hsDeal.properties.dealname
            });
          }
        }
      }
    }
    
    logger.info(`Identified ${dealPairs.length} deal pairs with custom fields to update`);
    return dealPairs;
  }

  checkForCustomFieldsToUpdate(hsDeal, acDeal) {
    // Check if any of the mapped fields have data in AC but not in HubSpot
    // or if they need to be updated
    for (const [acFieldLabel, hsField] of Object.entries(this.fieldMappings)) {
      const acValue = this.getActiveCampaignFieldValue(acDeal, acFieldLabel);
      const hsValue = hsDeal.properties[hsField];
      
      // If AC has a value but HubSpot doesn't, or they're different, update needed
      if (acValue && (!hsValue || hsValue !== acValue)) {
        return true;
      }
    }
    
    return false;
  }

  getActiveCampaignFieldValue(deal, fieldLabel) {
    // Find the field metadata by label
    const fieldMeta = Array.from(this.acFieldMetadata.values())
      .find(meta => meta.fieldLabel === fieldLabel);
    
    if (!fieldMeta) {
      return null;
    }
    
    // Find the custom field data for this deal
    const dealCustomFieldIds = deal.dealCustomFieldData || [];
    
    for (const fieldDataId of dealCustomFieldIds) {
      const fieldData = this.dealCustomFieldData.get(fieldDataId);
      
      if (fieldData && fieldData.dealCustomFieldMetum === fieldMeta.id) {
        // Return the appropriate value based on field type
        return fieldData.custom_field_text_value || 
               fieldData.custom_field_number_value || 
               fieldData.custom_field_date_value || 
               fieldData.custom_field_currency_value;
      }
    }
    
    return null;
  }

  async processDealPair(dealPair) {
    try {
      logger.info(`Processing deal: ${dealPair.dealName} (HubSpot ID: ${dealPair.hubspotDeal.id})`);
      
      const updateData = {};
      let hasUpdates = false;
      
      // Process each field mapping
      for (const [acFieldLabel, hsField] of Object.entries(this.fieldMappings)) {
        const acValue = this.getActiveCampaignFieldValue(dealPair.activeCampaignDeal, acFieldLabel);
        const hsValue = dealPair.hubspotDeal.properties[hsField];
        
        if (acValue && (!hsValue || hsValue !== acValue)) {
          updateData[hsField] = acValue;
          hasUpdates = true;
          logger.info(`  ${acFieldLabel} -> ${hsField}: "${acValue}"`);
        }
      }
      
      if (!hasUpdates) {
        logger.info(`Skipping deal ${dealPair.dealName} - no custom field updates needed`);
        this.skippedCount++;
        return;
      }
      
      if (this.dryRun) {
        logger.info(`DRY RUN: Would update ${Object.keys(updateData).length} custom fields`);
        this.updatedCount++;
        return;
      }

      // Update the deal in HubSpot
      const updateResult = await this.hubspot.updateDeal(dealPair.hubspotDeal.id, updateData);

      if (updateResult) {
        logger.info(`✓ Successfully updated ${Object.keys(updateData).length} custom fields for ${dealPair.dealName}`);
        this.updatedCount++;
      } else {
        logger.error(`✗ Failed to update custom fields for ${dealPair.dealName}`);
        this.errorCount++;
      }

    } catch (error) {
      logger.error(`Error processing deal ${dealPair.dealName}: ${error.message}`);
      this.errorCount++;
    }
  }

  // Method to configure field mappings
  configureFieldMappings(mappings) {
    this.fieldMappings = mappings;
    logger.info('Field mappings configured:');
    for (const [acField, hsField] of Object.entries(mappings)) {
      logger.info(`  ${acField} -> ${hsField}`);
    }
  }
}

async function main() {
  const flagParser = new FlagParser();
  const flags = flagParser.parse();
  const dryRun = flags.dryRun || false;
  
  const updater = new HubSpotCustomFieldsUpdater();
  
  logger.info('Field mappings configured:');
  for (const [acField, hsField] of Object.entries(updater.fieldMappings)) {
    logger.info(`  ${acField} -> ${hsField}`);
  }
  
  await updater.updateCustomFields(dryRun);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    logger.error(`Script failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = HubSpotCustomFieldsUpdater;
