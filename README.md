# HubSpot Migration Tools

A comprehensive toolkit for migrating data from ActiveCampaign to HubSpot and analyzing data quality.

## Features

- **Multi-Object Analysis**: Comprehensive analysis of contacts, companies, and deals
- **Duplicate Detection**: Advanced duplicate detection across multiple criteria
- **Cross-Platform Comparison**: Compare data between HubSpot and ActiveCampaign
- **Data Quality Reports**: Detailed analysis of data integrity and completeness
- **Free Tier Support**: Graceful handling of HubSpot free tier limitations
- **API Integration**: Direct integration with HubSpot and ActiveCampaign APIs
- **Logging**: Comprehensive logging for debugging and monitoring
- **Rate Limiting**: Built-in API rate limiting to prevent throttling

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Environment Setup

Copy the example environment file and fill in your API credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual API credentials:

```env
# HubSpot API Configuration
HUBSPOT_ACCESS_TOKEN=your_hubspot_private_app_token_here
HUBSPOT_PORTAL_ID=your_hubspot_portal_id

# ActiveCampaign API Configuration
ACTIVECAMPAIGN_API_URL=https://youraccountname.api-us1.com
ACTIVECAMPAIGN_API_KEY=your_activecampaign_api_key_here
```

### 3. Getting API Credentials

#### HubSpot Private App Setup (Step-by-Step):

**Note: These instructions are for HubSpot Free tier. Some features may require paid plans.**

1. **Log into your HubSpot account** and go to Settings (gear icon)

2. **Navigate to Integrations**:
   - Click on "Integrations" in the left sidebar
   - Select "Private Apps"

3. **Create a new private app**:
   - Click "Create a private app"
   - Fill in app details:
     - **App name**: "HubSpot Migration Tools"
     - **Description**: "Tools for analyzing and migrating HubSpot data"

4. **Configure Scopes** (Authentication tab):
   
   **Required Scopes for Free Tier:**
   ```
   CRM:
   ✓ crm.objects.contacts.read
   ✓ crm.objects.contacts.write
   ```
   
   **Additional Scopes for Paid Tiers:**
   ```
   CRM:
   ✓ crm.objects.contacts.read
   ✓ crm.objects.contacts.write
   ✓ crm.objects.companies.read
   ✓ crm.objects.companies.write
   ✓ crm.objects.deals.read
   ✓ crm.objects.deals.write
   ✓ crm.schemas.contacts.read
   ✓ crm.schemas.companies.read
   ✓ crm.schemas.deals.read
   ```

5. **Create the app**:
   - Review your settings
   - Click "Create app"

