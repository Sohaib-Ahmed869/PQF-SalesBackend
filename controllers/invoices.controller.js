const Invoice = require("../models/Invoice");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
exports.bulkImportInvoices = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file is required",
      });
    }

    const startTime = Date.now();
    console.log("Starting Excel import...");

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, {
      cellDates: true,
      cellNF: true,
      cellStyles: true,
    });

    // Get the first worksheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with headers
    const excelRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    if (excelRows.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Excel file must contain headers and data rows",
      });
    }

    // Extract headers and data
    const headers = excelRows[0];
    const dataRows = excelRows.slice(1);

    // Convert to objects using headers
    const processedRows = dataRows.map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || "";
      });
      return obj;
    });

    console.log(`Parsed ${processedRows.length} rows from Excel`);

    // Group Excel rows by Document Internal ID to create invoice documents
    const invoiceGroups = {};

    processedRows.forEach((row) => {
      const docId = row["Document Internal ID"];
      if (!docId) return;

      if (!invoiceGroups[docId]) {
        invoiceGroups[docId] = {
          mainData: row,
          lines: [],
        };
      }

      // Add line item if it has valid data
      if (row["Item No."] && row["Item/Service Description"]) {
        invoiceGroups[docId].lines.push({
          LineNum: row["Row Number"] || 0,
          ItemCode: row["Item No."],
          ItemDescription: row["Item/Service Description"],
          Quantity: row["Quantity"] || 0,
          Price: row["Unit Price"] || 0,
          PriceAfterVAT: row["Gross Price after Discount"] || 0,
          Currency: row["Price Currency"] || "EUR",
          LineTotal: row["Row Total"] || 0,
          VatGroup: null,
        });
      }
    });

    const totalInvoices = Object.keys(invoiceGroups).length;
    console.log(`Grouped into ${totalInvoices} invoices`);

    // Get existing DocEntry values in bulk
    const docEntries = Object.keys(invoiceGroups).map((id) => parseInt(id));
    const existingInvoices = await Invoice.find(
      { DocEntry: { $in: docEntries } },
      { DocEntry: 1 }
    ).lean();

    const existingDocEntries = new Set(
      existingInvoices.map((inv) => inv.DocEntry)
    );
    console.log(`Found ${existingDocEntries.size} existing invoices`);

    // Prepare new invoices for bulk insert
    const newInvoices = [];

    Object.entries(invoiceGroups).forEach(([docId, group]) => {
      const docEntry = parseInt(docId);

      // Skip if invoice already exists
      if (existingDocEntries.has(docEntry)) {
        return;
      }

      const row = group.mainData;

      // Parse dates - handle Excel date formats
      const parseDate = (dateValue) => {
        if (!dateValue) return null;

        // If it's already a Date object (from Excel)
        if (dateValue instanceof Date) {
          return dateValue;
        }

        // If it's a string, try to parse it
        if (typeof dateValue === "string") {
          const parts = dateValue.split("/");
          if (parts.length === 3) {
            return new Date(
              `20${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(
                2,
                "0"
              )}`
            );
          }
          return new Date(dateValue);
        }

        // If it's a number (Excel serial date)
        if (typeof dateValue === "number") {
          return XLSX.SSF.parse_date_code(dateValue);
        }

        return new Date(dateValue);
      };

      // Determine payment status
      const docTotal = parseFloat(row["Document Total"]) || 0;
      const paidToDate = parseFloat(row["Paid to Date"]) || 0;
      const isPaid = Math.abs(docTotal - paidToDate) < 0.01;

      // Create invoice document
      const invoice = {
        // Required fields
        DocEntry: docEntry,
        DocNum: parseInt(row["Document Number"]) || docEntry,

        // Customer info
        CardCode: row["Customer/Supplier No."] || "",
        CardName: row["Customer/Supplier Name"] || "",

        // Financial data
        DocTotal: docTotal,
        PaidToDate: paidToDate,
        DocCurrency: row["Price Currency"] || "EUR",

        // Dates
        DocDate: parseDate(row["Posting Date"]),
        CreationDate: parseDate(row["Posting Date"]),

        // Address
        Address: row["Ship-to Description"] || "",

        // Custom fields for tracking
        verified: isPaid,
        dateStored: new Date(),
        tag: "External Delivery", // Default assumption
        paymentMethod: isPaid ? "POS-Cash" : "Unknown",
        isPOS: false,
        isDelivery: true,

        // Document lines
        DocumentLines: group.lines,

        // Additional computed fields
        VatSum: parseFloat(row["Total Tax"]) || 0,
        Cancelled: "N",
        DocumentStatus: isPaid ? "C" : "O",
      };

      newInvoices.push(invoice);
    });

    console.log(`Prepared ${newInvoices.length} new invoices for import`);

    // Bulk insert new invoices
    let insertedCount = 0;
    let insertedDocNums = [];
    if (newInvoices.length > 0) {
      try {
        const result = await Invoice.insertMany(newInvoices, {
          ordered: false, // Continue even if some fail
          lean: true,
        });
        insertedCount = result.length;
        insertedDocNums = result.map((invoice) => invoice.DocNum);
        console.log(`Successfully inserted ${insertedCount} invoices`);
      } catch (error) {
        // Handle partial success in bulk insert
        if (error.writeErrors) {
          insertedCount = newInvoices.length - error.writeErrors.length;
          // Get DocNums of successfully inserted invoices
          const failedIndices = new Set(
            error.writeErrors.map((err) => err.index)
          );
          insertedDocNums = newInvoices
            .filter((_, index) => !failedIndices.has(index))
            .map((invoice) => invoice.DocNum);
          console.log(
            `Partial success: ${insertedCount} inserted, ${error.writeErrors.length} failed`
          );
        } else {
          throw error;
        }
      }
    }

    const endTime = Date.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);

    return res.status(200).json({
      success: true,
      message: "Excel import completed",
      data: {
        totalRowsProcessed: processedRows.length,
        totalInvoicesInExcel: totalInvoices,
        existingInvoices: existingDocEntries.size,
        newInvoicesInserted: insertedCount,
        skippedInvoices: totalInvoices - insertedCount,
        processingTimeSeconds: processingTime,
        insertedInvoiceDocNums: insertedDocNums,
      },
    });
  } catch (error) {
    console.error("Error in bulk import:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to import Excel file",
      error: error.message,
    });
  }
};

