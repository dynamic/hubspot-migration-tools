#!/usr/bin/env node

const ActiveCampaignAPI = require('../utils/activecampaign-api');
const logger = require('../utils/logger');

async function testCustomFieldsStructure() {
  const api = new ActiveCampaignAPI();
  
  try {
    // Get custom field metadata
    const fieldMeta = await api.getDealCustomFields();
    logger.info(`Found ${fieldMeta.length} custom field definitions`);
    
    // Get deals with custom fields
    const dealsResponse = await api.getDealsWithCustomFields();
    logger.info(`Structure of dealsResponse:`);
    logger.info(`- deals: ${dealsResponse.deals ? dealsResponse.deals.length : 'undefined'}`);
    logger.info(`- dealCustomFieldData: ${dealsResponse.dealCustomFieldData ? dealsResponse.dealCustomFieldData.length : 'undefined'}`);
    
    // Test with the first deal
    if (dealsResponse.deals && dealsResponse.deals.length > 0) {
      const firstDeal = dealsResponse.deals[0];
      logger.info(`First deal: ${firstDeal.title}`);
      logger.info(`Custom field IDs: ${JSON.stringify(firstDeal.dealCustomFieldData)}`);
      
      // Find a custom field value
      if (firstDeal.dealCustomFieldData && firstDeal.dealCustomFieldData.length > 0) {
        const fieldId = firstDeal.dealCustomFieldData[0];
        const fieldData = dealsResponse.dealCustomFieldData.find(fd => fd.id === fieldId);
        logger.info(`Field data for ${fieldId}: ${JSON.stringify(fieldData)}`);
      }
    }
    
  } catch (error) {
    logger.error('Error:', error.message);
  }
}

testCustomFieldsStructure();
