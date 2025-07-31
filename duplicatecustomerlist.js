const mongoose = require("mongoose");
const XLSX = require("xlsx");
const path = require("path");
const Customer = require("./models/Customer");

// Configuration
const CONFIG = {
  PROGRESS_LOG_INTERVAL: 100, // Log progress every 100 customers
  USE_LEAN: true, // Use lean queries for better performance
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
        const remaining = total > processed ? (total - processed) / rate : 0;
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

// Build customer mapping to identify duplicates
async function buildCustomerMapping() {
  console.log("Building customer mapping to identify duplicates...");

  const sapCustomersByName = new Map();
  const historicalCustomersByName = new Map();

  // Get total count for progress tracking
  const totalCustomers = await Customer.countDocuments({});
  console.log(
    `Processing ${totalCustomers.toLocaleString()} total customers...`
  );

  const progress = createProgressLogger(totalCustomers, "customers processed");

  // Use cursor for memory efficiency
  const cursor = Customer.find({}).lean().cursor();

  for (
    let customer = await cursor.next();
    customer != null;
    customer = await cursor.next()
  ) {
    progress.increment();

    const customerData = {
      _id: customer._id,
      CardCode: customer.CardCode || "N/A",
      CardName: customer.CardName || "N/A",
    };

    if (customer.CardCode && isSAPCustomer(customer.CardCode)) {
      // SAP Customer - group by exact CardName
      const exactName = customer.CardName || "";
      if (exactName) {
        if (!sapCustomersByName.has(exactName)) {
          sapCustomersByName.set(exactName, []);
        }
        sapCustomersByName.get(exactName).push(customerData);
      }
    } else {
      // Historical Customer - group by exact CardName
      const exactName = customer.CardName || "";
      if (exactName) {
        if (!historicalCustomersByName.has(exactName)) {
          historicalCustomersByName.set(exactName, []);
        }
        historicalCustomersByName.get(exactName).push(customerData);
      }
    }
  }

  console.log(`Found ${sapCustomersByName.size} unique SAP customer names`);
  console.log(
    `Found ${historicalCustomersByName.size} unique historical customer names`
  );

  return { sapCustomersByName, historicalCustomersByName };
}

// Identify all duplicate customers
function identifyAllDuplicates(sapCustomersByName, historicalCustomersByName) {
  console.log("Identifying all duplicate customers...");

  const sapDuplicates = [];
  const historicalDuplicates = [];
  const allSapCustomers = [];
  const allHistoricalCustomers = [];

  // Process SAP customers
  for (const [exactName, sapCustomers] of sapCustomersByName) {
    // Add all SAP customers to the complete list
    sapCustomers.forEach((customer) => {
      allSapCustomers.push({
        ...customer,
        GroupName: exactName,
        IsDuplicate: sapCustomers.length > 1,
        DuplicateCount: sapCustomers.length,
        CustomerType: "SAP",
      });
    });

    // If duplicates exist, add to duplicates list
    if (sapCustomers.length > 1) {
      sapDuplicates.push({
        name: exactName,
        customers: sapCustomers,
        count: sapCustomers.length,
        reason: "Multiple SAP customers with same name",
      });
    }
  }

  // Process Historical customers
  for (const [exactName, historicalCustomers] of historicalCustomersByName) {
    // Add all historical customers to the complete list
    historicalCustomers.forEach((customer) => {
      allHistoricalCustomers.push({
        ...customer,
        GroupName: exactName,
        IsDuplicate: historicalCustomers.length > 1,
        DuplicateCount: historicalCustomers.length,
        CustomerType: "Historical",
      });
    });

    // If duplicates exist, add to duplicates list
    if (historicalCustomers.length > 1) {
      historicalDuplicates.push({
        name: exactName,
        customers: historicalCustomers,
        count: historicalCustomers.length,
        reason: "Multiple historical customers with same name",
      });
    }
  }

  console.log(`Found ${sapDuplicates.length} SAP duplicate groups`);
  console.log(
    `Found ${historicalDuplicates.length} historical duplicate groups`
  );
  console.log(`Total SAP customers: ${allSapCustomers.length}`);
  console.log(`Total Historical customers: ${allHistoricalCustomers.length}`);

  return {
    sapDuplicates,
    historicalDuplicates,
    allSapCustomers,
    allHistoricalCustomers,
  };
}

// Create comprehensive Excel report
async function createComprehensiveExcelReport(duplicateData) {
  console.log("Creating comprehensive Excel report...");

  const {
    sapDuplicates,
    historicalDuplicates,
    allSapCustomers,
    allHistoricalCustomers,
  } = duplicateData;
  const workbook = XLSX.utils.book_new();

  // 1. SAP Duplicates Sheet (detailed)
  const sapDuplicatesData = [];
  sapDuplicates.forEach((group) => {
    group.customers.forEach((customer, index) => {
      sapDuplicatesData.push({
        "Group Name": group.name,
        "Customer Number": index + 1,
        "Total in Group": group.count,
        "Card Code": customer.CardCode,
        "Card Name": customer.CardName,
        "Customer ID": customer._id.toString(),
        Reason: group.reason,
      });
    });
  });

  if (sapDuplicatesData.length > 0) {
    const sapDuplicatesSheet = XLSX.utils.json_to_sheet(sapDuplicatesData);
    XLSX.utils.book_append_sheet(
      workbook,
      sapDuplicatesSheet,
      "SAP Duplicates"
    );
  }

  // 2. Historical Duplicates Sheet (detailed)
  const historicalDuplicatesData = [];
  historicalDuplicates.forEach((group) => {
    group.customers.forEach((customer, index) => {
      historicalDuplicatesData.push({
        "Group Name": group.name,
        "Customer Number": index + 1,
        "Total in Group": group.count,
        "Card Code": customer.CardCode,
        "Card Name": customer.CardName,
        "Customer ID": customer._id.toString(),
        Reason: group.reason,
      });
    });
  });

  if (historicalDuplicatesData.length > 0) {
    const historicalDuplicatesSheet = XLSX.utils.json_to_sheet(
      historicalDuplicatesData
    );
    XLSX.utils.book_append_sheet(
      workbook,
      historicalDuplicatesSheet,
      "Historical Duplicates"
    );
  }

  // 3. All SAP Customers Sheet
  const allSapSheet = XLSX.utils.json_to_sheet(
    allSapCustomers.map((customer) => ({
      "Card Code": customer.CardCode,
      "Card Name": customer.CardName,
      "Customer ID": customer._id.toString(),
      "Is Duplicate": customer.IsDuplicate ? "Yes" : "No",
      "Duplicate Count": customer.DuplicateCount,
    }))
  );
  XLSX.utils.book_append_sheet(workbook, allSapSheet, "All SAP Customers");

  // 4. All Historical Customers Sheet
  const allHistoricalSheet = XLSX.utils.json_to_sheet(
    allHistoricalCustomers.map((customer) => ({
      "Card Code": customer.CardCode,
      "Card Name": customer.CardName,
      "Customer ID": customer._id.toString(),
      "Is Duplicate": customer.IsDuplicate ? "Yes" : "No",
      "Duplicate Count": customer.DuplicateCount,
    }))
  );
  XLSX.utils.book_append_sheet(
    workbook,
    allHistoricalSheet,
    "All Historical Customers"
  );

  // 5. Summary Sheet
  const summaryData = [
    {
      Category: "SAP Customers",
      "Total Count": allSapCustomers.length,
      "Unique Names": [...new Set(allSapCustomers.map((c) => c.CardName))]
        .length,
      "Duplicate Groups": sapDuplicates.length,
      "Customers in Duplicates": sapDuplicatesData.length,
    },
    {
      Category: "Historical Customers",
      "Total Count": allHistoricalCustomers.length,
      "Unique Names": [
        ...new Set(allHistoricalCustomers.map((c) => c.CardName)),
      ].length,
      "Duplicate Groups": historicalDuplicates.length,
      "Customers in Duplicates": historicalDuplicatesData.length,
    },
    {
      Category: "Combined Total",
      "Total Count": allSapCustomers.length + allHistoricalCustomers.length,
      "Unique Names": [
        ...new Set([
          ...allSapCustomers.map((c) => c.CardName),
          ...allHistoricalCustomers.map((c) => c.CardName),
        ]),
      ].length,
      "Duplicate Groups": sapDuplicates.length + historicalDuplicates.length,
      "Customers in Duplicates":
        sapDuplicatesData.length + historicalDuplicatesData.length,
    },
  ];

  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  // 6. Duplicate Groups Summary
  const duplicateGroupsSummary = [
    ...sapDuplicates.map((group) => ({
      "Customer Type": "SAP",
      "Group Name": group.name,
      "Duplicate Count": group.count,
      "Card Codes": group.customers.map((c) => c.CardCode).join(", "),
      Reason: group.reason,
    })),
    ...historicalDuplicates.map((group) => ({
      "Customer Type": "Historical",
      "Group Name": group.name,
      "Duplicate Count": group.count,
      "Card Codes": group.customers.map((c) => c.CardCode).join(", "),
      Reason: group.reason,
    })),
  ];

  if (duplicateGroupsSummary.length > 0) {
    const duplicateGroupsSheet = XLSX.utils.json_to_sheet(
      duplicateGroupsSummary
    );
    XLSX.utils.book_append_sheet(
      workbook,
      duplicateGroupsSheet,
      "Duplicate Groups Summary"
    );
  }

  // Save the file
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `complete_customer_duplicates_report_${timestamp}.xlsx`;
  const filepath = path.join(process.cwd(), filename);

  XLSX.writeFile(workbook, filepath);

  console.log(`Comprehensive Excel report saved: ${filepath}`);
  return {
    filepath,
    summary: {
      totalSapCustomers: allSapCustomers.length,
      totalHistoricalCustomers: allHistoricalCustomers.length,
      sapDuplicateGroups: sapDuplicates.length,
      historicalDuplicateGroups: historicalDuplicates.length,
      sapCustomersInDuplicates: sapDuplicatesData.length,
      historicalCustomersInDuplicates: historicalDuplicatesData.length,
    },
  };
}

// Main function to generate comprehensive customer duplicates report
async function generateComprehensiveCustomerReport() {
  try {
    console.log(
      "Starting comprehensive customer duplicates report generation..."
    );
    const startTime = Date.now();

    // Build customer mapping
    const { sapCustomersByName, historicalCustomersByName } =
      await buildCustomerMapping();

    // Identify all duplicates and get complete customer lists
    const duplicateData = identifyAllDuplicates(
      sapCustomersByName,
      historicalCustomersByName
    );

    // Create comprehensive Excel report
    const result = await createComprehensiveExcelReport(duplicateData);

    // Calculate execution time
    const executionTime = (Date.now() - startTime) / 1000;

    // Print final statistics
    console.log("\n========== REPORT GENERATION COMPLETE ==========");
    console.log(`Execution time: ${executionTime.toFixed(2)} seconds`);
    console.log(`Report saved at: ${result.filepath}`);
    console.log(`\nSummary:`);
    console.log(
      `- Total SAP customers: ${result.summary.totalSapCustomers.toLocaleString()}`
    );
    console.log(
      `- Total Historical customers: ${result.summary.totalHistoricalCustomers.toLocaleString()}`
    );
    console.log(`- SAP duplicate groups: ${result.summary.sapDuplicateGroups}`);
    console.log(
      `- Historical duplicate groups: ${result.summary.historicalDuplicateGroups}`
    );
    console.log(
      `- SAP customers in duplicates: ${result.summary.sapCustomersInDuplicates}`
    );
    console.log(
      `- Historical customers in duplicates: ${result.summary.historicalCustomersInDuplicates}`
    );

    return result;
  } catch (error) {
    console.error("Fatal error in report generation:", error);
    throw error;
  }
}

// Export the main function
module.exports = {
  generateComprehensiveCustomerReport,
  isSAPCustomer,
  CONFIG,
};

// Example usage:
// const { generateComprehensiveCustomerReport } = require('./duplicateCustomersExcelGenerator');
//
// // Generate the comprehensive report
// generateComprehensiveCustomerReport()
//   .then(result => {
//     console.log('Report generated successfully:', result.filepath);
//   })
//   .catch(error => {
//     console.error('Error generating report:', error);
//   });
