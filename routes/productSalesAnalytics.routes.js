const express = require("express");
const router = express.Router();
const {
  getProductSalesAnalytics,
  getProductSalesData,
  getCustomers,
  getProductPerformanceComparison,
} = require("../controllers/productSalesAnalytics.controller");

// Analytics dashboard endpoint
router.get("/analytics", getProductSalesAnalytics);
router.get("/customers", getCustomers);
// Paginated data endpoint
router.get("/data", getProductSalesData);

// Product performance comparison
router.get("/comparison", getProductPerformanceComparison);

module.exports = router;