/**
 * Get invoices for a specific customer with pagination, sorting, and filtering
 */
exports.getInvoicesByCustomer = async (req, res) => {
  try {
    const {
      customerId, // CardCode of the customer
      page = 1, // Current page
      limit = 10, // Items per page
      sortBy = "DocDate", // Sort field
      sortOrder = -1, // Sort order (1: ascending, -1: descending)
      startDate, // Filter by date range
      endDate,
      paymentMethod, // Filter by payment method
      isPaid, // Filter by payment status
      minAmount, // Filter by amount range
      maxAmount,
      isVerified, // Filter by verification status
      search, // Search in invoice number, comments, etc.
    } = req.query;

    // Validate customer ID
    if (!customerId) {
      return res
        .status(400)
        .json({ success: false, message: "Customer ID is required" });
    }

    // Build filter object
    const filter = { CardCode: customerId };

    // Add date range filter if provided
    if (startDate && endDate) {
      filter.DocDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Add payment method filter if provided
    if (paymentMethod) {
      filter.paymentMethod = paymentMethod;
    }

    // Add verification status filter if provided
    if (isVerified !== undefined) {
      filter.verified = isVerified === "true";
    }

    // Add amount range filter if provided
    if (minAmount || maxAmount) {
      filter.DocTotal = {};
      if (minAmount) filter.DocTotal.$gte = Number(minAmount);
      if (maxAmount) filter.DocTotal.$lte = Number(maxAmount);
    }

    // Add payment status filter if provided
    if (isPaid !== undefined) {
      // Assuming paid status is determined by PaidToDate being equal to DocTotal
      if (isPaid === "true") {
        filter.$expr = { $eq: ["$PaidToDate", "$DocTotal"] };
      } else {
        filter.$expr = { $lt: ["$PaidToDate", "$DocTotal"] };
      }
    }

    // Add search filter if provided
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { DocNum: isNaN(search) ? searchRegex : Number(search) },
        { NumAtCard: searchRegex },
        { Comments: searchRegex },
        { Reference1: searchRegex },
        { Reference2: searchRegex },
      ];
    }

    // Calculate pagination values
    const skip = (Number(page) - 1) * Number(limit);

    // Define sort options
    const sort = {};
    sort[sortBy] = Number(sortOrder);

    // Execute query with pagination
    const invoices = await Invoice.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // Get total count for pagination
    const totalCount = await Invoice.countDocuments(filter);

    // Calculate KPIs
    const kpis = await calculateCustomerKPIs(customerId);

    return res.status(200).json({
      success: true,
      data: {
        invoices,
        pagination: {
          totalCount,
          totalPages: Math.ceil(totalCount / Number(limit)),
          currentPage: Number(page),
          pageSize: Number(limit),
          hasNext: Number(page) < Math.ceil(totalCount / Number(limit)),
          hasPrevious: Number(page) > 1,
        },
        kpis,
      },
    });
  } catch (error) {
    console.error("Error fetching invoices by customer:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch invoices",
      error: error.message,
    });
  }
};

