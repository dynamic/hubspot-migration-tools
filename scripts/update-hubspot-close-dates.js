#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const HubSpotAPI = require('../utils/hubspot-api');
const logger = require('../utils/logger');
const flagParser = require('../utils/flag-parser');

class HubSpotCloseDateUpdater {
  constructor() {
    this.hubspot = new HubSpotAPI();
    this.MIGRATION_DATE = '2025-07-15';
    this.updatedCount = 0;
    this.skippedCount = 0;
    this.errorCount = 0;
    this.dryRun = false;
  }

  async updateCloseDates(jsonFilePath, dryRun = false) {
    this.dryRun = dryRun;
    
    logger.info(`Starting close date update process${dryRun ? ' (DRY RUN)' : ''}`);
    
    // Read the gap analysis JSON file
    const gapData = await this.loadGapAnalysisData(jsonFilePath);
    if (!gapData) {
      logger.error('Failed to load gap analysis data');
      return;
    }

    // Filter for migration date deals that need updating
    const migrationDeals = await this.identifyMigrationDeals(gapData);
    logger.info(`Found ${migrationDeals.length} deals with migration date (${this.MIGRATION_DATE}) that need updating`);

    if (migrationDeals.length === 0) {
      logger.info('No deals found with migration date - nothing to update');
      return;
    }

    // Process each deal
    for (const deal of migrationDeals) {
      await this.processDeal(deal);
    }

    // Summary
    logger.info('\n=== UPDATE SUMMARY ===');
    logger.info(`Total deals processed: ${migrationDeals.length}`);
    logger.info(`Successfully updated: ${this.updatedCount}`);
    logger.info(`Skipped: ${this.skippedCount}`);
    logger.info(`Errors: ${this.errorCount}`);
    
    if (dryRun) {
      logger.info('\nThis was a DRY RUN - no actual updates were made');
      logger.info('Run without --dry-run flag to apply changes');
    }
  }

  async loadGapAnalysisData(jsonFilePath) {
    try {
      if (!fs.existsSync(jsonFilePath)) {
        logger.error(`Gap analysis file not found: ${jsonFilePath}`);
        return null;
      }

      const data = fs.readFileSync(jsonFilePath, 'utf8');
      const gapData = JSON.parse(data);
      
      if (!gapData.deals || !gapData.deals.dateMismatches) {
        logger.error('No date mismatches found in gap analysis data');
        return null;
      }

      return gapData;
    } catch (error) {
      logger.error(`Error loading gap analysis data: ${error.message}`);
      return null;
    }
  }

  async identifyMigrationDeals(gapData) {
    const migrationDeals = [];
    
    for (const mismatch of gapData.deals.dateMismatches) {
      // Only process deals with migration date that have AC close date
      if (mismatch.isMigrationDate && mismatch.activeCampaignCloseDate) {
        migrationDeals.push({
          hubspotId: mismatch.hubspotId,
          dealName: mismatch.dealName,
          currentCloseDate: mismatch.hubspotCloseDate,
          newCloseDate: mismatch.activeCampaignCloseDate,
          activeCampaignId: mismatch.activeCampaignId
        });
      }
    }

    return migrationDeals;
  }

  async processDeal(deal) {
    try {
      logger.info(`Processing deal: ${deal.dealName} (ID: ${deal.hubspotId})`);
      
      // Verify current close date is still the migration date
      const currentDeal = await this.hubspot.getDeal(deal.hubspotId);
      if (!currentDeal) {
        logger.error(`Could not fetch deal ${deal.hubspotId} from HubSpot`);
        this.errorCount++;
        return;
      }

      const currentCloseDate = currentDeal.properties.closedate;
      const isMigrationDate = currentCloseDate && 
        new Date(currentCloseDate).toISOString().split('T')[0] === this.MIGRATION_DATE;

      if (!isMigrationDate) {
        logger.info(`Skipping deal ${deal.dealName} - close date has been changed from migration date`);
        this.skippedCount++;
        return;
      }

      // Convert AC date to HubSpot format (Unix timestamp in milliseconds)
      const newCloseDate = new Date(deal.newCloseDate).getTime();
      
      if (this.dryRun) {
        logger.info(`DRY RUN: Would update close date from ${new Date(currentCloseDate).toLocaleDateString()} to ${new Date(deal.newCloseDate).toLocaleDateString()}`);
        this.updatedCount++;
        return;
      }

      // Update the deal in HubSpot
      const updateResult = await this.hubspot.updateDeal(deal.hubspotId, {
        closedate: newCloseDate
      });

      if (updateResult) {
        logger.info(`✓ Successfully updated close date for ${deal.dealName} to ${new Date(deal.newCloseDate).toLocaleDateString()}`);
        this.updatedCount++;
      } else {
        logger.error(`✗ Failed to update close date for ${deal.dealName}`);
        this.errorCount++;
      }

    } catch (error) {
      logger.error(`Error processing deal ${deal.dealName}: ${error.message}`);
      this.errorCount++;
    }
  }
}

async function main() {
  const flags = flagParser.parse();
  const dryRun = flags.dryRun || false;
  
  // Default to the most recent gap analysis JSON file
  const reportsDir = path.join(__dirname, '..', 'reports');
  const defaultJsonFile = path.join(reportsDir, 'data-gap-analysis.json');
  
  let jsonFilePath = defaultJsonFile;
  
  // Allow custom JSON file path
  if (flags.jsonFile) {
    jsonFilePath = path.resolve(flags.jsonFile);
  }

  const updater = new HubSpotCloseDateUpdater();
  await updater.updateCloseDates(jsonFilePath, dryRun);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    logger.error(`Script failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = HubSpotCloseDateUpdater;
