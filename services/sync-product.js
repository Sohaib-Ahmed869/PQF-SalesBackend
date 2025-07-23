// sync-products.js
require("dotenv").config();
const mongoose = require("mongoose");
const prestashopSyncService = require("./prestashopSyncService");
const config = require("./config");

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/salesHalal", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log("Connected to MongoDB. Starting product sync...");

    try {
      // Test API connection first
      const apiTest = await prestashopSyncService.testApiConnection();

      if (apiTest.success) {
        console.log("API connection test successful. Starting product sync...");

        // Start product sync
        const syncResult = await prestashopSyncService.syncProductsFromAPI();

        if (syncResult) {
          console.log("Product sync completed successfully!");
        } else {
          console.error("Product sync failed!");
        }
      } else {
        console.error(
          "API connection test failed:",
          apiTest.error || "Unknown error"
        );
      }
    } catch (error) {
      console.error("Error during sync process:", error);
    } finally {
      // Close MongoDB connection
      console.log("Disconnecting from MongoDB...");
      await mongoose.disconnect();
      console.log("Done. Process will exit now.");
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

