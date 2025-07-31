const mongoose = require("mongoose");
require("dotenv").config();

// Import the merge functions
const {
  mergeHistoricalToSAPCustomers,
  dryRunMerge,
  getCollectionStats,
  CONFIG,
} = require("./customerMergingScript");

// MongoDB connection configuration
const MONGODB_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/your-database-name";

// Main execution function
async function main() {
  let connection;

  try {
    // Configure mongoose
    mongoose.set("strictQuery", false);

    // Connect to MongoDB with proper options
    console.log("Connecting to MongoDB...");
    connection = await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 45000, // 45 seconds
    });

    console.log("✓ Connected to MongoDB successfully\n");

    // Optional: Adjust configuration for your needs
    // CONFIG.BATCH_SIZE = 50; // Lower for less memory usage
    // CONFIG.BULK_WRITE_BATCH_SIZE = 500; // Lower for more frequent commits

    // Step 1: Check current statistics
    console.log("Step 1: Checking collection statistics...");
    await getCollectionStats();

    // Wait for user confirmation
    console.log("\n========================================");
    console.log("Ready to proceed with DRY RUN?");
    console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");
    console.log("========================================\n");

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Step 2: Run dry run
    console.log("Step 2: Running DRY RUN to preview changes...");
    const mergePreview = await dryRunMerge();

    // Check if there are any merges to perform
    if (mergePreview.length === 0) {
      console.log("\nNo merges to perform. Exiting...");
      return;
    }

    // Wait for user confirmation before actual merge
    console.log("\n========================================");
    console.log("DRY RUN COMPLETE!");
    console.log("Ready to proceed with ACTUAL MERGE?");
    console.log("THIS WILL MODIFY YOUR DATABASE!");
    console.log("Press Ctrl+C to cancel, or wait 10 seconds to continue...");
    console.log("========================================\n");

    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Step 3: Run the actual merge
    console.log("Step 3: Starting ACTUAL MERGE process...");
    console.log("This may take several minutes depending on your data size.\n");

    const startTime = Date.now();
    const results = await mergeHistoricalToSAPCustomers();
    const totalTime = (Date.now() - startTime) / 1000;

    console.log(`\nTotal execution time: ${totalTime.toFixed(2)} seconds`);
    console.log("Merge process completed successfully!");
  } catch (error) {
    console.error("\n❌ Error occurred:", error.message);
    console.error("Stack trace:", error.stack);

    // Provide specific error guidance
    if (error.message.includes("buffering timed out")) {
      console.error("\n💡 Connection timeout - Please check:");
      console.error("1. MongoDB is running");
      console.error("2. Connection string is correct");
      console.error("3. Network connectivity to MongoDB server");
    } else if (error.message.includes("ECONNREFUSED")) {
      console.error("\n💡 Connection refused - MongoDB might not be running");
    }
  } finally {
    // Close MongoDB connection
    if (connection) {
      console.log("\nClosing MongoDB connection...");
      await mongoose.disconnect();
      console.log("✓ Disconnected from MongoDB");
    }
    process.exit(0);
  }
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n\nProcess interrupted by user");
  await mongoose.disconnect();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", async (error) => {
  console.error("\n❌ Uncaught Exception:", error);
  await mongoose.disconnect();
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("\n❌ Unhandled Rejection at:", promise, "reason:", reason);
  await mongoose.disconnect();
  process.exit(1);
});

// Run the main function
console.log("===========================================");
console.log("Customer Merge Script - Historical to SAP");
console.log("===========================================\n");

main().catch(console.error);