6. **Copy your access token**:
   - After creation, you'll see the access token
   - Copy this token immediately (you won't be able to see it again)
   - If you lose it, you'll need to generate a new one

7. **Test your token**:
   - The scripts will automatically test API access
   - Free tier users will see warnings about companies/deals not being available

#### ActiveCampaign API Key:
1. Go to ActiveCampaign Settings → Developer
2. Copy your API URL and API Key

#### HubSpot Free Tier Limitations:
- **Companies**: Limited access (may not be available)
- **Deals**: Limited access (may not be available)
- **Custom Properties**: Limited number allowed
- **API Rate Limits**: 100 requests per 10 seconds
- **Workflows**: Limited automation capabilities

The scripts are designed to gracefully handle these limitations and will show warnings when features aren't available.

### 4. Run Analysis

```bash
# Full analysis (all objects)
npm run analyze

# Analyze specific objects only
npm run analyze:contacts     # Only contacts
npm run analyze:companies    # Only companies  
npm run analyze:deals        # Only deals

# Advanced options
npm run analyze:help         # Show all options
```

This will:
- Fetch data from HubSpot (contacts, companies, deals)
- Analyze for duplicates by multiple criteria
- Generate detailed reports in the `reports/` directory
- Create actionable CSV with HubSpot links

## Available Scripts

### Main Commands

```bash
npm start              # Show available commands and validate config
npm run analyze        # Run full duplicate analysis (contacts, companies, deals)
npm run analyze:contacts   # Analyze only contacts
npm run analyze:companies  # Analyze only companies  
npm run analyze:deals      # Analyze only deals
npm run analyze:help       # Show all available options
npm run sync-check     # Check sync status with ActiveCampaign (coming soon)
```

### Advanced Options

```bash
# Custom flag combinations
node scripts/hubspot-duplicate-analyzer.js --no-companies    # Skip companies
node scripts/hubspot-duplicate-analyzer.js --no-deals        # Skip deals
node scripts/hubspot-duplicate-analyzer.js --contacts-only   # Only contacts
```

**Note**: The analyzer is completely READ-ONLY and will not modify any data in HubSpot.

## Project Structure

```
hubspot-migration-tools/
├── scripts/
│   ├── hubspot-duplicate-analyzer.js    # Main duplicate analysis tool
│   └── activecampaign-sync-check.js     # Sync validation (coming soon)
├── utils/
│   ├── logger.js                        # Logging utility
│   └── api-helper.js                    # API request helper
├── reports/                             # Generated reports
├── logs/                                # Application logs
├── config.js                            # Configuration management
├── index.js                             # Main entry point
└── .env.example                         # Environment template
```

## Duplicate Analysis

The duplicate analyzer checks for:

### **Contacts:**
1. **Email Duplicates** (High Priority)
   - Exact email matches (case-insensitive)
   - Most likely to be true duplicates

2. **Phone Duplicates** (Medium Priority)
   - Normalized phone number matches
   - Could be family members or colleagues

3. **Name Duplicates** (Low Priority)
   - First + Last name matches
   - Common names may not be true duplicates

4. **Company + Name Duplicates** (Medium Priority)
   - Same person at same company
   - High confidence matches

### **Companies** (Paid Tier Only):
1. **Domain Duplicates** (High Priority)
   - Same domain = same company
   - Should be merged immediately

2. **Name Duplicates** (Medium Priority)
   - Company name variations (Inc, LLC, Corp)
   - Review for similar companies

### **Deals** (Paid Tier Only):
1. **Name Duplicates** (Medium Priority)
   - Same deal name across different stages
   - May indicate duplicate opportunities

## Output Files

After running the analysis, you'll find three types of reports:

### **1. CSV Report (Actionable Items)**
- **File**: `reports/hubspot-duplicate-issues.csv`
- **Purpose**: Actionable list of duplicates with direct HubSpot links
- **Features**:
  - Issue type and priority level
  - Record IDs and names
  - Clickable HubSpot URLs for each record
  - Primary record to merge into
  - Specific action recommendations

### **2. Summary Report (Human-Readable)**
- **File**: `reports/hubspot-duplicate-summary.txt`
- **Purpose**: High-level overview and recommendations
- **Features**:
  - Total counts by object type
  - Top duplicate examples
  - Priority-based recommendations
  - Next steps guidance

### **3. JSON Report (Full Data)**
- **File**: `reports/hubspot-duplicate-report.json`
- **Purpose**: Complete data for custom processing
- **Features**:
  - All duplicate groups with full contact details
  - Metadata for each record
  - Structured data for building custom tools

### **4. Sync Check (Coming Soon)**
- `reports/activecampaign-sync-report.json` - ActiveCampaign data overview
- `reports/activecampaign-sync-summary.txt` - Available fields and contacts

### **Gap Analysis:**
- `reports/data-gap-analysis.json` - Cross-platform comparison
- `reports/data-gap-summary.txt` - Missing data and field mismatches

### **Logs:**
- `logs/migration.log` - Application logs for debugging

## Configuration Options

Edit your `.env` file to customize:

```env
# Rate limiting (milliseconds between API calls)
API_RATE_LIMIT_DELAY=100

# Batch size for API requests
BATCH_SIZE=100

# Logging level (debug, info, warn, error)
LOG_LEVEL=info

# Custom log file location
LOG_FILE=logs/migration.log
```

## Next Steps

1. **Review Reports**: Check the generated reports for data quality issues
2. **Plan Merges**: Start with high-priority email duplicates
3. **Sync Analysis**: Compare with ActiveCampaign data to identify missing fields
4. **Data Enhancement**: Use APIs to fill in missing custom field data

## Free Tier Considerations

**What works on HubSpot Free:**
- ✅ Contact management and analysis
- ✅ Basic duplicate detection
- ✅ ActiveCampaign sync checking
- ✅ Contact field gap analysis

**What's limited on HubSpot Free:**
- ⚠️ Companies (limited access)
- ⚠️ Deals (limited access)
- ⚠️ Custom properties (limited number)
- ⚠️ Advanced workflows
- ⚠️ API rate limits (100 requests/10 seconds)

**Scripts handle free tier by:**
- Gracefully skipping unavailable features
- Showing informative warnings
- Providing upgrade recommendations
- Focusing on contact-based analysis

## Troubleshooting

### Common Issues

1. **API Rate Limiting**: Increase `API_RATE_LIMIT_DELAY` in `.env`
2. **Missing Credentials**: Ensure all required environment variables are set
3. **Permission Errors**: Verify API token has required scopes
4. **403/402 Errors**: Feature not available on current HubSpot plan
5. **Companies/Deals Not Found**: Normal on free tier - upgrade for access

### Free Tier Specific Issues

**"Companies API not available"**: This is normal on free tier
**"Deals API not available"**: This is normal on free tier
**Rate limiting**: Free tier has stricter limits - increase delay to 200ms+

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=debug
```

## Safety Features

- **Read-Only Analysis**: No data is modified during analysis
- **Rate Limiting**: Prevents API throttling
- **Comprehensive Logging**: All actions are logged
- **Error Handling**: Graceful error handling with detailed messages
- **Free Tier Compatibility**: Automatically adapts to plan limitations

## Contributing

Feel free to extend this toolkit with additional migration and analysis tools.

## License

MIT License

## HubSpot-ActiveCampaign Comparison

Compare contacts between HubSpot and ActiveCampaign to analyze migration completeness and data quality.

### Features

- **Contact Matching**: Matches contacts across platforms using email, phone, or name
- **Migration Analysis**: Identifies contacts that exist in only one platform
- **Data Quality Check**: Compares field values and identifies discrepancies
- **Actionable Reports**: Generates CSV reports with direct HubSpot links for easy action

### Usage

```bash
# Compare all contacts between platforms
npm run compare-platforms

# Or run directly
node scripts/hubspot-activecampaign-comparison.js
```

### Matching Logic

The script uses a hierarchy to match contacts:
1. **Email Match** (most reliable) - Primary identifier
2. **Phone Match** - Secondary identifier if email doesn't match
3. **Name Match** - Fallback for contacts without email/phone

### Reports Generated

1. **JSON Report** (`reports/hubspot-activecampaign-comparison.json`)
   - Complete detailed analysis with all matched contacts
   - Field-by-field differences for each match
   - Comprehensive metadata and statistics

2. **Summary Report** (`reports/hubspot-activecampaign-comparison-summary.txt`)
   - Human-readable overview of the comparison
   - Key statistics and recommendations
   - Top missing contacts list

3. **CSV Report** (`reports/hubspot-activecampaign-comparison.csv`)
   - Actionable items for data cleanup
   - Direct HubSpot links for easy access
   - Prioritized recommendations

### Output Format

The comparison report includes:
- **Matches**: Contacts found in both platforms with difference analysis
- **HubSpot-Only**: Contacts that exist only in HubSpot (likely new contacts)
- **ActiveCampaign-Only**: Contacts missing from HubSpot (migration gaps)
- **Recommendations**: Prioritized actions for data quality improvement

### Example Output

```
HUBSPOT-ACTIVECAMPAIGN COMPARISON REPORT
========================================

SUMMARY:
- Total HubSpot Contacts: 1,250
- Total ActiveCampaign Contacts: 1,180
- Matched Contacts: 1,150
- HubSpot-Only Contacts: 100
- ActiveCampaign-Only Contacts: 30

MIGRATION COVERAGE:
- Coverage: 97.5%
- Missing from HubSpot: 30

RECOMMENDATIONS:
1. [HIGH] 30 contacts exist in ActiveCampaign but not in HubSpot
   Action: Review ActiveCampaign-only contacts and migrate if needed

2. [MEDIUM] 45 field differences found across 1,150 matched contacts
   Action: Review field differences and update data if needed
```
