const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class HubSpotAPI {
  // Static mapping for object types
  static objectMap = {
    contacts: 'contact',
    companies: 'company',
    deals: 'deal'
  };

  constructor(options = {}) {
    this.client = axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: {
        'Authorization': `Bearer ${config.hubspot.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Cache configuration
    this.cacheOptions = {
      enabled: options.cache !== false,
      ttlMinutes: options.cacheTtl || config.settings.cacheTtlMinutes,
      directory: options.cacheDir || path.join(__dirname, '..', 'cache'),
      flushCache: options.flushCache || false
    };
    
    this.ensureCacheDirectory();
    this.cleanOldCache();
  }

  ensureCacheDirectory() {
    if (this.cacheOptions.enabled && !fs.existsSync(this.cacheOptions.directory)) {
      fs.mkdirSync(this.cacheOptions.directory, { recursive: true });
      logger.info(`Created cache directory: ${this.cacheOptions.directory}`);
    }
  }

  getCacheFilePath(objectType) {
    return path.join(this.cacheOptions.directory, `hubspot-${objectType}.json`);
  }

  getCacheMetadataPath() {
    return path.join(this.cacheOptions.directory, 'cache-metadata.json');
  }

  isCacheValid(objectType) {
    if (!this.cacheOptions.enabled || this.cacheOptions.flushCache) {
      return false;
    }

    const cacheFile = this.getCacheFilePath(objectType);
    const metadataFile = this.getCacheMetadataPath();

    if (!fs.existsSync(cacheFile) || !fs.existsSync(metadataFile)) {
      return false;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      const cacheTimestamp = metadata[objectType]?.timestamp;
      
      if (!cacheTimestamp) {
        return false;
      }

      const cacheAge = Date.now() - cacheTimestamp;
      const maxAge = this.cacheOptions.ttlMinutes * 60 * 1000;
      
      return cacheAge < maxAge;
    } catch (error) {
      logger.warn(`Cache validation failed for ${objectType}:`, error.message);
      return false;
    }
  }

  loadFromCache(objectType) {
    if (!this.isCacheValid(objectType)) {
      return null;
    }

    try {
      const cacheFile = this.getCacheFilePath(objectType);
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      
      const metadataFile = this.getCacheMetadataPath();
      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      const cacheInfo = metadata[objectType];
      
      logger.info(`📦 Loaded ${data.length} ${objectType} from cache (${this.getTimeAgo(cacheInfo.timestamp)})`);
      return data;
    } catch (error) {
      logger.warn(`Failed to load ${objectType} from cache:`, error.message);
      return null;
    }
  }

  saveToCache(objectType, data) {
    if (!this.cacheOptions.enabled) {
      return;
    }

    try {
      const cacheFile = this.getCacheFilePath(objectType);
      const metadataFile = this.getCacheMetadataPath();
      
      // Save data
      fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
      
      // Update metadata
      let metadata = {};
      if (fs.existsSync(metadataFile)) {
        metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      }
      
      metadata[objectType] = {
        timestamp: Date.now(),
        count: data.length,
        ttlMinutes: this.cacheOptions.ttlMinutes
      };
      
      fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
      
      logger.info(`💾 Cached ${data.length} ${objectType} (TTL: ${this.cacheOptions.ttlMinutes}min)`);
    } catch (error) {
      logger.warn(`Failed to cache ${objectType}:`, error.message);
    }
  }

  getTimeAgo(timestamp) {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  cleanOldCache() {
    if (!this.cacheOptions.enabled) return;

    try {
      const metadataFile = this.getCacheMetadataPath();
      if (!fs.existsSync(metadataFile)) return;

      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      const maxAge = this.cacheOptions.ttlMinutes * 60 * 1000;
      let cleanedCount = 0;

      Object.keys(metadata).forEach(objectType => {
        const cacheAge = Date.now() - metadata[objectType].timestamp;
        if (cacheAge > maxAge) {
          const cacheFile = this.getCacheFilePath(objectType);
          if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
            cleanedCount++;
          }
          delete metadata[objectType];
        }
      });

      if (cleanedCount > 0) {
        fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
        logger.info(`🧹 Cleaned ${cleanedCount} expired cache files`);
      }
    } catch (error) {
      logger.warn('Failed to clean old cache:', error.message);
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getAllContacts() {
    const objectType = 'contacts';
    
    // Try cache first
    const cachedData = this.loadFromCache(objectType);
    if (cachedData) {
      return cachedData;
    }

    // Fetch from API
    logger.info('🌐 Fetching contacts from HubSpot API...');
    let after = undefined;
    let allContacts = [];

    do {
      try {
        const params = {
          limit: config.settings.batchSize,
          properties: [
            'email', 'firstname', 'lastname', 'phone', 'company',
            'createdate', 'lastmodifieddate', 'hs_object_id',
            'lifecyclestage', 'hubspotscore', 'jobtitle', 'website',
            'city', 'state', 'country'
          ].join(',')
        };
        
        if (after) {
          params.after = after;
        }

        const response = await this.client.get('/crm/v3/objects/contacts', { params });
        
        allContacts = allContacts.concat(response.data.results);
        after = response.data.paging?.next?.after;
        
        logger.info(`📥 Fetched ${allContacts.length} contacts so far...`);
        
        await this.delay(config.settings.apiRateLimitDelay);
        
      } catch (error) {
        logger.error('Error fetching contacts:', error.message);
        throw error;
      }
    } while (after);

    logger.info(`✅ Total contacts fetched: ${allContacts.length}`);
    
    // Save to cache
    this.saveToCache(objectType, allContacts);
    
    return allContacts;
  }

  async getAllCompanies() {
    const objectType = 'companies';
    
    // Try cache first
    const cachedData = this.loadFromCache(objectType);
    if (cachedData) {
      return cachedData;
    }

    // Fetch from API
    logger.info('🌐 Fetching companies from HubSpot API...');
    let after = undefined;
    let allCompanies = [];

    do {
      try {
        const params = {
          limit: config.settings.batchSize,
          properties: [
            'name', 'domain', 'website', 'phone', 'city', 'state',
            'createdate', 'lastmodifieddate', 'industry', 'numberofemployees'
          ].join(',')
        };
        
        if (after) {
          params.after = after;
        }

        const response = await this.client.get('/crm/v3/objects/companies', { params });
        
        allCompanies = allCompanies.concat(response.data.results);
        after = response.data.paging?.next?.after;
        
        logger.info(`📥 Fetched ${allCompanies.length} companies so far...`);
        
        await this.delay(config.settings.apiRateLimitDelay);
        
      } catch (error) {
        if (error.response?.status === 403 || error.response?.status === 402) {
          logger.warn('Companies API not available (likely free tier limitation)');
          return [];
        }
        logger.error('Error fetching companies:', error.message);
        throw error;
      }
    } while (after);

    logger.info(`✅ Total companies fetched: ${allCompanies.length}`);
    
    // Save to cache
    this.saveToCache(objectType, allCompanies);
    
    return allCompanies;
  }

  async getAllDeals() {
    const objectType = 'deals';
    
    // Try cache first
    const cachedData = this.loadFromCache(objectType);
    if (cachedData) {
      return cachedData;
    }

    // Fetch from API
    logger.info('🌐 Fetching deals from HubSpot API...');
    let after = undefined;
    let allDeals = [];

    do {
      try {
        const params = {
          limit: config.settings.batchSize,
          properties: [
            'dealname', 'amount', 'dealstage', 'pipeline',
            'createdate', 'lastmodifieddate', 'closedate', 'dealtype'
          ].join(',')
        };
        
        if (after) {
          params.after = after;
        }

        const response = await this.client.get('/crm/v3/objects/deals', { params });
        
        allDeals = allDeals.concat(response.data.results);
        after = response.data.paging?.next?.after;
        
        logger.info(`📥 Fetched ${allDeals.length} deals so far...`);
        
        await this.delay(config.settings.apiRateLimitDelay);
        
      } catch (error) {
        if (error.response?.status === 403 || error.response?.status === 402) {
          logger.warn('Deals API not available (likely free tier limitation)');
          return [];
        }
        logger.error('Error fetching deals:', error.message);
        throw error;
      }
    } while (after);

    logger.info(`✅ Total deals fetched: ${allDeals.length}`);
    
    // Save to cache
    this.saveToCache(objectType, allDeals);
    
    return allDeals;
  }

  async fetchAllDataConcurrently(options = {}) {
    const {
      includeContacts = true,
      includeCompanies = true,
      includeDeals = true
    } = options;

    logger.info('🚀 Starting concurrent data fetch...');
    
    const promises = [];
    
    if (includeContacts) {
      promises.push(this.getAllContacts().then(data => ({ type: 'contacts', data })));
    }
    
    if (includeCompanies) {
      promises.push(this.getAllCompanies().then(data => ({ type: 'companies', data })));
    }
    
    if (includeDeals) {
      promises.push(this.getAllDeals().then(data => ({ type: 'deals', data })));
    }

    const results = await Promise.all(promises);
    
    const dataMap = {};
    results.forEach(result => {
      dataMap[result.type] = result.data;
    });
    
    logger.info('✅ Concurrent data fetch complete');
    return dataMap;
  }

  // Helper method to get HubSpot record URL
  getRecordUrl(objectType, id) {
    const portalId = config.hubspot.portalId;
    if (!portalId) {
      // Fallback to basic URL if no portal ID configured
      return `https://app.hubspot.com/${HubSpotAPI.objectMap[objectType]}/${id}`;
    }
    return `https://app.hubspot.com/contacts/${portalId}/${HubSpotAPI.objectMap[objectType]}/${id}`;
  }

  // Cache management methods
  getCacheStats() {
    if (!this.cacheOptions.enabled) {
      return { enabled: false };
    }

    const metadataFile = this.getCacheMetadataPath();
    if (!fs.existsSync(metadataFile)) {
      return { enabled: true, objects: {} };
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      const stats = {
        enabled: true,
        directory: this.cacheOptions.directory,
        ttlMinutes: this.cacheOptions.ttlMinutes,
        objects: {}
      };

      Object.keys(metadata).forEach(objectType => {
        const info = metadata[objectType];
        stats.objects[objectType] = {
          count: info.count,
          age: this.getTimeAgo(info.timestamp),
          valid: this.isCacheValid(objectType)
        };
      });

      return stats;
    } catch (error) {
      logger.warn('Failed to get cache stats:', error.message);
      return { enabled: true, error: error.message };
    }
  }

  clearCache(objectType = null) {
    if (!this.cacheOptions.enabled) {
      return;
    }

    try {
      if (objectType) {
        // Clear specific object type
        const cacheFile = this.getCacheFilePath(objectType);
        if (fs.existsSync(cacheFile)) {
          fs.unlinkSync(cacheFile);
        }

        // Update metadata
        const metadataFile = this.getCacheMetadataPath();
        if (fs.existsSync(metadataFile)) {
          const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
          delete metadata[objectType];
          fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
        }

        logger.info(`🧹 Cleared ${objectType} cache`);
      } else {
        // Clear all cache
        const cacheDir = this.cacheOptions.directory;
        if (fs.existsSync(cacheDir)) {
          fs.readdirSync(cacheDir).forEach(file => {
            fs.unlinkSync(path.join(cacheDir, file));
          });
        }
        logger.info('🧹 Cleared all cache');
      }
    } catch (error) {
      logger.warn('Failed to clear cache:', error.message);
    }
  }

  async getDeal(dealId) {
    try {
      const response = await this.client.get(`/crm/v3/objects/deals/${dealId}`, {
        params: {
          properties: [
            'dealname', 'amount', 'dealstage', 'pipeline',
            'createdate', 'lastmodifieddate', 'closedate', 'dealtype'
          ]
        }
      });
      return response.data;
    } catch (error) {
      logger.error(`Error fetching deal ${dealId}:`, error.message);
      return null;
    }
  }

  async updateDeal(dealId, properties) {
    try {
      const response = await this.client.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: properties
      });
      return response.data;
    } catch (error) {
      logger.error(`Error updating deal ${dealId}:`, error.message);
      return null;
    }
  }
}

module.exports = HubSpotAPI;
