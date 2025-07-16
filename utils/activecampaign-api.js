const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

class ActiveCampaignAPI {
  // Static mapping for object types
  static objectMap = {
    contacts: 'contact',
    deals: 'deal'
  };

  constructor(options = {}) {
    this.client = axios.create({
      baseURL: config.activecampaign.apiUrl,
      headers: {
        'Api-Token': config.activecampaign.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: options.timeout || 30000
    });
    
    // Cache configuration
    this.cacheOptions = {
      enabled: options.cache !== false,
      ttlMinutes: options.cacheTtl || 60,
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
    return path.join(this.cacheOptions.directory, `activecampaign-${objectType}.json`);
  }

  getCacheMetadataPath() {
    return path.join(this.cacheOptions.directory, 'activecampaign-cache-metadata.json');
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
      logger.warn(`ActiveCampaign cache validation failed for ${objectType}:`, error.message);
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
      
      logger.info(`📦 Loaded ${data.length} ActiveCampaign ${objectType} from cache (${this.getTimeAgo(cacheInfo.timestamp)})`);
      return data;
    } catch (error) {
      logger.warn(`Failed to load ActiveCampaign ${objectType} from cache:`, error.message);
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
      
      logger.info(`💾 Cached ${data.length} ActiveCampaign ${objectType} (TTL: ${this.cacheOptions.ttlMinutes}min)`);
    } catch (error) {
      logger.warn(`Failed to cache ActiveCampaign ${objectType}:`, error.message);
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
        logger.info(`🧹 Cleaned ${cleanedCount} expired ActiveCampaign cache files`);
      }
    } catch (error) {
      logger.warn('Failed to clean old ActiveCampaign cache:', error.message);
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
    logger.info('🌐 Fetching contacts from ActiveCampaign API...');
    let allContacts = [];
    let offset = 0;
    const limit = config.settings.batchSize;

    try {
      do {
        const response = await this.client.get('/api/3/contacts', {
          params: {
            limit,
            offset
          }
        });
        
        const contacts = response.data.contacts;
        allContacts = allContacts.concat(contacts);
        
        logger.info(`📥 Fetched ${allContacts.length} ActiveCampaign contacts so far...`);
        
        if (contacts.length < limit) {
          break;
        }
        
        offset += limit;
        await this.delay(config.settings.apiRateLimitDelay);
        
      } while (true);
      
    } catch (error) {
      logger.error('Error fetching ActiveCampaign contacts:', error.message);
      if (error.code === 'ECONNABORTED') {
        logger.warn('ActiveCampaign API timeout - returning empty data');
      } else if (error.response?.status === 401) {
        logger.warn('ActiveCampaign API authentication failed - check your API key');
      } else if (error.response?.status === 403) {
        logger.warn('ActiveCampaign API access forbidden - check your API permissions');
      } else {
        logger.warn('ActiveCampaign API unavailable - returning empty data');
      }
      return [];
    }

    logger.info(`✅ Total ActiveCampaign contacts fetched: ${allContacts.length}`);
    
    // Save to cache
    this.saveToCache(objectType, allContacts);
    
    return allContacts;
  }

  async getAllDeals() {
    const objectType = 'deals';
    
    // Try cache first
    const cachedData = this.loadFromCache(objectType);
    if (cachedData) {
      return cachedData;
    }

    // Fetch from API
    logger.info('🌐 Fetching deals from ActiveCampaign API...');
    let allDeals = [];
    let offset = 0;
    const limit = config.settings.batchSize;

    try {
      do {
        const response = await this.client.get('/api/3/deals', {
          params: {
            limit,
            offset
          }
        });
        
        const deals = response.data.deals;
        allDeals = allDeals.concat(deals);
        
        logger.info(`📥 Fetched ${allDeals.length} ActiveCampaign deals so far...`);
        
        if (deals.length < limit) {
          break;
        }
        
        offset += limit;
        await this.delay(config.settings.apiRateLimitDelay);
        
      } while (true);
      
    } catch (error) {
      logger.error('Error fetching ActiveCampaign deals:', error.message);
      if (error.code === 'ECONNABORTED') {
        logger.warn('ActiveCampaign API timeout - returning empty data');
      } else if (error.response?.status === 401) {
        logger.warn('ActiveCampaign API authentication failed - check your API key');
      } else if (error.response?.status === 403) {
        logger.warn('ActiveCampaign API access forbidden - check your API permissions');
      } else {
        logger.warn('ActiveCampaign API unavailable - returning empty data');
      }
      return [];
    }

    logger.info(`✅ Total ActiveCampaign deals fetched: ${allDeals.length}`);
    
    // Save to cache
    this.saveToCache(objectType, allDeals);
    
    return allDeals;
  }

  async fetchAllDataConcurrently(options = {}) {
    const {
      includeContacts = true,
      includeDeals = true
    } = options;

    logger.info('🚀 Starting concurrent ActiveCampaign data fetch...');
    
    const promises = [];
    
    if (includeContacts) {
      promises.push(this.getAllContacts().then(data => ({ type: 'contacts', data })));
    }
    
    if (includeDeals) {
      promises.push(this.getAllDeals().then(data => ({ type: 'deals', data })));
    }

    const results = await Promise.all(promises);
    
    const dataMap = {};
    results.forEach(result => {
      dataMap[result.type] = result.data;
    });
    
    logger.info('✅ Concurrent ActiveCampaign data fetch complete');
    return dataMap;
  }

  // Helper method to get ActiveCampaign record URL
  getRecordUrl(objectType, id) {
    // ActiveCampaign URLs are different - this is a placeholder
    return `https://app.activecampaign.com/${ActiveCampaignAPI.objectMap[objectType]}/${id}`;
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
      logger.warn('Failed to get ActiveCampaign cache stats:', error.message);
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

        logger.info(`🧹 Cleared ActiveCampaign ${objectType} cache`);
      } else {
        // Clear all cache
        const cacheDir = this.cacheOptions.directory;
        if (fs.existsSync(cacheDir)) {
          fs.readdirSync(cacheDir).forEach(file => {
            if (file.startsWith('activecampaign-')) {
              fs.unlinkSync(path.join(cacheDir, file));
            }
          });
        }
        
        // Clear metadata
        const metadataFile = this.getCacheMetadataPath();
        if (fs.existsSync(metadataFile)) {
          fs.unlinkSync(metadataFile);
        }
        
        logger.info('🧹 Cleared all ActiveCampaign cache');
      }
    } catch (error) {
      logger.warn('Failed to clear ActiveCampaign cache:', error.message);
    }
  }
}

module.exports = ActiveCampaignAPI;
