// services/config.js
require("dotenv").config();

// Check for critical configuration
if (!process.env.PRESTASHOP_API_KEY) {
  console.warn(
    "WARNING: PRESTASHOP_API_KEY environment variable is not set. API authentication will fail."
  );
}

const config = {
  prestashop: {
    api: {
      // Remove trailing slash to prevent double slashes in URL paths
      baseURL: (
        process.env.PRESTASHOP_API_URL || "https://halalfs.com"
      ).replace(/\/+$/, ""),
      key: "JK2BX8JM7VP1UID2EW5PDD25MKATUDCJ",
    },
    webhook: {
      secret:
        process.env.PRESTASHOP_WEBHOOK_SECRET ||
        "JK2BX8JM7VP1UID2EW5PDD25MKATUDCJ",
    },
    defaultLanguageId: parseInt(process.env.PRESTASHOP_DEFAULT_LANG_ID || "1"),
    syncOnStartup: process.env.PRESTASHOP_SYNC_ON_STARTUP === "true",
    enableScheduledSync:
      process.env.PRESTASHOP_ENABLE_SCHEDULED_SYNC === "true",
    syncInterval: process.env.PRESTASHOP_SYNC_INTERVAL || "0 */6 * * *",
    // Enable product synchronization by default
    syncProducts: process.env.PRESTASHOP_SYNC_PRODUCTS !== "false", // Default to true unless explicitly set to false
  },
};

module.exports = config;