/**
 * Calculate various KPIs for a specific customer
 */
const calculateCustomerKPIs = async (customerId) => {
  try {
    // Aggregation pipeline to calculate KPIs
    const pipeline = [
      { $match: { CardCode: customerId } },
      {
        $facet: {
          // Total invoices and amount
          totalStats: [
            {
              $group: {
                _id: null,
                invoiceCount: { $sum: 1 },
                totalAmount: { $sum: "$DocTotal" },
                totalPaid: { $sum: "$PaidToDate" },
                averageAmount: { $avg: "$DocTotal" },
                maxAmount: { $max: "$DocTotal" },
                minAmount: { $min: "$DocTotal" },
              },
            },
          ],

          // Unpaid invoices
          unpaidStats: [
            {
              $match: {
                $expr: { $lt: ["$PaidToDate", "$DocTotal"] },
              },
            },
            {
              $group: {
                _id: null,
                unpaidCount: { $sum: 1 },
                unpaidAmount: {
                  $sum: { $subtract: ["$DocTotal", "$PaidToDate"] },
                },
              },
            },
          ],

          // Monthly trends (last 6 months)
          monthlyTrends: [
            {
              $match: {
                DocDate: {
                  $gte: new Date(
                    new Date().setMonth(new Date().getMonth() - 6)
                  ),
                },
              },
            },
            {
              $group: {
                _id: {
                  year: { $year: "$DocDate" },
                  month: { $month: "$DocDate" },
                },
                invoiceCount: { $sum: 1 },
                totalAmount: { $sum: "$DocTotal" },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
          ],

          // Payment method distribution
          paymentMethods: [
            {
              $group: {
                _id: "$paymentMethod",
                count: { $sum: 1 },
                amount: { $sum: "$DocTotal" },
              },
            },
          ],

          // POS vs Delivery distribution
          channelDistribution: [
            {
              $group: {
                _id: {
                  isPOS: "$isPOS",
                  isDelivery: "$isDelivery",
                },
                count: { $sum: 1 },
                amount: { $sum: "$DocTotal" },
              },
            },
          ],

          // Items purchased (top 5)
          topItems: [
            { $unwind: "$DocumentLines" },
            {
              $group: {
                _id: "$DocumentLines.ItemCode",
                itemName: { $first: "$DocumentLines.ItemDescription" },
                quantity: { $sum: "$DocumentLines.Quantity" },
                revenue: {
                  $sum: {
                    $multiply: [
                      "$DocumentLines.Price",
                      "$DocumentLines.Quantity",
                    ],
                  },
                },
                occurrences: { $sum: 1 },
              },
            },
            { $sort: { revenue: -1 } },
            { $limit: 5 },
          ],
        },
      },
    ];

    const results = await Invoice.aggregate(pipeline).allowDiskUse(true);
    // Format the results
    const kpiResult = {
      // Default values in case no data is found
      totalInvoices: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalUnpaid: 0,
      unpaidInvoices: 0,
      averageInvoiceAmount: 0,
      paymentMethodDistribution: [],
      channelDistribution: {
        pos: { count: 0, amount: 0 },
        delivery: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
      },
      monthlyTrends: [],
      topItems: [],
    };

    // Extract and format total stats
    if (results[0].totalStats.length > 0) {
      const stats = results[0].totalStats[0];
      kpiResult.totalInvoices = stats.invoiceCount;
      kpiResult.totalAmount = stats.totalAmount;
      kpiResult.totalPaid = stats.totalPaid;
      kpiResult.averageInvoiceAmount = stats.averageAmount;
      kpiResult.highestInvoice = stats.maxAmount;
      kpiResult.lowestInvoice = stats.minAmount;
    }

    // Extract and format unpaid stats
    if (results[0].unpaidStats.length > 0) {
      const unpaid = results[0].unpaidStats[0];
      kpiResult.unpaidInvoices = unpaid.unpaidCount;
      kpiResult.totalUnpaid = unpaid.unpaidAmount;
    }

    // Format payment method distribution
    kpiResult.paymentMethodDistribution = results[0].paymentMethods.map(
      (item) => ({
        method: item._id || "Unknown",
        count: item.count,
        amount: item.amount,
        percentage: kpiResult.totalInvoices
          ? ((item.count / kpiResult.totalInvoices) * 100).toFixed(2)
          : 0,
      })
    );

    // Format channel distribution
    results[0].channelDistribution.forEach((item) => {
      if (item._id.isPOS) {
        kpiResult.channelDistribution.pos.count = item.count;
        kpiResult.channelDistribution.pos.amount = item.amount;
      } else if (item._id.isDelivery) {
        kpiResult.channelDistribution.delivery.count = item.count;
        kpiResult.channelDistribution.delivery.amount = item.amount;
      } else {
        kpiResult.channelDistribution.other.count = item.count;
        kpiResult.channelDistribution.other.amount = item.amount;
      }
    });

    // Format monthly trends
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    kpiResult.monthlyTrends = results[0].monthlyTrends.map((item) => ({
      month: months[item._id.month - 1],
      year: item._id.year,
      count: item.invoiceCount,
      amount: item.totalAmount,
    }));

    // Format top items
    kpiResult.topItems = results[0].topItems.map((item) => ({
      itemCode: item._id,
      itemName: item.itemName,
      quantity: item.quantity,
      revenue: item.revenue,
      occurrences: item.occurrences,
    }));

    // Calculate payment status KPIs
    kpiResult.paymentStatus = {
      paid: kpiResult.totalInvoices - kpiResult.unpaidInvoices,
      unpaid: kpiResult.unpaidInvoices,
      paidPercentage: kpiResult.totalInvoices
        ? (
            ((kpiResult.totalInvoices - kpiResult.unpaidInvoices) /
              kpiResult.totalInvoices) *
            100
          ).toFixed(2)
        : 0,
      unpaidPercentage: kpiResult.totalInvoices
        ? ((kpiResult.unpaidInvoices / kpiResult.totalInvoices) * 100).toFixed(
            2
          )
        : 0,
      collectionRate: kpiResult.totalAmount
        ? ((kpiResult.totalPaid / kpiResult.totalAmount) * 100).toFixed(2)
        : 0,
    };

    return kpiResult;
  } catch (error) {
    console.error("Error calculating customer KPIs:", error);
    return {
      error: "Failed to calculate KPIs",
      details: error.message,
    };
  }
};

/**
 * Get customer summary with KPIs for all customers
 */
exports.getCustomersSummary = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "totalAmount",
      sortOrder = -1,
      search,
      minInvoices,
      minAmount,
    } = req.query;

    // Pipeline to aggregate customer data
    const pipeline = [
      // Group by customer
      {
        $group: {
          _id: "$CardCode",
          customerName: { $first: "$CardName" },
          totalInvoices: { $sum: 1 },
          totalAmount: { $sum: "$DocTotal" },
          totalPaid: { $sum: "$PaidToDate" },
          lastInvoiceDate: { $max: "$DocDate" },
          firstInvoiceDate: { $min: "$DocDate" },
          posCount: {
            $sum: { $cond: [{ $eq: ["$isPOS", true] }, 1, 0] },
          },
          deliveryCount: {
            $sum: { $cond: [{ $eq: ["$isDelivery", true] }, 1, 0] },
          },
        },
      },

      // Add derived fields
      {
        $addFields: {
          totalUnpaid: { $subtract: ["$totalAmount", "$totalPaid"] },
          posPercentage: {
            $multiply: [{ $divide: ["$posCount", "$totalInvoices"] }, 100],
          },
          deliveryPercentage: {
            $multiply: [{ $divide: ["$deliveryCount", "$totalInvoices"] }, 100],
          },
          averageInvoiceValue: { $divide: ["$totalAmount", "$totalInvoices"] },
          daysSinceLastInvoice: {
            $divide: [
              { $subtract: [new Date(), "$lastInvoiceDate"] },
              1000 * 60 * 60 * 24,
            ],
          },
          customerTenure: {
            $divide: [
              { $subtract: [new Date(), "$firstInvoiceDate"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
    ];

    // Add search filter if provided
    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { _id: new RegExp(search, "i") },
            { customerName: new RegExp(search, "i") },
          ],
        },
      });
    }

    // Add min invoices filter if provided
    if (minInvoices) {
      pipeline.push({
        $match: { totalInvoices: { $gte: parseInt(minInvoices) } },
      });
    }

    // Add min amount filter if provided
    if (minAmount) {
      pipeline.push({
        $match: { totalAmount: { $gte: parseFloat(minAmount) } },
      });
    }

    // Count total results for pagination before applying skip and limit
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: "total" });

    // Add sorting
    pipeline.push({ $sort: { [sortBy]: parseInt(sortOrder) } });

    // Add pagination
    pipeline.push(
      { $skip: (parseInt(page) - 1) * parseInt(limit) },
      { $limit: parseInt(limit) }
    );

    // Execute both queries
    const [customers, countResult] = await Promise.all([
      Invoice.aggregate(pipeline).allowDiskUse(true),
      Invoice.aggregate(countPipeline).allowDiskUse(true),
    ]);
    const totalCount = countResult.length > 0 ? countResult[0].total : 0;

    return res.status(200).json({
      success: true,
      data: {
        customers,
        pagination: {
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          currentPage: parseInt(page),
          pageSize: parseInt(limit),
          hasNext: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
          hasPrevious: parseInt(page) > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching customers summary:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers summary",
      error: error.message,
    });
  }
};

