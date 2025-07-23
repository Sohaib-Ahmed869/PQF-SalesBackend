const ProductSales = require("../models/CustomerProductSales");
const Customer = require("../models/Customer");

/**
 * Get products purchased by a specific customer
 * @route GET /api/customers/:cardCode/products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getCustomerProducts = async (req, res) => {
  try {
    const { cardCode } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || "dateStored";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
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

    // Fetch products purchased by the customer with pagination
    const products = await ProductSales.find({ customerId: cardCode })
      .sort(sortObject)
      .skip(skip)
      .limit(limit)
      .lean(); // Use lean() for better performance

    // Get total count for pagination info
    const totalProducts = await ProductSales.countDocuments({
      customerId: cardCode,
    });
    const totalPages = Math.ceil(totalProducts / limit);

    // Calculate totals for summary
    const totalStats = await ProductSales.aggregate([
      { $match: { customerId: cardCode } },
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

    const summary =
      totalStats.length > 0
        ? totalStats[0]
        : {
            totalQuantity: 0,
            totalAmount: 0,
            totalCostOfSales: 0,
            totalGrossProfit: 0,
          };

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
 * Get all customers with their product purchase summary
 * @route GET /api/customers/products-summary
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getCustomersProductsSummary = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || "totalAmount";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
      });
    }

    const skip = (page - 1) * limit;

    // Aggregate customer purchase data
    const customersSummary = await ProductSales.aggregate([
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

    // Get total count of customers with purchases
    const totalCustomersCount = await ProductSales.aggregate([
      { $group: { _id: "$customerId" } },
      { $count: "total" },
    ]);

    const totalCustomers =
      totalCustomersCount.length > 0 ? totalCustomersCount[0].total : 0;
    const totalPages = Math.ceil(totalCustomers / limit);

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
