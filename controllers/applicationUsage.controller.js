// controllers/applicationUsage.controller.js
const ApplicationUsage = require("../models/applicationUsage.model");
const User = require("../models/User");
const mongoose = require("mongoose");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const timeParser = require("../utils/time-parser");

/**
 * Process and save application usage data from a CSV file
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.processApplicationUsageCSV = async (req, res) => {
  try {
    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV file",
      });
    }

    const file = req.files[0]; // Get the first file
    const filePath = file.path;
    const batchId = uuidv4(); // Generate a unique batch ID
    const results = [];
    const errors = [];
    let processedCount = 0;

    // Create a read stream for the CSV file
    const stream = fs.createReadStream(filePath).pipe(
      csv({
        skipLines: 0, // Skip header line if needed
        headers: [
          // Define the headers based on your CSV format
          "Date",
          "User ID",
          "Name",
          "Email",
          "User Roles",
          "Group",
          "Application",
          "Productivity",
          "Time",
        ],
      })
    );

    // Process each row from the CSV file
    for await (const row of stream) {
      try {
        // Parse the date - try direct parsing first (works for YYYY-MM-DD format)
        let date = new Date(row.Date);
        
        // If direct parsing fails, try other formats
        if (isNaN(date.getTime())) {
          const dateParts = row.Date.split(/[\/\-]/); // Split by either / or -
          
          if (dateParts.length === 3) {
            // Try DD/MM/YYYY format
            date = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
            
            // If date is still invalid, try MM/DD/YYYY format
            if (isNaN(date.getTime())) {
              date = new Date(`${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`);
            }
          }
        }

        // Validate the date
        if (isNaN(date.getTime())) {
          console.error(`Invalid date format: ${row.Date}`);
          // Use current date as fallback
          date = new Date();
        }

        // Convert time spent to hours
        const timeSpentHours = timeParser.parseTimeToHours(row.Time);

        // Create a new application usage record
        const appUsage = new ApplicationUsage({
          date: date,
          userId: row["User ID"],
          name: row.Name,
          email: row.Email,
          userRoles: row["User Roles"],
          group: row.Group,
          application: row.Application,
          productivity: row.Productivity.toLowerCase(), // Normalize to lowercase
          timeSpent: row.Time,
          timeSpentHours: timeSpentHours,
          metadata: {
            batchId: batchId,
            uploadedAt: new Date(),
            uploadedBy: req.user ? req.user._id : "system",
            originalFilename: file.originalname,
          },
        });

        // Save the record to the database
        await appUsage.save();

        processedCount++;
        results.push({
          userId: row["User ID"],
          date: date,
          application: row.Application,
          timeSpent: row.Time,
        });
      } catch (error) {
        console.error(`Error processing row: ${JSON.stringify(row)}`, error);
        errors.push({
          row: row,
          error: error.message,
        });
      }
    }

    // Delete the temporary file after processing
    fs.unlinkSync(filePath);

    // Return the results
    res.status(200).json({
      success: true,
      message: `Successfully processed ${processedCount} application usage records`,
      batchId: batchId,
      processed: processedCount,
      errors: errors.length,
      errorDetails: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error processing application usage CSV:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * Get application usage analytics for a specific user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.getUserApplicationAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Both startDate and endDate are required",
      });
    }

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    const userEmail = await User.findById(id).select("email");

    // Get user's application usage data
    const appUsageData = await ApplicationUsage.find({
      email: userEmail.email,
      date: { $gte: start, $lte: end },
    });

    // Group applications by productivity category
    const productiveApps = [];
    const unproductiveApps = [];
    const neutralApps = [];

    let totalProductiveTime = 0;
    let totalUnproductiveTime = 0;
    let totalNeutralTime = 0;

    // Process application usage data
    const appUsageMap = {};

    appUsageData.forEach((record) => {
      // Group by application
      if (!appUsageMap[record.application]) {
        appUsageMap[record.application] = {
          application: record.application,
          productivity: record.productivity,
          totalTimeHours: 0,
          usageCount: 0,
        };
      }

      appUsageMap[record.application].totalTimeHours += record.timeSpentHours;
      appUsageMap[record.application].usageCount += 1;

      // Track time by productivity category
      if (record.productivity === "productive") {
        totalProductiveTime += record.timeSpentHours;
      } else if (record.productivity === "unproductive") {
        totalUnproductiveTime += record.timeSpentHours;
      } else {
        totalNeutralTime += record.timeSpentHours;
      }
    });

    // Sort applications by time spent and categorize
    Object.values(appUsageMap).forEach((app) => {
      app.totalTimeHours = parseFloat(app.totalTimeHours.toFixed(2));

      if (app.productivity === "productive") {
        productiveApps.push(app);
      } else if (app.productivity === "unproductive") {
        unproductiveApps.push(app);
      } else {
        neutralApps.push(app);
      }
    });

    // Sort each category by time spent
    productiveApps.sort((a, b) => b.totalTimeHours - a.totalTimeHours);
    unproductiveApps.sort((a, b) => b.totalTimeHours - a.totalTimeHours);
    neutralApps.sort((a, b) => b.totalTimeHours - a.totalTimeHours);

    // Calculate total time spent
    const totalTimeHours =
      totalProductiveTime + totalUnproductiveTime + totalNeutralTime;

    // Calculate productivity percentages
    const productivityPercentage =
      totalTimeHours > 0 ? (totalProductiveTime / totalTimeHours) * 100 : 0;

    const unproductivityPercentage =
      totalTimeHours > 0 ? (totalUnproductiveTime / totalTimeHours) * 100 : 0;

    const neutralPercentage =
      totalTimeHours > 0 ? (totalNeutralTime / totalTimeHours) * 100 : 0;

    // Return the results
    res.status(200).json({
      success: true,
      userId: id,
      summary: {
        totalApplications: Object.keys(appUsageMap).length,
        totalTimeHours: parseFloat(totalTimeHours.toFixed(2)),
        productiveTimeHours: parseFloat(totalProductiveTime.toFixed(2)),
        unproductiveTimeHours: parseFloat(totalUnproductiveTime.toFixed(2)),
        neutralTimeHours: parseFloat(totalNeutralTime.toFixed(2)),
        productivityPercentage: parseFloat(productivityPercentage.toFixed(2)),
        unproductivityPercentage: parseFloat(
          unproductivityPercentage.toFixed(2)
        ),
        neutralPercentage: parseFloat(neutralPercentage.toFixed(2)),
      },
      applications: {
        productive: productiveApps.slice(0, 10), // Return top 10
        unproductive: unproductiveApps.slice(0, 10),
        neutral: neutralApps.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("Error getting user application analytics:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
