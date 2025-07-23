const express = require("express");
const scraperController = require("../controllers/scraper.controller");

const router = express.Router();

/**
 * @route   POST /api/scraper/jobs
 * @desc    Start a new scraping job
 * @access  Private
 */
router.post("/jobs", scraperController.startJob);

/**
 * @route   GET /api/scraper/jobs
 * @desc    Get all scraping jobs
 * @access  Private
 */
router.get("/jobs", scraperController.getJobs);

/**
 * @route   GET /api/scraper/jobs/:id
 * @desc    Get a specific job by ID
 * @access  Private
 */
router.get("/jobs/:id", scraperController.getJobById);

/**
 * @route   PUT /api/scraper/jobs/:id/sync
 * @desc    Sync job with Python API
 * @access  Private
 */
router.put("/jobs/:id/sync", scraperController.syncJob);

/**
 * @route   DELETE /api/scraper/jobs/:id
 * @desc    Delete a job
 * @access  Private
 */
router.delete("/jobs/:id", scraperController.deleteJob);

/**
 * @route   GET /api/scraper/jobs/:id/restaurants
 * @desc    Get restaurants from a specific job
 * @access  Private
 */
router.get("/jobs/:id/restaurants", scraperController.getRestaurants);

/**
 * @route   GET /api/scraper/jobs/:id/restaurants/:restaurantId
 * @desc    Get a specific restaurant from a job
 * @access  Private
 */
router.get(
  "/jobs/:id/restaurants/:restaurantId",
  scraperController.getRestaurantById
);

/**
 * @route   GET /api/scraper/status
 * @desc    Get Python API status
 * @access  Private
 */
router.get("/status", scraperController.getApiStatus);

/**
 * @route   GET /api/scraper/jobs/:jobId/restaurants/:restaurantId/ingredients
 * @desc    Analyze restaurant ingredients and match with products
 * @access  Private
 */
router.get(
  "/jobs/:jobId/restaurants/:restaurantId/ingredients",
  scraperController.analyzeRestaurantIngredients
);

module.exports = router;
