const mongoose = require("mongoose");
require("dotenv").config();

// Import the report generation function
const {
  generateComprehensiveCustomerReport,
  isSAPCustomer,
  CONFIG,
} = require("./duplicatecustomerlist");

// MongoDB connection configuration
const MONGODB_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/your-database-name";

// Function to get basic collection statistics
async function getBasicStats() {
  const Customer = require("./models/Customer");

  console.log("Fetching collection statistics...");

  const [customerCount] = await Promise.all([Customer.countDocuments()]);

  const [sapCustomerCount, historicalCustomerCount] = await Promise.all([
    Customer.countDocuments({ CardCode: { $regex: /^C\d{4}$/ } }),
    Customer.countDocuments({
      $or: [
        { CardCode: { $not: { $regex: /^C\d{4}$/ } } },
        { CardCode: { $exists: false } },
      ],
    }),
  ]);

  console.log("\n========== COLLECTION STATISTICS ==========");
  console.log(`Total customers: ${customerCount.toLocaleString()}`);
  console.log(`  - SAP customers: ${sapCustomerCount.toLocaleString()}`);
  console.log(
    `  - Historical customers: ${historicalCustomerCount.toLocaleString()}`
  );

  return {
    customerCount,
    sapCustomerCount,
    historicalCustomerCount,
  };
}

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
    // CONFIG.PROGRESS_LOG_INTERVAL = 50; // Log progress more frequently

    // Step 1: Check current statistics
    console.log("Step 1: Checking collection statistics...");
    const stats = await getBasicStats();

    // Confirm proceeding with report generation
    console.log("\n========================================");
    console.log("Ready to generate comprehensive customer duplicates report?");
    console.log(
      `This will analyze ${stats.customerCount.toLocaleString()} customers...`
    );
    console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...");
    console.log("========================================\n");

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Step 2: Generate the comprehensive report
    console.log(
      "Step 2: Generating comprehensive customer duplicates report..."
    );
    console.log("This may take several minutes depending on your data size.\n");

    const startTime = Date.now();
    const results = await generateComprehensiveCustomerReport();
    const totalTime = (Date.now() - startTime) / 1000;

    // Display final results
    console.log("\n===========================================");
    console.log("REPORT GENERATION SUMMARY");
    console.log("===========================================");
    console.log(`Total execution time: ${totalTime.toFixed(2)} seconds`);
    console.log(`Report file: ${results.filepath}`);
    console.log("\nReport Contents:");
    console.log(
      `- Total SAP customers: ${results.summary.totalSapCustomers.toLocaleString()}`
    );
    console.log(
      `- Total Historical customers: ${results.summary.totalHistoricalCustomers.toLocaleString()}`
    );
    console.log(
      `- SAP duplicate groups: ${results.summary.sapDuplicateGroups.toLocaleString()}`
    );
    console.log(
      `- Historical duplicate groups: ${results.summary.historicalDuplicateGroups.toLocaleString()}`
    );
    console.log(
      `- SAP customers in duplicate groups: ${results.summary.sapCustomersInDuplicates.toLocaleString()}`
    );
    console.log(
      `- Historical customers in duplicate groups: ${results.summary.historicalCustomersInDuplicates.toLocaleString()}`
    );

    console.log("\nExcel Sheets Created:");
    console.log("1. 'SAP Duplicates' - Detailed duplicate SAP customers");
    console.log(
      "2. 'Historical Duplicates' - Detailed duplicate historical customers"
    );
    console.log("3. 'All SAP Customers' - Complete SAP customer list");
    console.log(
      "4. 'All Historical Customers' - Complete historical customer list"
    );
    console.log("5. 'Summary' - High-level statistics");
    console.log(
      "6. 'Duplicate Groups Summary' - Quick duplicate groups overview"
    );

    console.log("\n✅ Report generation completed successfully!");
    console.log(
      `📊 Open the Excel file to analyze your customer data: ${results.filepath}`
    );
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
    } else if (error.message.includes("XLSX")) {
      console.error("\n💡 Excel generation error - Please check:");
      console.error("1. XLSX package is installed (npm install xlsx)");
      console.error("2. Write permissions in the current directory");
      console.error("3. Available disk space");
    } else if (error.message.includes("models/Customer")) {
      console.error("\n💡 Model loading error - Please check:");
      console.error("1. Customer model file exists at './models/Customer'");
      console.error("2. Model is properly exported");
      console.error("3. Model structure matches expected schema");
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
  console.log("Cleaning up...");
  await mongoose.disconnect();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", async (error) => {
  console.error("\n❌ Uncaught Exception:", error);
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("\n❌ Unhandled Rejection at:", promise, "reason:", reason);
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(1);
});

// Run the main function
console.log("=======================================================");
console.log("Customer Duplicates Report Generator");
console.log("=======================================================");
console.log("This script will:");
console.log("• Analyze all customers in your database");
console.log("• Identify duplicate customer groups");
console.log("• Generate a comprehensive Excel report");
console.log("• Include complete customer data for analysis");
console.log("=======================================================\n");

main().catch(console.error);
