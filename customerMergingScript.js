const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
const Invoice = require("./models/Invoice");
const Payment = require("./models/payment");
const Customer = require("./models/Customer");
const CustomerProductSales = require("./models/CustomerProductSales");

// Configuration
const CONFIG = {
  BATCH_SIZE: 100, // Process 100 customers at a time
  BULK_WRITE_BATCH_SIZE: 1000, // Bulk write operations in batches of 1000
  PROGRESS_LOG_INTERVAL: 10, // Log progress every 10 customers
  USE_LEAN: true, // Use lean queries for better performance
  INDEX_CHECK: true, // Check and create indexes before processing
};

// Helper function to identify SAP customers by CardCode pattern
const isSAPCustomer = (cardCode) => {
  const sapPattern = /^C\d{4}$/;
  return sapPattern.test(cardCode);
};

// Helper function to create progress logger
const createProgressLogger = (total, itemName) => {
  let processed = 0;
  const startTime = Date.now();

  return {
    increment: (count = 1) => {
      processed += count;
      if (
        processed % CONFIG.PROGRESS_LOG_INTERVAL === 0 ||
        processed === total
      ) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (total - processed) / rate;
        console.log(
          `  ${itemName}: ${processed}/${total} (${(
            (processed / total) *
            100
          ).toFixed(1)}%) - Rate: ${rate.toFixed(
            1
          )}/s - ETA: ${remaining.toFixed(0)}s`
        );
      }
    },
  };
};

// Ensure indexes exist for optimal performance
async function ensureIndexes() {
  console.log("Ensuring indexes for optimal performance...");

  try {
    // Customer indexes
    await Customer.collection.createIndex({ CardCode: 1 });
    await Customer.collection.createIndex({ CardName: 1 });

    // Invoice indexes
    await Invoice.collection.createIndex({ CardCode: 1 });
    await Invoice.collection.createIndex({ CardCode: 1, Historical: 1 });

    // Payment indexes
    await Payment.collection.createIndex({ CardCode: 1 });
    await Payment.collection.createIndex({ CardCode: 1, Historical: 1 });

    // CustomerProductSales indexes
    await CustomerProductSales.collection.createIndex({ customerId: 1 });
    await CustomerProductSales.collection.createIndex({
      customerId: 1,
      Historical: 1,
    });

    console.log("Indexes verified/created successfully");
  } catch (error) {
    console.error("Error creating indexes:", error);
    // Continue anyway, indexes might already exist
  }
}

// Build a mapping of all customers grouped by EXACT name (no normalization)
async function buildCustomerMapping() {
  console.log("Building customer mapping with exact name matching...");

  const sapCustomersByName = new Map();
  const historicalCustomersByName = new Map();

  // Use cursor for memory efficiency
  const cursor = Customer.find({}).lean().cursor();

  for (
    let customer = await cursor.next();
    customer != null;
    customer = await cursor.next()
  ) {
    if (customer.CardCode && isSAPCustomer(customer.CardCode)) {
      // SAP Customer - use exact CardName as key
      const exactName = customer.CardName || "";
      if (exactName) {
        if (!sapCustomersByName.has(exactName)) {
          sapCustomersByName.set(exactName, []);
        }
        sapCustomersByName.get(exactName).push(customer);
      }
    } else {
      // Historical Customer - use exact CardName as key
      const exactName = customer.CardName || "";
      if (exactName) {
        if (!historicalCustomersByName.has(exactName)) {
          historicalCustomersByName.set(exactName, []);
        }
        historicalCustomersByName.get(exactName).push(customer);
      }
    }
  }

  console.log(`Found ${sapCustomersByName.size} unique SAP customer names`);
  console.log(
    `Found ${historicalCustomersByName.size} unique historical customer names`
  );

  return { sapCustomersByName, historicalCustomersByName };
}

