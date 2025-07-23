// routes/salesAgentJourney.routes.js
const express = require("express");
const router = express.Router();
const salesAgentJourneyController = require("../controllers/salesAgentJourney.controller");
const { auth, checkRole } = require("../middleware/auth");

// Protect all routes with authentication
router.use(auth);

/**
 * @route   GET /api/sales-agent-journey/:agentId/dashboard
 * @desc    Get comprehensive dashboard for a sales agent
 * @access  Private - admins, sales managers, and the agent themselves
 */
router.get(
  "/:agentId/dashboard",
  salesAgentJourneyController.getDashboard
);

/**
 * @route   GET /api/sales-agent-journey/:agentId/customers
 * @desc    Get customers assigned to a sales agent
 * @access  Private - admins, sales managers, and the agent themselves
 */
router.get(
  "/:agentId/customers",
  checkRole(["admin", "sales_manager", "sales_agent"]),
  salesAgentJourneyController.getAgentCustomers
);

/**
 * @route   GET /api/sales-agent-journey/:agentId/calls
 * @desc    Get call history and stats for a sales agent
 * @access  Private - admins, sales managers, and the agent themselves
 */
router.get(
  "/:agentId/calls",
  checkRole(["admin", "sales_manager", "sales_agent"]),
  salesAgentJourneyController.getAgentCalls
);

/**
 * @route   GET /api/sales-agent-journey/:agentId/sales-orders
 * @desc    Get sales order history for a sales agent
 * @access  Private - admins, sales managers, and the agent themselves
 */
router.get(
  "/:agentId/sales-orders",
  checkRole(["admin", "sales_manager", "sales_agent"]),
  salesAgentJourneyController.getAgentSalesOrders
);

/**
 * @route   GET /api/sales-agent-journey/:agentId/productivity
 * @desc    Get productivity metrics for a sales agent
 * @access  Private - admins, sales managers, and the agent themselves
 */
router.get(
  "/:agentId/productivity",
  checkRole(["admin", "sales_manager", "sales_agent"]),
  salesAgentJourneyController.getAgentProductivity
);

/**
 * @route   GET /api/sales-agent-journey/:agentId/performance
 * @desc    Get performance and target achievement metrics
 * @access  Private - admins, sales managers, and the agent themselves
 */
router.get(
  "/:agentId/performance",
  checkRole(["admin", "sales_manager", "sales_agent"]),
  salesAgentJourneyController.getAgentPerformance
);

/**
 * @route   GET /api/sales-agent-journey/:agentId/customer-journeys
 * @desc    Get customer journey insights for sales agent's customers
 * @access  Private - admins, sales managers, and the agent themselves
 */
router.get(
  "/:agentId/customer-journeys",
  checkRole(["admin", "sales_manager", "sales_agent"]),
  salesAgentJourneyController.getAgentCustomerJourneys
);
router.get(
  "/:agentId/invoices",
  auth,
  salesAgentJourneyController.getAgentInvoices
);

// Add this route after the existing routes
router.get(
  "/:agentId/attendance",
  checkRole(["admin", "sales_manager", "sales_agent"]),
  salesAgentJourneyController.getAgentAttendance
);

// Get combined orders and invoices analytics
router.get(
  "/:agentId/orders-invoices-analytics",
  auth,
  salesAgentJourneyController.getOrdersInvoicesAnalytics
);

module.exports = router;

// Add this in your main app.js or server.js file:
// app.use('/api/sales-agent-journey', require('./routes/salesAgentJourney.routes'));
