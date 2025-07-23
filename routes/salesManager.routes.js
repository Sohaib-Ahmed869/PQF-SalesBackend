// routes/salesManagerRoutes.js
const express = require("express");
const router = express.Router();
const salesManagerController = require("../controllers/salesManager.controller");
const { auth, checkRole, updateLastLogin } = require("../middleware/auth");

// Get team members (sales agents) for the current sales manager
router.get(
  "/team",
  salesManagerController.getTeamMembers
);

// Get performance metrics for sales agents in the team
router.get(
  "/team/performance",
  auth,

  salesManagerController.getTeamPerformance
);

// Get analytics dashboard data for the sales manager
router.get(
  "/dashboard",
  auth,
  salesManagerController.getAnalyticsDashboard
);

// Get individual agent performance details
router.get(
  "/agent/:agentId/performance",
  auth,
  salesManagerController.getAgentPerformanceDetails
);

module.exports = router;