// Identify valid one-to-one mappings and skipped customers
function identifyMappingsAndSkips(
  sapCustomersByName,
  historicalCustomersByName
) {
  console.log("Identifying valid one-to-one mappings and skipped customers...");

  const validMappings = [];
  const skippedCustomers = {
    sapDuplicates: [],
    historicalDuplicates: [],
    noMatches: [],
  };

  // Check SAP customers for duplicates and valid matches
  for (const [exactName, sapCustomers] of sapCustomersByName) {
    if (sapCustomers.length > 1) {
      // Multiple SAP customers with same name - skip all
      skippedCustomers.sapDuplicates.push({
        name: exactName,
        customers: sapCustomers.map((c) => ({
          cardCode: c.CardCode,
          cardName: c.CardName,
          _id: c._id,
        })),
        reason: "Multiple SAP customers with same name",
      });
    } else {
      // Only one SAP customer with this name
      const sapCustomer = sapCustomers[0];
      const historicalMatches = historicalCustomersByName.get(exactName);

      if (historicalMatches && historicalMatches.length === 1) {
        // Perfect one-to-one match
        validMappings.push({
          sapCustomer,
          historicalCustomer: historicalMatches[0],
        });
      } else if (historicalMatches && historicalMatches.length > 1) {
        // Multiple historical customers with same name - skip all
        skippedCustomers.historicalDuplicates.push({
          name: exactName,
          customers: historicalMatches.map((c) => ({
            cardCode: c.CardCode,
            cardName: c.CardName,
            _id: c._id,
          })),
          reason: "Multiple historical customers with same name",
        });
      }
      // If no historical matches, we don't add to skipped (no action needed)
    }
  }

  // Check for historical customers that have duplicates but no SAP match
  for (const [exactName, historicalCustomers] of historicalCustomersByName) {
    if (historicalCustomers.length > 1 && !sapCustomersByName.has(exactName)) {
      // Multiple historical customers with same name and no SAP customer
      skippedCustomers.historicalDuplicates.push({
        name: exactName,
        customers: historicalCustomers.map((c) => ({
          cardCode: c.CardCode,
          cardName: c.CardName,
          _id: c._id,
        })),
        reason: "Multiple historical customers with same name (no SAP match)",
      });
    }
  }

  console.log(`Found ${validMappings.length} valid one-to-one mappings`);
  console.log(
    `Found ${skippedCustomers.sapDuplicates.length} SAP duplicate groups`
  );
  console.log(
    `Found ${skippedCustomers.historicalDuplicates.length} historical duplicate groups`
  );

  return { validMappings, skippedCustomers };
}

// Create Excel report for skipped customers
async function createSkippedCustomersReport(skippedCustomers) {
  console.log("Creating Excel report for skipped customers...");

  const workbook = XLSX.utils.book_new();

  // SAP Duplicates sheet
  const sapDuplicatesData = [];
  skippedCustomers.sapDuplicates.forEach((group) => {
    group.customers.forEach((customer, index) => {
      sapDuplicatesData.push({
        "Group Name": group.name,
        "Customer Number": index + 1,
        "Card Code": customer.cardCode,
        "Card Name": customer.cardName,
        "Customer ID": customer._id.toString(),
        Reason: group.reason,
      });
    });
  });

  const sapDuplicatesSheet = XLSX.utils.json_to_sheet(sapDuplicatesData);
  XLSX.utils.book_append_sheet(workbook, sapDuplicatesSheet, "SAP Duplicates");

  // Historical Duplicates sheet
  const historicalDuplicatesData = [];
  skippedCustomers.historicalDuplicates.forEach((group) => {
    group.customers.forEach((customer, index) => {
      historicalDuplicatesData.push({
        "Group Name": group.name,
        "Customer Number": index + 1,
        "Card Code": customer.cardCode,
        "Card Name": customer.cardName,
        "Customer ID": customer._id.toString(),
        Reason: group.reason,
      });
    });
  });

  const historicalDuplicatesSheet = XLSX.utils.json_to_sheet(
    historicalDuplicatesData
  );
  XLSX.utils.book_append_sheet(
    workbook,
    historicalDuplicatesSheet,
    "Historical Duplicates"
  );

  // Summary sheet
  const summaryData = [
    {
      Category: "SAP Duplicate Groups",
      Count: skippedCustomers.sapDuplicates.length,
      "Total Customers": skippedCustomers.sapDuplicates.reduce(
        (sum, group) => sum + group.customers.length,
        0
      ),
    },
    {
      Category: "Historical Duplicate Groups",
      Count: skippedCustomers.historicalDuplicates.length,
      "Total Customers": skippedCustomers.historicalDuplicates.reduce(
        (sum, group) => sum + group.customers.length,
        0
      ),
    },
  ];

  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  // Save the file
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `skipped_customers_${timestamp}.xlsx`;
  const filepath = path.join(process.cwd(), filename);

  XLSX.writeFile(workbook, filepath);

  console.log(`Excel report saved: ${filepath}`);
  return filepath;
}

