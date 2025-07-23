// routes/dashboard.js
const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");
const {auth} = require("../middleware/auth"); // Assuming you have auth middleware

// Middleware to check if user is a sales manager or admin
const checkManagerOrAdmin = (req, res, next) => {
  if (req.user.role === "sales_manager" || req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({
    success: false,
    message:
      "Access denied. Only sales managers and admins can access this resource.",
  });
};

// Get sales manager dashboard data
router.get(
  "/manager",
  auth,
  checkManagerOrAdmin,
  dashboardController.getSalesManagerDashboard
);

// Get sales agent dashboard data
router.get(
  "/agent/:agentId",
  auth,
  checkManagerOrAdmin,
  dashboardController.getSalesAgentDashboard
);

router.get("/team-calls", auth, dashboardController.getTeamRecentCalls);

module.exports = router;
