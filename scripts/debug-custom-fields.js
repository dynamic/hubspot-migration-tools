#!/usr/bin/env node

const ActiveCampaignAPI = require('../utils/activecampaign-api');
const logger = require('../utils/logger');

async function debugCustomFields() {
  const api = new ActiveCampaignAPI();
  
  try {
    // Get one deal with custom fields
    const response = await api.client.get('/api/3/deals', {
      params: {
        limit: 1,
        include: 'dealCustomFieldData'
      }
    });
    
    console.log('Raw API Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Also check the custom field metadata
    const metaResponse = await api.client.get('/api/3/dealCustomFieldMeta');
    console.log('\nCustom Field Metadata:');
    console.log(JSON.stringify(metaResponse.data, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

debugCustomFields();