/**
 * Get global KPIs for all invoices
 */
exports.getGlobalKPIs = async (req, res) => {
  try {
    // Extract date range parameters from the request
    const { startDate, endDate } = req.query;

    // Create a date filter that will be applied to all relevant pipelines
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.DocDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
      console.log("Date filter applied:", dateFilter);
    }

    // Initialize result object
    const kpiResult = {
      totalInvoices: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalUnpaid: 0,
      averageInvoiceAmount: 0,
      uniqueCustomerCount: 0,
      averageRevenuePerCustomer: 0,
      collectionRate: 0,
      paymentMethodDistribution: [],
      channelDistribution: {
        pos: { count: 0, amount: 0 },
        delivery: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
      },
      monthlyTrends: [],
      topCustomers: [],
      topProducts: [],
    };

    // 1. Total statistics - more efficient without $addToSet for all customers
    const totalStatsPipeline = [
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalAmount: { $sum: "$DocTotal" },
          totalPaid: { $sum: "$PaidToDate" },
          averageAmount: { $avg: "$DocTotal" },
        },
      },
    ];

    // 2. Count unique customers separately with a more efficient approach
    const uniqueCustomersPipeline = [
      { $match: dateFilter },
      { $group: { _id: "$CardCode" } },
      { $count: "uniqueCustomerCount" },
    ];

    // 3. Channel distribution
    const channelStatsPipeline = [
      { $match: dateFilter },
      {
        $group: {
          _id: {
            isPOS: "$isPOS",
            isDelivery: "$isDelivery",
          },
          count: { $sum: 1 },
          amount: { $sum: "$DocTotal" },
        },
      },
    ];

    // 4. Monthly trends (using date filter instead of hardcoded 12 months)
    const monthlyTrendsPipeline = [
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: "$DocDate" },
            month: { $month: "$DocDate" },
          },
          invoiceCount: { $sum: 1 },
          totalAmount: { $sum: "$DocTotal" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ];

    // 5. Payment method distribution
    const paymentMethodsPipeline = [
      { $match: dateFilter },
      {
        $group: {
          _id: "$paymentMethod",
          count: { $sum: 1 },
          amount: { $sum: "$DocTotal" },
        },
      },
    ];

    // 6. Top customers by revenue
    const topCustomersPipeline = [
      { $match: dateFilter },
      {
        $group: {
          _id: "$CardCode",
          customerName: { $first: "$CardName" },
          invoiceCount: { $sum: 1 },
          totalAmount: { $sum: "$DocTotal" },
        },
      },
      { $sort: { totalAmount: -1 } },
      { $limit: 50 },
    ];

    // 7. Top products by revenue - process in smaller chunks
    const topProductsPipeline = [
      { $match: dateFilter },
      { $unwind: "$DocumentLines" },
      {
        $group: {
          _id: "$DocumentLines.ItemCode",
          itemName: { $first: "$DocumentLines.ItemDescription" },
          quantity: { $sum: "$DocumentLines.Quantity" },
          revenue: {
            $sum: {
              $multiply: ["$DocumentLines.Price", "$DocumentLines.Quantity"],
            },
          },
          occurrences: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 50 },
    ];

    // Execute all queries in parallel for better performance
    const [
      totalStatsResults,
      uniqueCustomersResults,
      channelStatsResults,
      monthlyTrendsResults,
      paymentMethodsResults,
      topCustomersResults,
      topProductsResults,
    ] = await Promise.all([
      Invoice.aggregate(totalStatsPipeline).allowDiskUse(true),
      Invoice.aggregate(uniqueCustomersPipeline).allowDiskUse(true),
      Invoice.aggregate(channelStatsPipeline).allowDiskUse(true),
      Invoice.aggregate(monthlyTrendsPipeline).allowDiskUse(true),
      Invoice.aggregate(paymentMethodsPipeline).allowDiskUse(true),
      Invoice.aggregate(topCustomersPipeline).allowDiskUse(true),
      Invoice.aggregate(topProductsPipeline).allowDiskUse(true),
    ]);

    // Extract and format total stats
    if (totalStatsResults.length > 0) {
      const stats = totalStatsResults[0];
      kpiResult.totalInvoices = stats.totalInvoices;
      kpiResult.totalAmount = stats.totalAmount;
      kpiResult.totalPaid = stats.totalPaid;
      kpiResult.totalUnpaid = stats.totalAmount - stats.totalPaid;
      kpiResult.averageInvoiceAmount = stats.averageAmount;

      // Get unique customer count
      kpiResult.uniqueCustomerCount =
        uniqueCustomersResults.length > 0
          ? uniqueCustomersResults[0].uniqueCustomerCount
          : 0;

      // Calculate derived metrics
      kpiResult.averageRevenuePerCustomer = kpiResult.uniqueCustomerCount
        ? kpiResult.totalAmount / kpiResult.uniqueCustomerCount
        : 0;

      kpiResult.collectionRate = kpiResult.totalAmount
        ? ((kpiResult.totalPaid / kpiResult.totalAmount) * 100).toFixed(2)
        : 0;
    }

    // Format payment method distribution
    kpiResult.paymentMethodDistribution = paymentMethodsResults.map((item) => ({
      method: item._id || "Unknown",
      count: item.count,
      amount: item.amount,
      percentage: kpiResult.totalInvoices
        ? ((item.count / kpiResult.totalInvoices) * 100).toFixed(2)
        : 0,
    }));

    // Format channel distribution
    channelStatsResults.forEach((item) => {
      if (item._id.isPOS) {
        kpiResult.channelDistribution.pos.count = item.count;
        kpiResult.channelDistribution.pos.amount = item.amount;
      } else if (item._id.isDelivery) {
        kpiResult.channelDistribution.delivery.count = item.count;
        kpiResult.channelDistribution.delivery.amount = item.amount;
      } else {
        kpiResult.channelDistribution.other.count = item.count;
        kpiResult.channelDistribution.other.amount = item.amount;
      }
    });

    // Format monthly trends
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    kpiResult.monthlyTrends = monthlyTrendsResults.map((item) => {
      // Calculate monthly unique customers separately if needed for high precision
      return {
        month: months[item._id.month - 1],
        year: item._id.year,
        count: item.invoiceCount,
        amount: item.totalAmount,
        customers: 0, // Will be updated below if necessary
        averageInvoiceValue: item.invoiceCount
          ? (item.totalAmount / item.invoiceCount).toFixed(2)
          : 0,
      };
    });

    // For monthly unique customers, we'll simplify this part to improve performance
    // We'll calculate a rough estimate based on the overall unique customer count
    // This avoids making too many separate aggregation queries
    if (monthlyTrendsResults.length > 0 && kpiResult.uniqueCustomerCount > 0) {
      const avgCustomersPerMonth = Math.round(
        kpiResult.uniqueCustomerCount / monthlyTrendsResults.length
      );
      kpiResult.monthlyTrends.forEach((item) => {
        // Assign a relative value based on invoice count compared to overall average
        const relativeActivity =
          item.count / (kpiResult.totalInvoices / monthlyTrendsResults.length);
        item.customers = Math.max(
          1,
          Math.round(avgCustomersPerMonth * relativeActivity)
        );
      });
    }

    // Format top customers
    kpiResult.topCustomers = topCustomersResults.map((item) => ({
      customerCode: item._id,
      customerName: item.customerName,
      invoiceCount: item.invoiceCount,
      totalAmount: item.totalAmount,
      averageInvoiceValue:
        item.invoiceCount > 0
          ? (item.totalAmount / item.invoiceCount).toFixed(2)
          : "0.00",
    }));

    // Format top products
    kpiResult.topProducts = topProductsResults.map((item) => ({
      itemCode: item._id,
      itemName: item.itemName,
      quantity: item.quantity,
      revenue: item.revenue,
      occurrences: item.occurrences,
      averagePrice:
        item.quantity > 0 ? (item.revenue / item.quantity).toFixed(2) : "0.00",
    }));

    return res.status(200).json({
      success: true,
      data: kpiResult,
    });
  } catch (error) {
    console.error("Error calculating global KPIs:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate global KPIs",
      error: error.message,
    });
  }
};