// Bulk update documents
async function bulkUpdateDocuments(Model, filter, updates, modelName) {
  const totalCount = await Model.countDocuments(filter);
  if (totalCount === 0) return 0;

  console.log(`  Updating ${totalCount} ${modelName}...`);
  const progress = createProgressLogger(totalCount, modelName);

  let processed = 0;
  const bulkOps = [];

  // Use cursor for memory efficiency
  const cursor = Model.find(filter, { _id: 1 }).lean().cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: updates },
      },
    });

    // Execute bulk operations in batches
    if (bulkOps.length >= CONFIG.BULK_WRITE_BATCH_SIZE) {
      await Model.bulkWrite(bulkOps, { ordered: false });
      processed += bulkOps.length;
      progress.increment(bulkOps.length);
      bulkOps.length = 0; // Clear array
    }
  }

  // Execute remaining operations
  if (bulkOps.length > 0) {
    await Model.bulkWrite(bulkOps, { ordered: false });
    processed += bulkOps.length;
    progress.increment(bulkOps.length);
  }

  return processed;
}

// Main optimized merge function
async function mergeHistoricalToSAPCustomers() {
  try {
    console.log(
      "Starting optimized customer merge process with exact name matching..."
    );
    const startTime = Date.now();

    // Ensure indexes exist
    if (CONFIG.INDEX_CHECK) {
      await ensureIndexes();
    }

    // Build customer mapping
    const { sapCustomersByName, historicalCustomersByName } =
      await buildCustomerMapping();

    // Identify valid mappings and skipped customers
    const { validMappings, skippedCustomers } = identifyMappingsAndSkips(
      sapCustomersByName,
      historicalCustomersByName
    );

    // Create Excel report for skipped customers
    const reportPath = await createSkippedCustomersReport(skippedCustomers);

    // Track merge statistics
    const mergeStats = {
      totalMerged: 0,
      invoicesUpdated: 0,
      paymentsUpdated: 0,
      productSalesUpdated: 0,
      customersDeleted: 0,
      errors: [],
      skippedSapDuplicates: skippedCustomers.sapDuplicates.reduce(
        (sum, group) => sum + group.customers.length,
        0
      ),
      skippedHistoricalDuplicates: skippedCustomers.historicalDuplicates.reduce(
        (sum, group) => sum + group.customers.length,
        0
      ),
      reportPath,
    };

    console.log(
      `Found ${validMappings.length} valid one-to-one mappings to process`
    );

    // Process merges in batches
    for (let i = 0; i < validMappings.length; i += CONFIG.BATCH_SIZE) {
      const batch = validMappings.slice(
        i,
        Math.min(i + CONFIG.BATCH_SIZE, validMappings.length)
      );
      console.log(
        `\nProcessing batch ${
          Math.floor(i / CONFIG.BATCH_SIZE) + 1
        }/${Math.ceil(validMappings.length / CONFIG.BATCH_SIZE)}`
      );

      // Process each merge in the batch
      for (const { sapCustomer, historicalCustomer } of batch) {
        console.log(
          `\nMerging historical customer into SAP customer: ${sapCustomer.CardName} (${sapCustomer.CardCode})`
        );
        console.log(
          `  Historical customer: ${historicalCustomer.CardName} (${historicalCustomer.CardCode})`
        );

        try {
          const updateData = {
            CardCode: sapCustomer.CardCode,
            Historical: true,
            mergedFrom: historicalCustomer.CardCode,
            mergeDate: new Date(),
          };

          // Update Invoices
          const invoicesUpdated = await bulkUpdateDocuments(
            Invoice,
            { CardCode: historicalCustomer.CardCode },
            updateData,
            "invoices"
          );
          mergeStats.invoicesUpdated += invoicesUpdated;

          // Update Payments
          const paymentsUpdated = await bulkUpdateDocuments(
            Payment,
            { CardCode: historicalCustomer.CardCode },
            updateData,
            "payments"
          );
          mergeStats.paymentsUpdated += paymentsUpdated;

          // Update Customer Product Sales
          const productSalesUpdateData = {
            customerId: sapCustomer.CardCode,
            Historical: true,
            mergedFrom: historicalCustomer.CardCode,
            mergeDate: new Date(),
          };

          const productSalesUpdated = await bulkUpdateDocuments(
            CustomerProductSales,
            { customerId: historicalCustomer.CardCode },
            productSalesUpdateData,
            "product sales"
          );
          mergeStats.productSalesUpdated += productSalesUpdated;

          // Delete historical customer
          await Customer.deleteOne({ _id: historicalCustomer._id });
          mergeStats.customersDeleted++;
          mergeStats.totalMerged++;

          console.log(
            `  ✓ Successfully merged ${historicalCustomer.CardCode} -> ${sapCustomer.CardCode}`
          );
        } catch (error) {
          console.error(
            `  ✗ Error merging ${historicalCustomer.CardCode}:`,
            error.message
          );
          mergeStats.errors.push({
            sapCustomer: sapCustomer.CardCode,
            historicalCustomer: historicalCustomer.CardCode,
            error: error.message,
          });
        }
      }

      // Optional: Add delay between batches to reduce database load
      if (i + CONFIG.BATCH_SIZE < validMappings.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    // Calculate execution time
    const executionTime = (Date.now() - startTime) / 1000;

    // Print final statistics
    console.log("\n========== MERGE COMPLETE ==========");
    console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);
    console.log(`Total customers merged: ${mergeStats.totalMerged}`);
    console.log(`Invoices updated: ${mergeStats.invoicesUpdated}`);
    console.log(`Payments updated: ${mergeStats.paymentsUpdated}`);
    console.log(`Product Sales updated: ${mergeStats.productSalesUpdated}`);
    console.log(`Historical customers deleted: ${mergeStats.customersDeleted}`);
    console.log(
      `SAP customers skipped (duplicates): ${mergeStats.skippedSapDuplicates}`
    );
    console.log(
      `Historical customers skipped (duplicates): ${mergeStats.skippedHistoricalDuplicates}`
    );
    console.log(`Errors encountered: ${mergeStats.errors.length}`);
    console.log(`Excel report saved at: ${mergeStats.reportPath}`);

    if (mergeStats.errors.length > 0) {
      console.log("\nErrors:");
      mergeStats.errors.forEach((err) => {
        console.log(
          `  SAP: ${err.sapCustomer}, Historical: ${err.historicalCustomer}, Error: ${err.error}`
        );
      });
    }

    return mergeStats;
  } catch (error) {
    console.error("Fatal error in merge process:", error);
    throw error;
  }
}

// Optimized dry run function
async function dryRunMerge() {
  try {
    console.log(
      "Starting DRY RUN with exact name matching - No changes will be made..."
    );
    const startTime = Date.now();

    // Build customer mapping
    const { sapCustomersByName, historicalCustomersByName } =
      await buildCustomerMapping();

    // Identify valid mappings and skipped customers
    const { validMappings, skippedCustomers } = identifyMappingsAndSkips(
      sapCustomersByName,
      historicalCustomersByName
    );

    const mergePreview = [];
    let totalDocumentsToUpdate = 0;

    // Analyze valid mappings
    for (const { sapCustomer, historicalCustomer } of validMappings) {
      // Count related documents using lean queries
      const [invoiceCount, paymentCount, productSalesCount] = await Promise.all(
        [
          Invoice.countDocuments({ CardCode: historicalCustomer.CardCode }),
          Payment.countDocuments({ CardCode: historicalCustomer.CardCode }),
          CustomerProductSales.countDocuments({
            customerId: historicalCustomer.CardCode,
          }),
        ]
      );

      const totalDocs = invoiceCount + paymentCount + productSalesCount;
      totalDocumentsToUpdate += totalDocs;

      mergePreview.push({
        sapCustomer: {
          name: sapCustomer.CardName,
          code: sapCustomer.CardCode,
        },
        historicalCustomer: {
          name: historicalCustomer.CardName,
          code: historicalCustomer.CardCode,
        },
        documentsToMerge: {
          invoices: invoiceCount,
          payments: paymentCount,
          productSales: productSalesCount,
          total: totalDocs,
        },
      });
    }

    // Sort by total documents descending to show biggest merges first
    mergePreview.sort(
      (a, b) => b.documentsToMerge.total - a.documentsToMerge.total
    );

    const executionTime = (Date.now() - startTime) / 1000;

    console.log("\n========== DRY RUN RESULTS ==========");
    console.log(`Analysis completed in ${executionTime.toFixed(2)} seconds`);
    console.log(
      `Valid one-to-one merges that would occur: ${mergePreview.length}`
    );
    console.log(
      `Total documents that would be updated: ${totalDocumentsToUpdate.toLocaleString()}`
    );

    // Skipped customers summary
    const skippedSapTotal = skippedCustomers.sapDuplicates.reduce(
      (sum, group) => sum + group.customers.length,
      0
    );
    const skippedHistoricalTotal = skippedCustomers.historicalDuplicates.reduce(
      (sum, group) => sum + group.customers.length,
      0
    );
    console.log(
      `SAP customers that would be skipped (duplicates): ${skippedSapTotal}`
    );
    console.log(
      `Historical customers that would be skipped (duplicates): ${skippedHistoricalTotal}`
    );

    // Show top 10 merges by document count
    console.log("\nTop 10 merges by document count:");
    mergePreview.slice(0, 10).forEach((merge, index) => {
      console.log(`\n${index + 1}. ${merge.sapCustomer.name}`);
      console.log(`   SAP Code: ${merge.sapCustomer.code}`);
      console.log(`   Historical Code: ${merge.historicalCustomer.code}`);
      console.log(
        `   Documents to merge: ${merge.documentsToMerge.total.toLocaleString()}`
      );
      console.log(
        `     - Invoices: ${merge.documentsToMerge.invoices.toLocaleString()}`
      );
      console.log(
        `     - Payments: ${merge.documentsToMerge.payments.toLocaleString()}`
      );
      console.log(
        `     - Product Sales: ${merge.documentsToMerge.productSales.toLocaleString()}`
      );
    });

    if (mergePreview.length > 10) {
      console.log(`\n... and ${mergePreview.length - 10} more merges`);
    }

    // Summary statistics
    const stats = mergePreview.reduce(
      (acc, merge) => {
        acc.invoices += merge.documentsToMerge.invoices;
        acc.payments += merge.documentsToMerge.payments;
        acc.productSales += merge.documentsToMerge.productSales;
        return acc;
      },
      { invoices: 0, payments: 0, productSales: 0 }
    );

    console.log("\n========== SUMMARY ==========");
    console.log(`Total invoices to update: ${stats.invoices.toLocaleString()}`);
    console.log(`Total payments to update: ${stats.payments.toLocaleString()}`);
    console.log(
      `Total product sales to update: ${stats.productSales.toLocaleString()}`
    );
    console.log(`Total historical customers to delete: ${mergePreview.length}`);

    // Show some examples of skipped customers
    if (skippedCustomers.sapDuplicates.length > 0) {
      console.log(`\nExample SAP duplicate groups (showing first 3):`);
      skippedCustomers.sapDuplicates.slice(0, 3).forEach((group, index) => {
        console.log(
          `${index + 1}. "${group.name}" - ${
            group.customers.length
          } SAP customers`
        );
        group.customers.forEach((customer) => {
          console.log(`   - ${customer.cardCode}`);
        });
      });
    }

    if (skippedCustomers.historicalDuplicates.length > 0) {
      console.log(`\nExample historical duplicate groups (showing first 3):`);
      skippedCustomers.historicalDuplicates
        .slice(0, 3)
        .forEach((group, index) => {
          console.log(
            `${index + 1}. "${group.name}" - ${
              group.customers.length
            } historical customers`
          );
          group.customers.forEach((customer) => {
            console.log(`   - ${customer.cardCode}`);
          });
        });
    }

    return { mergePreview, skippedCustomers };
  } catch (error) {
    console.error("Error in dry run:", error);
    throw error;
  }
}

// Get collection statistics
async function getCollectionStats() {
  console.log("Fetching collection statistics...");

  const [customerCount, invoiceCount, paymentCount, productSalesCount] =
    await Promise.all([
      Customer.countDocuments(),
      Invoice.countDocuments(),
      Payment.countDocuments(),
      CustomerProductSales.countDocuments(),
    ]);

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
  console.log(`Total invoices: ${invoiceCount.toLocaleString()}`);
  console.log(`Total payments: ${paymentCount.toLocaleString()}`);
  console.log(`Total product sales: ${productSalesCount.toLocaleString()}`);

  return {
    customerCount,
    sapCustomerCount,
    historicalCustomerCount,
    invoiceCount,
    paymentCount,
    productSalesCount,
  };
}

// Export functions
module.exports = {
  mergeHistoricalToSAPCustomers,
  dryRunMerge,
  getCollectionStats,
  isSAPCustomer,
  CONFIG,
};

// Example usage:
// const { mergeHistoricalToSAPCustomers, dryRunMerge, getCollectionStats, CONFIG } = require('./customerMergeScript');
//
// // Adjust configuration if needed
// CONFIG.BATCH_SIZE = 50; // Process 50 customers at a time
// CONFIG.BULK_WRITE_BATCH_SIZE = 500; // Smaller bulk writes for lower memory usage
//
// // First check collection statistics
// await getCollectionStats();
//
// // Run a dry run to see what would be merged
// await dryRunMerge();
//
// // Then run the actual merge
// await mergeHistoricalToSAPCustomers();
