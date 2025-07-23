// routes/cartRoutes.js
const express = require("express");
const router = express.Router();
const cartController = require("../controllers/ac.controller");
const {auth} = require("../middleware/auth"); // Assuming you have auth middleware


// Basic cart operations
router.get("/", cartController.getCarts);
router.post("/", cartController.createCart);
router.put("/:id", cartController.updateCart);
router.delete("/:id", cartController.deleteCart);

// Abandoned cart specific endpoints
router.get("/abandoned", cartController.getAbandonedCarts);

// Analytics endpoints
router.get("/analytics/categories", cartController.getAbandonedCartCategories);
router.get("/analytics/top-products", cartController.getTopAbandonedProducts);
router.get("/analytics/time", cartController.getAbandonedCartTimeAnalytics);
router.get("/analytics/conversion-stats", cartController.getConversionStats);

// Recovery opportunities
router.get(
  "/recovery-opportunities",
  cartController.getAbandonedCartRecoveryOpportunities
);

// Export functionality
router.get("/export", cartController.exportAbandonedCarts);

// Customer related endpoints
router.get("/customers", cartController.getCustomers);
router.get("/customers/:email", cartController.getCustomerDetail);

module.exports = router;
