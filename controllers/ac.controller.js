const Cart = require("../models/Cart");

// Helper function to handle errors
const handleError = (res, error) => {
  console.error("Error:", error);
  return res
    .status(500)
    .json({ success: false, message: "Server error", error: error.message });
};

// Get all carts with pagination and filtering
exports.getCarts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build query filters
    const query = {};

    // Status filter
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Date filters
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const daysAgo = parseInt(req.query.daysAgo) || null;

    if (startDate && endDate) {
      query.createDate = { $gte: startDate, $lte: endDate };
    } else if (daysAgo) {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysAgo);
      query.createDate = { $gte: fromDate };
    }

    // Customer filter
    if (req.query.customerEmail) {
      query.customerEmail = req.query.customerEmail;
    }

    const carts = await Cart.find(query)
      .sort({ createDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Cart.countDocuments(query);

    res.status(200).json({
      success: true,
      count: carts.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      totalItems: total,
      data: carts,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get abandoned carts (status = 'abandoned')
exports.getAbandonedCarts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Enhanced date filtering options
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const daysAgo = parseInt(req.query.daysAgo) || null;

    // Category filter for drill-down
    const category = req.query.category || null;
    const productId = req.query.productId || null;

    // Build query - only abandoned carts
    const query = {
      status: "abandoned",
      isAbandoned: true,
    };

    // Apply date filters
    if (startDate && endDate) {
      query.createDate = { $gte: startDate, $lte: endDate };
    } else if (daysAgo) {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysAgo);
      query.createDate = { $gte: fromDate };
    }

    // Apply category/product filters for drill-down
    if (category) {
      query["products.category"] = category;
    }

    if (productId) {
      query["products.name"] = productId; // Using product name as ID in your CSV data
    }

    const abandonedCarts = await Cart.find(query)
      .sort({ createDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Cart.countDocuments(query);

    // Get aggregated data for drill-down navigation
    const categories = await Cart.aggregate([
      { $match: query },
      { $unwind: "$products" },
      {
        $group: {
          _id: "$products.name", // Group by product name since we don't have category
          count: { $sum: 1 },
          totalValue: { $sum: "$products.totalPrice" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 }, // Limit to top 20 products
    ]);

    res.status(200).json({
      success: true,
      count: abandonedCarts.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      totalItems: total,
      data: abandonedCarts,
      drillDown: {
        categories: categories,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get abandoned cart categories breakdown
exports.getAbandonedCartCategories = async (req, res) => {
  try {
    // Date range parameters
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const daysAgo = parseInt(req.query.daysAgo) || 30;

    // Build the match query
    let matchQuery = {
      status: "abandoned",
      isAbandoned: true,
    };

    // Apply date filters
    if (startDate && endDate) {
      matchQuery.createDate = { $gte: startDate, $lte: endDate };
    } else {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysAgo);
      matchQuery.createDate = { $gte: fromDate };
    }

    // Aggregate to get categories breakdown (using product names as categories)
    const categoriesBreakdown = await Cart.aggregate([
      { $match: matchQuery },
      { $unwind: "$products" },
      {
        $group: {
          _id: "$products.name",
          count: { $sum: 1 },
          totalValue: { $sum: "$products.totalPrice" },
          totalCarts: { $addToSet: "$_id" },
          avgCartValue: { $avg: "$totalIncludingTaxes" },
        },
      },
      {
        $addFields: {
          cartCount: { $size: "$totalCarts" },
        },
      },
      {
        $project: {
          totalCarts: 0, // Remove the large array of IDs
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.status(200).json({
      success: true,
      count: categoriesBreakdown.length,
      dateRange: startDate && endDate ? { startDate, endDate } : { daysAgo },
      data: categoriesBreakdown,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get top abandoned products
exports.getTopAbandonedProducts = async (req, res) => {
  try {
    // Date range parameters
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const daysAgo = parseInt(req.query.daysAgo) || 30;
    const category = req.query.category || null;

    // Build match query
    let matchQuery = {
      status: "abandoned",
      isAbandoned: true,
    };

    // Apply date filters
    if (startDate && endDate) {
      matchQuery.createDate = { $gte: startDate, $lte: endDate };
    } else {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysAgo);
      matchQuery.createDate = { $gte: fromDate };
    }

    const topProducts = await Cart.aggregate([
      { $match: matchQuery },
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
      { $sort: { totalQuantity: -1 } },
      { $limit: 50 }, // Top 50 products
    ]);

    res.status(200).json({
      success: true,
      count: topProducts.length,
      data: topProducts,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get abandoned cart time analytics
exports.getAbandonedCartTimeAnalytics = async (req, res) => {
  try {
    // Date range parameters
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const timeframe = req.query.timeframe || "daily"; // daily, weekly, monthly

    let matchQuery = {
      status: "abandoned",
      isAbandoned: true,
    };

    // Apply date filters
    if (startDate && endDate) {
      matchQuery.createDate = { $gte: startDate, $lte: endDate };
    }

    // Define time grouping based on timeframe
    let groupBy;
    if (timeframe === "daily") {
      groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createDate" } };
    } else if (timeframe === "weekly") {
      groupBy = {
        year: { $year: "$createDate" },
        week: { $week: "$createDate" },
      };
    } else if (timeframe === "monthly") {
      groupBy = {
        year: { $year: "$createDate" },
        month: { $month: "$createDate" },
      };
    }

    // Run aggregation pipeline
    const abandonedCartTimeSeries = await Cart.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: groupBy,
          count: { $sum: 1 },
          totalValue: { $sum: "$totalIncludingTaxes" },
          avgValue: { $avg: "$totalIncludingTaxes" },
          productCount: { $sum: { $size: { $ifNull: ["$products", []] } } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Format results for charts
    const formattedData = abandonedCartTimeSeries.map((item) => {
      let dateLabel;
      if (timeframe === "daily") {
        dateLabel = item._id;
      } else if (timeframe === "weekly") {
        dateLabel = `${item._id.year}-W${item._id.week}`;
      } else if (timeframe === "monthly") {
        dateLabel = `${item._id.year}-${item._id.month
          .toString()
          .padStart(2, "0")}`;
      }

      return {
        date: dateLabel,
        count: item.count,
        totalValue: item.totalValue || 0,
        avgValue: item.avgValue || 0,
        productCount: item.productCount || 0,
      };
    });

    res.status(200).json({
      success: true,
      timeframe: timeframe,
      data: formattedData,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get abandoned cart recovery opportunities (with contact info)
exports.getAbandonedCartRecoveryOpportunities = async (req, res) => {
  try {
    // Build query for abandoned carts with contact info
    const query = {
      status: "abandoned",
      isAbandoned: true,
      $or: [
        { "contactInfo.email": { $ne: null, $ne: "" } },
        { "contactInfo.phone": { $ne: null, $ne: "" } },
        { "contactInfo.mobilePhone": { $ne: null, $ne: "" } },
        { customerEmail: { $ne: null, $ne: "" } },
      ],
    };

    // Add date filters
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const daysAgo = parseInt(req.query.daysAgo) || null;

    if (startDate && endDate) {
      query.createDate = { $gte: startDate, $lte: endDate };
    } else if (daysAgo) {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysAgo);
      query.createDate = { $gte: fromDate };
    }

    // Add category/product filters
    const category = req.query.category || null;
    const productId = req.query.productId || null;

    if (category) {
      query["products.name"] = category; // Using product name as category
    }

    if (productId) {
      query["products.name"] = productId;
    }

    const abandonedCartsWithContact = await Cart.find(query)
      .sort({ totalIncludingTaxes: -1 }) // Sort by cart value (highest first)
      .limit(100);

    res.status(200).json({
      success: true,
      count: abandonedCartsWithContact.length,
      data: abandonedCartsWithContact,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get conversion rate stats (comparing abandoned vs converted carts)
exports.getConversionStats = async (req, res) => {
  try {
    const period = req.query.period || "all";

    let dateFilter = {};
    const now = new Date();

    // Handle date filters
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const daysAgo = parseInt(req.query.daysAgo) || null;

    if (period === "custom" && startDate && endDate) {
      dateFilter = { createDate: { $gte: startDate, $lte: endDate } };
    } else if (period === "custom" && daysAgo) {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysAgo);
      dateFilter = { createDate: { $gte: fromDate } };
    } else if (period === "month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { createDate: { $gte: startOfMonth } };
    } else if (period === "quarter") {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const startOfQuarter = new Date(now.getFullYear(), quarterMonth, 1);
      dateFilter = { createDate: { $gte: startOfQuarter } };
    } else if (period === "year") {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      dateFilter = { createDate: { $gte: startOfYear } };
    }

    // Add product/category filters
    const category = req.query.category || null;
    const productId = req.query.productId || null;

    let productFilter = {};
    if (category) {
      productFilter["products.name"] = category;
    }

    if (productId) {
      productFilter["products.name"] = productId;
    }

    const categoryProductFilter =
      Object.keys(productFilter).length > 0 ? productFilter : {};

    // Total carts created in period
    const totalCarts = await Cart.countDocuments({
      ...dateFilter,
      ...categoryProductFilter,
    });

    // Completed purchases (converted carts)
    const completedPurchases = await Cart.countDocuments({
      ...dateFilter,
      ...categoryProductFilter,
      status: "converted",
    });

    // Abandoned carts
    const abandonedCarts = await Cart.countDocuments({
      ...dateFilter,
      ...categoryProductFilter,
      status: "abandoned",
      isAbandoned: true,
    });

    // Average value of abandoned carts
    const avgAbandonedValue = await Cart.aggregate([
      {
        $match: {
          ...dateFilter,
          ...categoryProductFilter,
          status: "abandoned",
          isAbandoned: true,
          totalIncludingTaxes: { $ne: null, $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          avgValue: { $avg: "$totalIncludingTaxes" },
        },
      },
    ]);

    // Calculate conversion rate
    const conversionRate =
      totalCarts > 0 ? (completedPurchases / totalCarts) * 100 : 0;

    res.status(200).json({
      success: true,
      period: period,
      filters: {
        dateRange:
          startDate && endDate ? { start: startDate, end: endDate } : null,
        daysAgo: daysAgo,
        category: category,
        productId: productId,
      },
      data: {
        totalCarts,
        completedPurchases,
        abandonedCarts,
        conversionRate: conversionRate.toFixed(2) + "%",
        avgAbandonedCartValue:
          avgAbandonedValue.length > 0 ? avgAbandonedValue[0].avgValue : 0,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Export abandoned cart data
exports.exportAbandonedCarts = async (req, res) => {
  try {
    const daysAgo = parseInt(req.query.daysAgo) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    const abandonedCarts = await Cart.find({
      status: "abandoned",
      isAbandoned: true,
      createDate: { $gte: startDate },
      $or: [
        { "contactInfo.email": { $ne: null } },
        { customerEmail: { $ne: null } },
      ],
    }).select(
      "customerName customerEmail contactInfo.email totalIncludingTaxes products createDate"
    );

    res.status(200).json({
      success: true,
      count: abandonedCarts.length,
      data: abandonedCarts,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get customers with cart data
exports.getCustomers = async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = parseInt(req.query.limit) || 20;

    // Get customers with their cart summary
    const customers = await Cart.aggregate([
      // Group by customer email
      {
        $group: {
          _id: "$customerEmail",
          customerName: { $first: "$customerName" },
          cartIds: { $push: "$_id" },
          totalSpent: {
            $sum: {
              $cond: [
                { $eq: ["$status", "converted"] },
                "$totalIncludingTaxes",
                0,
              ],
            },
          },
          orderCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "converted"] }, 1, 0],
            },
          },
          lastPurchaseDate: {
            $max: {
              $cond: [{ $eq: ["$status", "converted"] }, "$createDate", null],
            },
          },
          abandonedCartsCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "abandoned"] }, 1, 0],
            },
          },
        },
      },
      // Filter out null emails
      {
        $match: {
          _id: { $ne: null, $ne: "" },
        },
      },
      // Sort by total spent (highest first)
      {
        $sort: { totalSpent: -1 },
      },
      // Add pagination
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
    ]);

    res.status(200).json({
      success: true,
      count: customers.length,
      data: customers,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get details for a specific customer
exports.getCustomerDetail = async (req, res) => {
  try {
    const customerEmail = req.params.email;

    // Validate email parameter
    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: "Customer email is required",
      });
    }

    console.log("Customer email:", customerEmail);

    // Find all carts for this customer
    const carts = await Cart.find({ customerEmail: customerEmail }).sort({
      createDate: -1,
    });

    if (carts.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No customer found with this email",
      });
    }

    // Calculate customer metrics
    const customerData = {
      email: customerEmail,
      name: carts[0].customerName,
      totalCarts: carts.length,
      completedPurchases: carts.filter((c) => c.status === "converted").length,
      abandonedCarts: carts.filter((c) => c.status === "abandoned").length,
      totalSpent: carts.reduce(
        (sum, cart) =>
          cart.status === "converted"
            ? sum + (cart.totalIncludingTaxes || 0)
            : sum,
        0
      ),
      avgOrderValue:
        carts
          .filter((c) => c.status === "converted")
          .reduce((sum, cart) => sum + (cart.totalIncludingTaxes || 0), 0) /
        (carts.filter((c) => c.status === "converted").length || 1),
      lastPurchaseDate: carts
        .filter((c) => c.status === "converted")
        .sort((a, b) => new Date(b.createDate) - new Date(a.createDate))[0]
        ?.createDate,
      contactInfo: carts[0].contactInfo,
      carts: carts,
    };

    res.status(200).json({
      success: true,
      data: customerData,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Create a new cart (for testing purposes)
exports.createCart = async (req, res) => {
  try {
    const cart = await Cart.create(req.body);
    res.status(201).json({ success: true, data: cart });
  } catch (error) {
    handleError(res, error);
  }
};

// Update a cart
exports.updateCart = async (req, res) => {
  try {
    const cart = await Cart.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    res.status(200).json({ success: true, data: cart });
  } catch (error) {
    handleError(res, error);
  }
};

// Delete a cart
exports.deleteCart = async (req, res) => {
  try {
    const cart = await Cart.findByIdAndDelete(req.params.id);

    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    handleError(res, error);
  }
};
