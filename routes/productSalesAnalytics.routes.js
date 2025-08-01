const express = require("express");
const router = express.Router();
const {
  getProductSalesAnalytics,
  getProductSalesData,
  getCustomers,
  getProductPerformanceComparison,
  getItems,
} = require("../controllers/productSalesAnalytics.controller");

// Analytics dashboard endpoint
router.get("/analytics", getProductSalesAnalytics);
router.get("/customers", getCustomers);
// Paginated data endpoint
router.get("/data", getProductSalesData);
router.get("/items", getItems);

// Product performance comparison
router.get("/comparison", getProductPerformanceComparison);

module.exports = router;
