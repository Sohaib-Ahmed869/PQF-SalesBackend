// routes/salesManagerDashboard.routes.js
const express = require("express");
const router = express.Router();
const salesManagerDashboardController = require("../controllers/salesManagerDashboard.controller");
const {auth} = require("../middleware/auth");

// Apply authentication and role check to all routes
router.use(auth);

/**
 * @route   GET /api/sales-manager-dashboard
 * @desc    Get comprehensive sales manager dashboard data
 * @access  Sales Manager, Admin
 * @query   startDate, endDate (optional)
 */
router.get("/", salesManagerDashboardController.getDashboard);

/**
 * @route   GET /api/sales-manager-dashboard/team-overview
 * @desc    Get team overview with basic stats
 * @access  Sales Manager, Admin
 */
router.get("/team-overview", salesManagerDashboardController.getTeamOverview);

/**
 * @route   GET /api/sales-manager-dashboard/team-calls
 * @desc    Get team calls data and statistics
 * @access  Sales Manager, Admin
 * @query   startDate, endDate, limit (optional)
 */
router.get("/team-calls", salesManagerDashboardController.getTeamCalls);

module.exports = router;
