// routes/applicationUsage.routes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const applicationUsageController = require("../controllers/applicationUsage.controller");
const { auth } = require("../middleware/auth"); // Assuming you have authentication middleware

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // Make sure this directory exists
  },
  filename: function (req, file, cb) {
    cb(null, `app-usage-${Date.now()}${path.extname(file.originalname)}`);
  },
});

// Filter for CSV files only
const csvFilter = (req, file, cb) => {
  if (
    file.mimetype === "text/csv" ||
    file.originalname.endsWith(".csv") ||
    file.mimetype === "application/vnd.ms-excel"
  ) {
    cb(null, true);
  } else {
    cb(new Error("Please upload only CSV files"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: csvFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
});

// Routes
router.post(
  "/upload",
  upload.any(),
  applicationUsageController.processApplicationUsageCSV
);

router.get(
  "/user/:id/analytics",
  auth, // Ensure the user is authenticated
  applicationUsageController.getUserApplicationAnalytics
);

module.exports = router;
