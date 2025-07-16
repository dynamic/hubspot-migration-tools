const axios = require('axios');
const logger = require('./logger');

class APIHelper {
  constructor(baseURL, headers = {}) {
    this.client = axios.create({
      baseURL,
      headers
    });
    
    this.client.interceptors.request.use(
      config => {
        logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      error => {
        logger.error('API Request Error:', error.message);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      response => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      error => {
        logger.error('API Response Error:', {
          status: error.response?.status,
          url: error.config?.url,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  async get(endpoint, params = {}) {
    return this.client.get(endpoint, { params });
  }

  async post(endpoint, data = {}) {
    return this.client.post(endpoint, data);
  }

  async put(endpoint, data = {}) {
    return this.client.put(endpoint, data);
  }

  async delete(endpoint) {
    return this.client.delete(endpoint);
  }

  // Rate limiting helper
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = APIHelper;
