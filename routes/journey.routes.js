// routes/customerJourney.routes.js
const express = require("express");
const router = express.Router();
const customerJourneyController = require("../controllers/customerjourney.controller");
const { auth } = require("../middleware/auth");

router.get('/invoices/by-segment', customerJourneyController.getInvoicesBySegment);
/**
 * @route   GET /api/customer-journey/analytics
 * @desc    Get global customer journey analytics across all customers
 * @access  Admin, Sales Manager
 */
router.get(
  "/analytics",
  auth,
  customerJourneyController.getCustomerJourneyAnalytics
);

/**
 * @route   GET /api/customer-journey/summary
 * @desc    Get customer journey summary for all customers
 * @access  Admin, Sales Manager
 */
router.get(
  "/summary",
  auth,
  customerJourneyController.getCustomerJourneySummary
);

/**
 * @route   GET /api/customer-journey/:customerId
 * @desc    Get customer journey for a specific customer
 * @access  Admin, Sales Manager, Sales Agent (for assigned customers)
 */
router.get("/:customerId", customerJourneyController.getCustomerJourney);

/**
 * @route   GET /api/customer-journey/:customerId/timeline
 * @desc    Get detailed interaction timeline for a specific customer
 * @access  Admin, Sales Manager, Sales Agent (for assigned customers)
 */
router.get(
  "/:customerId/timeline",
  customerJourneyController.getCustomerInteractionTimeline
);

module.exports = router;
