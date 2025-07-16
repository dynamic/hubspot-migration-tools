const hubspot = require('@hubspot/api-client');
const axios = require('axios');
const config = require('./config');

const hubspotClient = new hubspot.Client({
  accessToken: config.hubspot.accessToken
});

async function testConnection() {
  try {
    console.log('Testing HubSpot API connection...');
    console.log('Using access token:', config.hubspot.accessToken.substring(0, 20) + '...');
    console.log('Portal ID:', config.hubspot.portalId);
    
    // Test with direct API call using axios
    console.log('\n1. Testing with direct API call...');
    const response = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
      headers: {
        'Authorization': `Bearer ${config.hubspot.accessToken}`
      },
      params: {
        limit: 1
      }
    });
    
    console.log('✅ API connection successful!');
    console.log('Status:', response.status);
    
    if (response.data.results && response.data.results.length > 0) {
      const contact = response.data.results[0];
      console.log('Sample contact ID:', contact.id);
      console.log('Sample contact email:', contact.properties?.email || 'No email');
      console.log('Sample contact name:', contact.properties?.firstname, contact.properties?.lastname);
    }
    
    // Check rate limits
    console.log('\n2. Rate limit info:');
    console.log('Daily limit:', response.headers['x-hubspot-ratelimit-daily'] || 'Unknown');
    console.log('Remaining today:', response.headers['x-hubspot-ratelimit-daily-remaining'] || 'Unknown');
    console.log('Per-10-second limit:', response.headers['x-hubspot-ratelimit-max'] || 'Unknown');
    
    console.log('\n3. Portal ID Verification:');
    console.log('✅ Your Portal ID is: ' + config.hubspot.portalId);
    console.log('   You can verify this by going to:');
    console.log('   https://app.hubspot.com/contacts/' + config.hubspot.portalId + '/contacts/list/view/all/');
    
  } catch (error) {
    console.error('❌ API connection failed:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', error.response.data);
      
      if (error.response.status === 401) {
        console.error('� Authentication failed - check your access token');
      } else if (error.response.status === 403) {
        console.error('🚫 Access denied - check your app scopes');
      }
    }
  }
}

testConnection();
