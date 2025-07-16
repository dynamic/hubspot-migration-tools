#!/usr/bin/env node

const HubSpotAPI = require('../utils/hubspot-api');
const ActiveCampaignAPI = require('../utils/activecampaign-api');
const logger = require('../utils/logger');
const FlagParser = require('../utils/flag-parser');

class HubSpotCloseDateUpdater {
  constructor() {
    this.hubspot = new HubSpotAPI();
    this.activeCampaign = new ActiveCampaignAPI();
    this.MIGRATION_DATE = '2025-07-16'; // Updated to correct timezone date
    this.updatedCount = 0;
    this.skippedCount = 0;
    this.errorCount = 0;
    this.dryRun = false;
  }

  async updateCloseDates(dryRun = false) {
    this.dryRun = dryRun;
    
    logger.info(`Starting close date update process${dryRun ? ' (DRY RUN)' : ''}`);
    
    // Get deals directly from both platforms
    const migrationDeals = await this.identifyMigrationDeals();
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

  async identifyMigrationDeals() {
    logger.info('Fetching deals from both platforms...');
    
    // Get deals from both platforms
    const hubspotDeals = await this.hubspot.getAllDeals();
    const acDeals = await this.activeCampaign.getAllDeals();
    
    logger.info(`Loaded ${hubspotDeals.length} HubSpot deals and ${acDeals.length} ActiveCampaign deals`);
    
    // Create lookup map for AC deals
    const acDealsByTitle = new Map();
    acDeals.forEach(deal => {
      const title = deal.title?.toLowerCase().trim();
      if (title) {
        acDealsByTitle.set(title, deal);
      }
    });
    
    const migrationDeals = [];
    
    // Find HubSpot deals with migration date that have matching AC deals
    for (const hsDeal of hubspotDeals) {
      const hsCloseDate = hsDeal.properties.closedate;
      
      // Check if this deal has the migration date
      if (hsCloseDate && new Date(hsCloseDate).toISOString().split('T')[0] === this.MIGRATION_DATE) {
        const dealName = hsDeal.properties.dealname?.toLowerCase().trim();
        
        if (dealName) {
          const matchingAcDeal = acDealsByTitle.get(dealName);
          
          if (matchingAcDeal && matchingAcDeal.edate) {
            // Only include deals that are won/lost (should have close dates)
            const hsStatus = this.getHubSpotDealStatus(hsDeal.properties.dealstage);
            const acStatus = this.getACDealStatus(matchingAcDeal.status);
            
            if (hsStatus === 'won' || hsStatus === 'lost' || acStatus === 'won' || acStatus === 'lost') {
              migrationDeals.push({
                hubspotId: hsDeal.id,
                dealName: hsDeal.properties.dealname,
                currentCloseDate: hsCloseDate,
                newCloseDate: matchingAcDeal.edate,
                activeCampaignId: matchingAcDeal.id,
                hubspotStatus: hsStatus,
                activeCampaignStatus: acStatus
              });
            }
          }
        }
      }
    }
    
    logger.info(`Identified ${migrationDeals.length} migration deals that need close date updates`);
    return migrationDeals;
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
  const flagParser = new FlagParser();
  const flags = flagParser.parse();
  const dryRun = flags.dryRun || false;
  
  const updater = new HubSpotCloseDateUpdater();
  await updater.updateCloseDates(dryRun);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    logger.error(`Script failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = HubSpotCloseDateUpdater;