/**
 * Handle customer-specific invoice search with various filters
 */
exports.searchInvoices = async (req, res) => {
  try {
    const {
      customerId,
      search,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      paymentMethod,
      isPaid,
      isVerified,
      page = 1,
      limit = 10,
      sortBy = "DocDate",
      sortOrder = -1,
    } = req.query;

    // Build filter object
    const filter = {};

    // Add customer filter if provided
    if (customerId) {
      filter.CardCode = customerId;
    }

    // Add search filter if provided
    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$or = [
        { DocNum: isNaN(search) ? searchRegex : Number(search) },
        { CardName: searchRegex },
        { NumAtCard: searchRegex },
        { Comments: searchRegex },
        { Reference1: searchRegex },
        { Reference2: searchRegex },
      ];
    }

    // Add date range filter if provided
    if (startDate && endDate) {
      filter.DocDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Add amount range filter if provided
    if (minAmount || maxAmount) {
      filter.DocTotal = {};
      if (minAmount) filter.DocTotal.$gte = Number(minAmount);
      if (maxAmount) filter.DocTotal.$lte = Number(maxAmount);
    }

    // Add payment method filter if provided
    if (paymentMethod) {
      filter.paymentMethod = paymentMethod;
    }

    // Add verification status filter if provided
    if (isVerified !== undefined) {
      filter.verified = isVerified === "true";
    }

    // Add payment status filter if provided
    if (isPaid !== undefined) {
      if (isPaid === "true") {
        filter.$expr = { $eq: ["$PaidToDate", "$DocTotal"] };
      } else {
        filter.$expr = { $lt: ["$PaidToDate", "$DocTotal"] };
      }
    }

    // Calculate pagination values
    const skip = (Number(page) - 1) * Number(limit);

    // Define sort options
    const sort = {};
    sort[sortBy] = Number(sortOrder);

    // Execute query with pagination
    const invoices = await Invoice.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // Get total count for pagination
    const totalCount = await Invoice.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: {
        invoices,
        pagination: {
          totalCount,
          totalPages: Math.ceil(totalCount / Number(limit)),
          currentPage: Number(page),
          pageSize: Number(limit),
          hasNext: Number(page) < Math.ceil(totalCount / Number(limit)),
          hasPrevious: Number(page) > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error searching invoices:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search invoices",
      error: error.message,
    });
  }
};

exports.getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find().lean().limit(10);
    return res.status(200).json({
      success: true,
      data: invoices,
    });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch invoices",
      error: error.message,
    });
  }
};

module.exports = exports;
