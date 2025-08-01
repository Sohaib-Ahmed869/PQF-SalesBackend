const ProductSales = require("../models/CustomerProductSales");
const Customer = require("../models/Customer");

/**
 * Get comprehensive product sales analytics
 */
const getProductSalesAnalytics = async (req, res) => {
  try {
    const {
      year,
      customer,
      product,
      sortBy = "totalAmount",
      sortOrder = "desc",
    } = req.query;

    // Build match stage for aggregation
    const matchStage = {};
    if (year && year !== "all") {
      matchStage.year = parseInt(year);
    }
    if (customer) {
      matchStage.customerId = customer;
    }
    if (product) {
      matchStage.itemId = product;
    }

    // Get KPIs
    const kpiStats = await ProductSales.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalAmount" },
          totalQuantity: { $sum: "$totalQuantity" },
          totalCostOfSales: { $sum: "$totalCostOfSales" },
          totalGrossProfit: { $sum: "$grossProfit" },
          avgGrossMargin: { $avg: "$grossMargin" },
          uniqueProducts: { $addToSet: "$itemId" },
          uniqueCustomers: { $addToSet: "$customerId" },
          totalTransactions: { $sum: 1 },
        },
      },
    ]);

    const kpis =
      kpiStats.length > 0
        ? {
            ...kpiStats[0],
            uniqueProducts: kpiStats[0].uniqueProducts.length,
            uniqueCustomers: kpiStats[0].uniqueCustomers.length,
            avgTransactionValue:
              kpiStats[0].totalRevenue / kpiStats[0].totalTransactions,
          }
        : {
            totalRevenue: 0,
            totalQuantity: 0,
            totalCostOfSales: 0,
            totalGrossProfit: 0,
            avgGrossMargin: 0,
            uniqueProducts: 0,
            uniqueCustomers: 0,
            totalTransactions: 0,
            avgTransactionValue: 0,
          };

    // Get yearly trends
    const yearlyTrendsMatchStage = {};
    if (customer) {
      yearlyTrendsMatchStage.customerId = customer;
    }
    if (product) {
      yearlyTrendsMatchStage.itemId = product;
    }

    const yearlyTrends = await ProductSales.aggregate([
      { $match: yearlyTrendsMatchStage },
      {
        $group: {
          _id: "$year",
          revenue: { $sum: "$totalAmount" },
          quantity: { $sum: "$totalQuantity" },
          transactions: { $sum: 1 },
          grossProfit: { $sum: "$grossProfit" },
          avgMargin: { $avg: "$grossMargin" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get monthly trends for current/selected year
    const selectedYear =
      year && year !== "all" ? parseInt(year) : new Date().getFullYear();
    const monthlyTrends = await ProductSales.aggregate([
      {
        $match: {
          year: selectedYear,
          ...(customer && { customerId: customer }),
        },
      },
      {
        $addFields: {
          month: { $month: "$dateStored" },
        },
      },
      {
        $group: {
          _id: "$month",
          revenue: { $sum: "$totalAmount" },
          quantity: { $sum: "$totalQuantity" },
          transactions: { $sum: 1 },
          grossProfit: { $sum: "$grossProfit" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get top products - FIXED: Handle division by zero
    const topProducts = await ProductSales.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$itemId",
          itemDescription: { $first: "$itemDescription" },
          totalRevenue: { $sum: "$totalAmount" },
          totalQuantity: { $sum: "$totalQuantity" },
          totalGrossProfit: { $sum: "$grossProfit" },
          avgGrossMargin: { $avg: "$grossMargin" },
          transactions: { $sum: 1 },
          // Fixed: Use $cond to handle division by zero
          avgPrice: {
            $avg: {
              $cond: {
                if: { $eq: ["$totalQuantity", 0] },
                then: 0,
                else: { $divide: ["$totalAmount", "$totalQuantity"] },
              },
            },
          },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
    ]);

    // Get top customers
    const topCustomers = await ProductSales.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$customerId",
          customerName: { $first: "$customerName" },
          totalRevenue: { $sum: "$totalAmount" },
          totalQuantity: { $sum: "$totalQuantity" },
          totalGrossProfit: { $sum: "$grossProfit" },
          transactions: { $sum: 1 },
          avgTransactionValue: { $avg: "$totalAmount" },
          uniqueProducts: { $addToSet: "$itemId" },
        },
      },
      {
        $addFields: {
          uniqueProductsCount: { $size: "$uniqueProducts" },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 },
    ]);

    // Get gross margin distribution
    const marginDistribution = await ProductSales.aggregate([
      { $match: matchStage },
      {
        $bucket: {
          groupBy: "$grossMargin",
          boundaries: [0, 10, 20, 30, 40, 50, 100],
          default: "100+",
          output: {
            count: { $sum: 1 },
            revenue: { $sum: "$totalAmount" },
          },
        },
      },
    ]);

    // Get product category performance (assuming itemDescription contains category info)
    const categoryPerformance = await ProductSales.aggregate([
      { $match: matchStage },
      {
        $addFields: {
          category: {
            $arrayElemAt: [{ $split: ["$itemDescription", " "] }, 0],
          },
        },
      },
      {
        $group: {
          _id: "$category",
          revenue: { $sum: "$totalAmount" },
          quantity: { $sum: "$totalQuantity" },
          grossProfit: { $sum: "$grossProfit" },
          transactions: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
    ]);

    // Get available filters
    const availableYears = await ProductSales.distinct("year");
    const availableCustomers = await ProductSales.aggregate([
      {
        $group: {
          _id: "$customerId",
          customerName: { $first: "$customerName" },
        },
      },
      { $sort: { customerName: 1 } },
      { $limit: 50 },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        kpis,
        yearlyTrends: yearlyTrends.map((trend) => ({
          year: trend._id,
          revenue: trend.revenue,
          quantity: trend.quantity,
          transactions: trend.transactions,
          grossProfit: trend.grossProfit,
          avgMargin: trend.avgMargin,
        })),
        monthlyTrends: monthlyTrends.map((trend) => ({
          month: trend._id,
          revenue: trend.revenue,
          quantity: trend.quantity,
          transactions: trend.transactions,
          grossProfit: trend.grossProfit,
        })),
        topProducts,
        topCustomers,
        marginDistribution,
        categoryPerformance,
        filters: {
          availableYears: availableYears.sort((a, b) => b - a),
          availableCustomers,
          selectedYear: year || "all",
          selectedCustomer: customer || null,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching product sales analytics:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
const getProductSalesData = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const sortBy = req.query.sortBy || "totalAmount";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const { year, customer, product, search } = req.query;

    // Validate pagination
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
      });
    }

    // Build filter
    const filter = {};
    if (year && year !== "all") {
      filter.year = parseInt(year);
    }
    if (customer) {
      filter.customerId = customer;
    }
    if (product) {
      filter.itemId = product;
    }
    if (search) {
      filter.$or = [
        { itemDescription: { $regex: search, $options: "i" } },
        { customerName: { $regex: search, $options: "i" } },
        { customerId: { $regex: search, $options: "i" } },
        { itemId: { $regex: search, $options: "i" } },
      ];
    }

    let salesData;
    let totalCount;

    // If "all years" is selected, group by both customerId and itemId (if product filter is applied)
    // or just by customerId and itemId combination for proper accumulation
    if (!year || year === "all") {
      let groupByFields;

      // Determine grouping strategy based on filters
      if (product) {
        // If product filter is applied, group by customer + item combination
        groupByFields = {
          customerId: "$customerId",
          itemId: "$itemId",
        };
      } else if (customer) {
        // If customer filter is applied, group by customer + item combination
        groupByFields = {
          customerId: "$customerId",
          itemId: "$itemId",
        };
      } else {
        // If no specific filters, group by customer + item combination to show all combinations
        groupByFields = {
          customerId: "$customerId",
          itemId: "$itemId",
        };
      }

      // Use aggregation to combine records by customer-item combination
      const aggregationPipeline = [
        { $match: filter },
        {
          $group: {
            _id: groupByFields,
            itemId: { $first: "$itemId" },
            itemDescription: { $first: "$itemDescription" },
            customerId: { $first: "$customerId" },
            customerName: { $first: "$customerName" },
            totalAmount: { $sum: "$totalAmount" },
            totalQuantity: { $sum: "$totalQuantity" },
            totalCostOfSales: { $sum: "$totalCostOfSales" },
            grossProfit: { $sum: "$grossProfit" },
            grossMargin: {
              $avg: "$grossMargin", // Average margin across all years
            },
            years: { $addToSet: "$year" }, // Collect all years this combination appears in
            totalTransactions: { $sum: 1 },
            // Add fields to show year range
            minYear: { $min: "$year" },
            maxYear: { $max: "$year" },
            // Keep original structure fields but combine them
            dateStored: { $max: "$dateStored" }, // Take most recent date for sorting
          },
        },
        {
          $addFields: {
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
          },
        },
      ];

      // Get total count for pagination
      const countPipeline = [...aggregationPipeline, { $count: "total" }];

      const countResult = await ProductSales.aggregate(countPipeline);
      totalCount = countResult.length > 0 ? countResult[0].total : 0;

      // Add sorting and pagination
      const sortObject = { [sortBy]: sortOrder };
      const skip = (page - 1) * limit;

      aggregationPipeline.push(
        { $sort: sortObject },
        { $skip: skip },
        { $limit: limit }
      );

      salesData = await ProductSales.aggregate(aggregationPipeline);

      // Format the data
      salesData = salesData.map((item) => ({
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
      }));
    } else {
      // Original logic for specific year - no aggregation needed
      const skip = (page - 1) * limit;
      const sortObject = { [sortBy]: sortOrder };

      salesData = await ProductSales.find(filter)
        .sort(sortObject)
        .skip(skip)
        .limit(limit)
        .lean();

      totalCount = await ProductSales.countDocuments(filter);
    }

    const totalPages = Math.ceil(totalCount / limit);

    // Get summary for current filter (always use aggregation for consistency)
    const summary = await ProductSales.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalAmount" },
          totalQuantity: { $sum: "$totalQuantity" },
          totalGrossProfit: { $sum: "$grossProfit" },
          avgGrossMargin: { $avg: "$grossMargin" },
          totalRecords: { $sum: 1 },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        salesData,
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords: totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit,
        },
        summary:
          summary.length > 0
            ? summary[0]
            : {
                totalRevenue: 0,
                totalQuantity: 0,
                totalGrossProfit: 0,
                avgGrossMargin: 0,
                totalRecords: 0,
              },
        // Add metadata about the data structure
        dataType: !year || year === "all" ? "combined" : "individual",
      },
    });
  } catch (error) {
    console.error("Error fetching product sales data:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
/**
 * Get product performance comparison
 */
const getProductPerformanceComparison = async (req, res) => {
  try {
    const { productIds, year } = req.query;

    if (!productIds) {
      return res.status(400).json({
        success: false,
        message: "Product IDs are required",
      });
    }

    const productList = Array.isArray(productIds)
      ? productIds
      : productIds.split(",");

    const matchStage = {
      itemId: { $in: productList },
    };

    if (year && year !== "all") {
      matchStage.year = parseInt(year);
    }

    const comparison = await ProductSales.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            itemId: "$itemId",
            year: "$year",
          },
          itemDescription: { $first: "$itemDescription" },
          revenue: { $sum: "$totalAmount" },
          quantity: { $sum: "$totalQuantity" },
          grossProfit: { $sum: "$grossProfit" },
          avgMargin: { $avg: "$grossMargin" },
        },
      },
      { $sort: { "_id.year": 1, "_id.itemId": 1 } },
    ]);

    return res.status(200).json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    console.error("Error fetching product performance comparison:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
const getCustomers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";
    const skip = (page - 1) * limit;

    // Build search filter
    const searchFilter = search
      ? {
          $or: [
            { customerName: { $regex: search, $options: "i" } },
            { customerId: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    // Get unique customers from ProductSales
    const customersAggregation = await ProductSales.aggregate([
      {
        $group: {
          _id: "$customerId",
          customerName: { $first: "$customerName" },
          totalRevenue: { $sum: "$totalAmount" },
          lastTransaction: { $max: "$dateStored" },
        },
      },
      { $match: searchFilter },
      { $sort: { customerName: 1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const customers = customersAggregation[0].data;
    const totalCount = customersAggregation[0].metadata[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      success: true,
      data: {
        customers,
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords: totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
const getItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";
    const skip = (page - 1) * limit;

    // Build search filter
    const searchFilter = search
      ? {
          $or: [
            { itemDescription: { $regex: search, $options: "i" } },
            { itemId: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    // Get unique items from ProductSales
    const itemsAggregation = await ProductSales.aggregate([
      {
        $group: {
          _id: "$itemId",
          itemDescription: { $first: "$itemDescription" },
          totalRevenue: { $sum: "$totalAmount" },
          totalQuantity: { $sum: "$totalQuantity" },
          lastTransaction: { $max: "$dateStored" },
        },
      },
      { $match: searchFilter },
      { $sort: { itemDescription: 1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const items = itemsAggregation[0].data.map((item) => ({
      _id: item._id,
      itemId: item._id,
      itemDescription: item.itemDescription,
      totalRevenue: item.totalRevenue,
      totalQuantity: item.totalQuantity,
      lastTransaction: item.lastTransaction,
    }));

    const totalCount = itemsAggregation[0].metadata[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords: totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          limit,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching items:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch items",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
module.exports = {
  getProductSalesAnalytics,
  getProductSalesData,
  getCustomers,
  getItems,
  getProductPerformanceComparison,
};
