// routes/recommendations.js
const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const {
  getRecommendations,
} = require("../controllers/recommendations.controller");

/**
 * @route   GET /api/recommendations
 * @desc    Get personalized recommendations based on user role
 * @access  Private (Sales Agents, Sales Managers, Admin)
 */
router.get("/", auth, getRecommendations);

module.exports = router;
