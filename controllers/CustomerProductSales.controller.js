const ProductSales = require("../models/CustomerProductSales");
const Customer = require("../models/Customer");
/**
  Get products purchased by a specific customer
 */
const getCustomerProducts = async (req, res) => {
  try {
    const { cardCode } = req.params;
    const page = Number.parseInt(req.query.page) || 1;
    const limit = Number.parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || "totalAmount";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const year = req.query.year; // Add year filter parameter

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
      });
    }

    // Validate year parameter if provided
    if (
      year &&
      (isNaN(year) || year < 2013 || year > new Date().getFullYear())
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid year parameter. Year must be between 2013 and ${new Date().getFullYear()}`,
      });
    }

    // Check if customer exists
    const customer = await Customer.findOne({ CardCode: cardCode });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Build sort object
    const sortObject = {};
    sortObject[sortBy] = sortOrder;

    // Build base filter object
    const baseFilter = { customerId: cardCode };

    let products;
    let totalProducts;
    let summary;

    // If no year is specified or year is "all", combine products by itemId
    if (!year || year === "all") {
      // Build filter for aggregation (without year filter)
      const aggregationFilter = { ...baseFilter };

      // Use aggregation to combine items by itemId across all years
      const aggregationPipeline = [
        { $match: aggregationFilter },
        {
          $group: {
            _id: "$itemId",
            itemId: { $first: "$itemId" },
            itemDescription: { $first: "$itemDescription" },
            customerId: { $first: "$customerId" },
            customerName: { $first: "$customerName" },
            totalAmount: { $sum: "$totalAmount" },
            totalQuantity: { $sum: "$totalQuantity" },
            totalCostOfSales: { $sum: "$totalCostOfSales" },
            grossProfit: { $sum: "$grossProfit" },
            years: { $addToSet: "$year" }, // Collect all years this item appears in
            totalTransactions: { $sum: 1 },
            // Add fields to show year range
            minYear: { $min: "$year" },
            maxYear: { $max: "$year" },
            // Keep original structure fields but combine them
            dateStored: { $max: "$dateStored" }, // Take latest date for sorting
          },
        },
        {
          $addFields: {
            // Calculate gross margin after grouping
            grossMargin: {
              $cond: {
                if: { $eq: ["$totalAmount", 0] },
                then: 0,
                else: {
                  $multiply: [
                    {
                      $divide: ["$grossProfit", "$totalAmount"],
                    },
                    100,
                  ],
                },
              },
            },
            // Add a combined year display field
            yearRange: {
              $cond: {
                if: { $eq: ["$minYear", "$maxYear"] },
                then: { $toString: "$minYear" },
                else: {
                  $concat: [
                    { $toString: "$minYear" },
                    "-",
                    { $toString: "$maxYear" },
                  ],
                },
              },
            },
            // Calculate average price
            avgPrice: {
              $cond: {
                if: { $eq: ["$totalQuantity", 0] },
                then: 0,
                else: { $divide: ["$totalAmount", "$totalQuantity"] },
              },
            },
            // Set year to null for combined data
            year: null,
          },
        },
      ];

      // Get total count for pagination
      const countPipeline = [...aggregationPipeline, { $count: "total" }];
      const countResult = await ProductSales.aggregate(countPipeline);
      totalProducts = countResult.length > 0 ? countResult[0].total : 0;

      // Add sorting and pagination
      aggregationPipeline.push(
        { $sort: sortObject },
        { $skip: skip },
        { $limit: limit }
      );

      const aggregatedProducts = await ProductSales.aggregate(
        aggregationPipeline
      );

      // Format the data to match the expected structure
      products = aggregatedProducts.map((item) => ({
        _id: item._id,
        itemId: item.itemId,
        itemDescription: item.itemDescription,
        customerId: item.customerId,
        customerName: item.customerName,
        totalAmount: item.totalAmount,
        totalQuantity: item.totalQuantity,
        totalCostOfSales: item.totalCostOfSales,
        grossProfit: item.grossProfit,
        grossMargin: item.grossMargin,
        avgPrice: item.avgPrice,
        totalTransactions: item.totalTransactions,
        yearRange: item.yearRange,
        yearsIncluded: item.years.sort((a, b) => a - b), // Sort years ascending
        dateStored: item.dateStored,
        year: null, // Indicate this is combined data
      }));

      // Calculate summary for all years
      const summaryResult = await ProductSales.aggregate([
        { $match: aggregationFilter },
        {
          $group: {
            _id: null,
            totalQuantity: { $sum: "$totalQuantity" },
            totalAmount: { $sum: "$totalAmount" },
            totalCostOfSales: { $sum: "$totalCostOfSales" },
            totalGrossProfit: { $sum: "$grossProfit" },
          },
        },
      ]);

      summary =
        summaryResult.length > 0
          ? summaryResult[0]
          : {
              totalQuantity: 0,
              totalAmount: 0,
              totalCostOfSales: 0,
              totalGrossProfit: 0,
            };
    } else {
      // Original logic for specific year
      const filterObject = { ...baseFilter, year: Number.parseInt(year) };

      // Fetch products purchased by the customer with pagination and year filter
      products = await ProductSales.find(filterObject)
        .sort(sortObject)
        .skip(skip)
        .limit(limit)
        .lean(); // Use lean() for better performance

      // Get total count for pagination info with year filter
      totalProducts = await ProductSales.countDocuments(filterObject);

      // Calculate totals for summary with year filter
      const totalStats = await ProductSales.aggregate([
        { $match: filterObject },
        {
          $group: {
            _id: null,
            totalQuantity: { $sum: "$totalQuantity" },
            totalAmount: { $sum: "$totalAmount" },
            totalCostOfSales: { $sum: "$totalCostOfSales" },
            totalGrossProfit: { $sum: "$grossProfit" },
          },
        },
      ]);

      summary =
        totalStats.length > 0
          ? totalStats[0]
          : {
              totalQuantity: 0,
              totalAmount: 0,
              totalCostOfSales: 0,
              totalGrossProfit: 0,
            };
    }

    const totalPages = Math.ceil(totalProducts / limit);

    // Get available years for this customer
    const availableYears = await ProductSales.distinct("year", {
      customerId: cardCode,
    });
    const sortedYears = availableYears.sort((a, b) => b - a); // Sort descending

    return res.status(200).json({
      success: true,
      data: {
        customer: {
          cardCode: customer.CardCode,
          cardName: customer.CardName,
          customerType: customer.customerType,
          status: customer.status,
        },
        products,
        pagination: {
          currentPage: page,
          totalPages,
          totalProducts,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit,
        },
        summary: {
          totalQuantity: summary.totalQuantity || 0,
          totalAmount: summary.totalAmount || 0,
          totalCostOfSales: summary.totalCostOfSales || 0,
          totalGrossProfit: summary.totalGrossProfit || 0,
        },
        availableYears: sortedYears, // Include available years in response
        currentYear: year ? Number.parseInt(year) : null, // Include current filter year
        // Add metadata about the data structure
        dataType: !year || year === "all" ? "combined" : "individual",
      },
    });
  } catch (error) {
    console.error("Error fetching customer products:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
/**
 Get all customers with their product purchase summary
 */
const getCustomersProductsSummary = async (req, res) => {
  try {
    const page = Number.parseInt(req.query.page) || 1;
    const limit = Number.parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || "totalAmount";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const year = req.query.year; // Add year filter parameter

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
      });
    }

    // Validate year parameter if provided
    if (
      year &&
      (isNaN(year) || year < 2013 || year > new Date().getFullYear())
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid year parameter. Year must be between 2013 and ${new Date().getFullYear()}`,
      });
    }

    const skip = (page - 1) * limit;

    // Build match stage for aggregation
    const matchStage = {};
    if (year) {
      matchStage.year = Number.parseInt(year);
    }

    // Aggregate customer purchase data with year filter
    const customersSummary = await ProductSales.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: "$customerId",
          customerName: { $first: "$customerName" },
          totalQuantity: { $sum: "$totalQuantity" },
          totalAmount: { $sum: "$totalAmount" },
          totalCostOfSales: { $sum: "$totalCostOfSales" },
          totalGrossProfit: { $sum: "$grossProfit" },
          productCount: { $sum: 1 },
          lastPurchase: { $max: "$dateStored" },
        },
      },
      { $sort: { [sortBy]: sortOrder } },
      { $skip: skip },
      { $limit: limit },
    ]);

    // Get total count of customers with purchases (with year filter)
    const totalCustomersCount = await ProductSales.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      { $group: { _id: "$customerId" } },
      { $count: "total" },
    ]);

    const totalCustomers =
      totalCustomersCount.length > 0 ? totalCustomersCount[0].total : 0;

    const totalPages = Math.ceil(totalCustomers / limit);

    // Get available years across all customers
    const availableYears = await ProductSales.distinct("year");
    const sortedYears = availableYears.sort((a, b) => b - a); // Sort descending

    return res.status(200).json({
      success: true,
      data: {
        customers: customersSummary,
        pagination: {
          currentPage: page,
          totalPages,
          totalCustomers,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit,
        },
        availableYears: sortedYears, // Include available years in response
        currentYear: year ? Number.parseInt(year) : null, // Include current filter year
      },
    });
  } catch (error) {
    console.error("Error fetching customers products summary:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  getCustomerProducts,
  getCustomersProductsSummary,
};
