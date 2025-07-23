const Deal = require("../models/Deal");

// Helper function to handle errors
const handleError = (res, error) => {
  console.error("Error:", error);
  return res
    .status(500)
    .json({ success: false, message: "Server error", error: error.message });
};

// Get all deals with pagination
exports.getDeals = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const deals = await Deal.find()
      .sort({ createDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Deal.countDocuments();

    res.status(200).json({
      success: true,
      count: deals.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: deals,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get a single deal by ID
exports.getDealById = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id);

    if (!deal) {
      return res
        .status(404)
        .json({ success: false, message: "Deal not found" });
    }

    res.status(200).json({ success: true, data: deal });
  } catch (error) {
    handleError(res, error);
  }
};

// Create a new deal
exports.createDeal = async (req, res) => {
  try {
    const deal = await Deal.create(req.body);
    res.status(201).json({ success: true, data: deal });
  } catch (error) {
    handleError(res, error);
  }
};

// Update a deal
exports.updateDeal = async (req, res) => {
  try {
    const deal = await Deal.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!deal) {
      return res
        .status(404)
        .json({ success: false, message: "Deal not found" });
    }

    res.status(200).json({ success: true, data: deal });
  } catch (error) {
    handleError(res, error);
  }
};

// Delete a deal
exports.deleteDeal = async (req, res) => {
  try {
    const deal = await Deal.findByIdAndDelete(req.params.id);

    if (!deal) {
      return res
        .status(404)
        .json({ success: false, message: "Deal not found" });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    handleError(res, error);
  }
};

// ANALYTICS ENDPOINTS (Non-cart related)

// Get sales performance over time
exports.getSalesPerformance = async (req, res) => {
  try {
    const period = req.query.period || "monthly"; // daily, weekly, monthly, yearly
    const months = parseInt(req.query.months) || 12; // Default to last 12 months

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    let groupBy;

    // Set up date grouping format based on period
    if (period === "daily") {
      groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$closeDate" } };
    } else if (period === "weekly") {
      groupBy = {
        year: { $year: "$closeDate" },
        week: { $week: "$closeDate" },
      };
    } else if (period === "monthly") {
      groupBy = {
        year: { $year: "$closeDate" },
        month: { $month: "$closeDate" },
      };
    } else {
      groupBy = { $year: "$closeDate" };
    }

    const salesData = await Deal.aggregate([
      {
        $match: {
          closeDate: { $gte: startDate },
          isClosedWon: true,
        },
      },
      {
        $group: {
          _id: groupBy,
          totalSales: { $sum: "$amount" },
          count: { $sum: 1 },
          avgOrderValue: { $avg: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      success: true,
      period: period,
      data: salesData,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get product performance
exports.getProductPerformance = async (req, res) => {
  try {
    const timeframe = req.query.timeframe || "all"; // all, month, quarter, year

    let dateFilter = {};
    const now = new Date();

    if (timeframe === "month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { closeDate: { $gte: startOfMonth } };
    } else if (timeframe === "quarter") {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const startOfQuarter = new Date(now.getFullYear(), quarterMonth, 1);
      dateFilter = { closeDate: { $gte: startOfQuarter } };
    } else if (timeframe === "year") {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      dateFilter = { closeDate: { $gte: startOfYear } };
    }

    const productPerformance = await Deal.aggregate([
      {
        $match: {
          isClosedWon: true,
          ...dateFilter,
        },
      },
      { $unwind: "$products" },
      {
        $group: {
          _id: "$products.name",
          totalQuantity: { $sum: "$products.quantity" },
          totalRevenue: { $sum: "$products.totalPrice" },
          averagePrice: { $avg: "$products.price" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    res.status(200).json({
      success: true,
      timeframe: timeframe,
      count: productPerformance.length,
      data: productPerformance,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get customer insights
exports.getCustomerInsights = async (req, res) => {
  try {
    // Find customers with repeat purchases
    const repeatCustomers = await Deal.aggregate([
      {
        $match: {
          isClosedWon: true,
          customerEmail: { $ne: null, $ne: "" },
        },
      },
      {
        $group: {
          _id: "$customerEmail",
          customerName: { $first: "$customerName" },
          totalSpent: { $sum: "$amount" },
          purchaseCount: { $sum: 1 },
          lastPurchaseDate: { $max: "$closeDate" },
          avgOrderValue: { $avg: "$amount" },
        },
      },
      {
        $match: {
          purchaseCount: { $gt: 1 },
        },
      },
      {
        $sort: { purchaseCount: -1, totalSpent: -1 },
      },
      {
        $limit: 100,
      },
    ]);

    res.status(200).json({
      success: true,
      count: repeatCustomers.length,
      data: repeatCustomers,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get pipeline stage analytics
exports.getPipelineAnalytics = async (req, res) => {
  try {
    const pipelineStats = await Deal.aggregate([
      {
        $group: {
          _id: {
            pipeline: "$pipeline",
            stage: "$dealStage",
          },
          count: { $sum: 1 },
          totalValue: { $sum: "$amount" },
          avgValue: { $avg: "$amount" },
        },
      },
      {
        $sort: { "_id.pipeline": 1, "_id.stage": 1 },
      },
    ]);

    res.status(200).json({
      success: true,
      data: pipelineStats,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get deal sources analytics
exports.getDealSourcesAnalytics = async (req, res) => {
  try {
    const sourcesStats = await Deal.aggregate([
      {
        $group: {
          _id: {
            source: "$source",
            sourceDetail: "$sourceDetail",
          },
          count: { $sum: 1 },
          closedWon: {
            $sum: { $cond: [{ $eq: ["$isClosedWon", true] }, 1, 0] },
          },
          closedLost: {
            $sum: { $cond: [{ $eq: ["$isClosedLost", true] }, 1, 0] },
          },
          totalValue: { $sum: "$amount" },
          wonValue: {
            $sum: {
              $cond: [{ $eq: ["$isClosedWon", true] }, "$amount", 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          count: 1,
          closedWon: 1,
          closedLost: 1,
          totalValue: 1,
          wonValue: 1,
          conversionRate: {
            $multiply: [{ $divide: ["$closedWon", "$count"] }, 100],
          },
        },
      },
      { $sort: { wonValue: -1 } },
    ]);

    res.status(200).json({
      success: true,
      count: sourcesStats.length,
      data: sourcesStats,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Note: All abandoned cart related functions have been moved to cart.controller.js
// This includes:
// - getAbandonedCarts
// - getAbandonedCartCategories
// - getProductDetails
// - getAbandonedCartTimeAnalytics
// - getAbandonedCartRecoveryOpportunities
// - getConversionStats (cart-related)
// - getCustomerDeals
// - getCustomerDetail
// - exportAbandonedCarts
// - getAbandonedCartAnalytics
// - getTopAbandonedProducts
