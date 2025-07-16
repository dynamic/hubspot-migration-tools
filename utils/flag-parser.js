const logger = require('./logger');

class FlagParser {
  constructor() {
    this.args = process.argv.slice(2);
  }

  parse() {
    const flags = {
      includeContacts: true,
      includeCompanies: true,
      includeDeals: true,
      help: false,
      flushCache: false,
      cacheStats: false,
      focusDeals: false,
      // Additional cache options
      cache: true,
      cacheTtl: 60,
      cacheDir: null
    };

    for (let i = 0; i < this.args.length; i++) {
      const arg = this.args[i];
      switch (arg) {
        case '--contacts-only':
          flags.includeContacts = true;
          flags.includeCompanies = false;
          flags.includeDeals = false;
          break;
        case '--companies-only':
          flags.includeContacts = false;
          flags.includeCompanies = true;
          flags.includeDeals = false;
          break;
        case '--deals-only':
          flags.includeContacts = false;
          flags.includeCompanies = false;
          flags.includeDeals = true;
          break;
        case '--focus-deals':
          flags.focusDeals = true;
          break;
        case '--no-contacts':
          flags.includeContacts = false;
          break;
        case '--no-companies':
          flags.includeCompanies = false;
          break;
        case '--no-deals':
          flags.includeDeals = false;
          break;
        case '--flush-cache':
          flags.flushCache = true;
          break;
        case '--cache-stats':
          flags.cacheStats = true;
          break;
        case '--no-cache':
          flags.cache = false;
          break;
        case '--cache-ttl':
          if (i + 1 < this.args.length) {
            const ttl = parseInt(this.args[i + 1]);
            if (!isNaN(ttl) && ttl > 0) {
              flags.cacheTtl = ttl;
              i++; // Skip next argument
            }
          }
          break;
        case '--cache-dir':
          if (i + 1 < this.args.length) {
            flags.cacheDir = this.args[i + 1];
            i++; // Skip next argument
          }
          break;
        case '--help':
        case '-h':
          flags.help = true;
          break;
        default:
          if (arg.startsWith('--')) {
            logger.warn(`Unknown flag: ${arg}`);
          }
      }
    }

    return flags;
  }

  showHelp(scriptName, description) {
    console.log(`
${scriptName} - ${description}

Usage: node ${scriptName} [options]

Options:
  --contacts-only     Analyze only contacts
  --companies-only    Analyze only companies  
  --deals-only        Analyze only deals
  --focus-deals       Enable comprehensive deals migration analysis
  --no-contacts       Skip contacts analysis
  --no-companies      Skip companies analysis
  --no-deals          Skip deals analysis
  --flush-cache       Clear all cached data and fetch fresh from APIs
  --cache-stats       Show cache statistics
  --no-cache          Disable caching entirely
  --cache-ttl <mins>  Cache TTL in minutes (default: 60)
  --cache-dir <path>  Cache directory path (default: ./cache)
  --help, -h          Show this help message

Performance Options:
  The script uses intelligent caching to minimize API calls:
  - First run: Fetches all data from APIs and caches it
  - Subsequent runs: Uses cached data (1 hour TTL)
  - Use --flush-cache to force refresh of all data

Examples:
  node ${scriptName}                    # Analyze all object types (uses cache)
  node ${scriptName} --contacts-only    # Analyze only contacts
  node ${scriptName} --flush-cache      # Clear cache and fetch fresh data
  node ${scriptName} --cache-stats      # Show cache usage statistics
`);
  }

  logFlags(flags) {
    logger.info('Analysis flags:', {
      contacts: flags.includeContacts,
      companies: flags.includeCompanies,
      deals: flags.includeDeals,
      focusDeals: flags.focusDeals
    });
  }
}

module.exports = FlagParser;
