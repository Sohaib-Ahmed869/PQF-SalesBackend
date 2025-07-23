// routes/salesPerformance.routes.js
const express = require("express");
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const DeskTime = require('../models/desktime.model');
const salesPerformanceController = require("../controllers/desktime.controller");
const { auth, checkRole, updateLastLogin } = require("../middleware/auth");

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept only excel files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed!'), false);
    }
  }
});
// Route for getting all DeskTime records for a specific sales agent
// @route   GET /api/performance/agent/:id
// @access  Private (Admin, Sales Manager, or Self)
router.get(
  "/agent/:id",
  auth,
  updateLastLogin,
  (req, res, next) => {
    // Allow admin and sales_manager to access any agent's data
    if (req.user.role === "admin" || req.user.role === "sales_manager") {
      return next();
    }

    // Allow sales agents to access only their own data
    if (req.params.id === req.user._id.toString()) {
      return next();
    }

    // Deny access to others
    return res.status(403).json({
      success: false,
      message: "Access denied. You can only view your own performance data.",
    });
  },
  salesPerformanceController.getSalesAgentRecords
);

// Route for getting DeskTime records for a specific sales agent in a date range
// @route   GET /api/performance/agent/:id/time
// @access  Private (Admin, Sales Manager, or Self)
router.get(
  "/agent/:id/time",
  auth,
  updateLastLogin,
  (req, res, next) => {
    // Allow admin and sales_manager to access any agent's data
    if (req.user.role === "admin" || req.user.role === "sales_manager") {
      return next();
    }

    // Allow sales agents to access only their own data
    if (req.params.id === req.user._id.toString()) {
      return next();
    }

    // Deny access to others
    return res.status(403).json({
      success: false,
      message: "Access denied. You can only view your own performance data.",
    });
  },
  salesPerformanceController.getSalesAgentTimeRecords
);

// Route for getting overall team performance metrics
// @route   GET /api/performance/overall
// @access  Private (Admin, Sales Manager)
router.get(
  "/overall",
  auth,
  updateLastLogin,
  checkRole(["admin", "sales_manager"]),
  salesPerformanceController.getOverallPerformance
);

// Route for getting detailed performance for a specific sales agent
// @route   GET /api/performance/agent/:id/performance
// @access  Private (Admin, Sales Manager, or Self)
router.get(
  "/agent/:id/performance",
  auth,
  updateLastLogin,
  (req, res, next) => {
    // Allow admin and sales_manager to access any agent's data
    if (req.user.role === "admin" || req.user.role === "sales_manager") {
      return next();
    }

    // Allow sales agents to access only their own data
    if (req.params.id === req.user._id.toString()) {
      return next();
    }

    // Deny access to others
    return res.status(403).json({
      success: false,
      message: "Access denied. You can only view your own performance data.",
    });
  },
  salesPerformanceController.getSalesAgentPerformance
);


/**
 * @route   POST /api/desktime/upload
 * @desc    Upload and process DeskTime Excel file
 * @access  Private (admin only)
 */
router.post('/upload', upload.single('desktimeFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Check user permissions (optional - uncomment if needed)
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Permission denied: Admin access required'
    //   });
    // }

    // Generate a batch ID for this upload
    const batchId = uuidv4();
    const uploadedBy = req.user ? req.user.id : 'system';
    const originalFilename = req.file.originalname;

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to JSON with header rows
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'yyyy-mm-dd' });

    if (!data || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Excel file contains no data or is in an invalid format'
      });
    }

    console.log('Sample row:', data[0]);

    // Prepare data for insertion
    const records = [];
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      try {
        // Extract date from the Excel data
        let dateValue = row['Date'] || row['date'];
        
        // If date is not in ISO format, parse it
        let date;
        if (dateValue) {
          if (typeof dateValue === 'string') {
            // Handle various date formats
            if (dateValue.includes('/')) {
              // Handle MM/DD/YYYY or DD/MM/YYYY
              const parts = dateValue.split('/');
              // Assuming MM/DD/YYYY format
              date = new Date(parts[2], parts[0] - 1, parts[1]);
            } else {
              // Try as ISO format YYYY-MM-DD
              date = new Date(dateValue);
            }
          } else {
            // If it's a date object or Excel serial number
            date = new Date(dateValue);
          }
        }

        if (!date || isNaN(date.getTime())) {
          throw new Error(`Invalid date format: ${dateValue}`);
        }

        // Map Excel columns to model fields
        const record = {
          date,
          userId: row['User ID'] || row['userId'] || row['user_id'] || '',
          name: row['Name'] || row['name'] || '',
          email: row['Email'] || row['email'] || '',
          userRoles: row['User Roles'] || row['userRoles'] || row['user_roles'] || '',
          group: row['Group'] || row['group'] || '',
          absence: row['Absence'] || row['absence'] || '',
          productiveTime: row['Productive time'] || row['productiveTime'] || row['productive_time'] || '',
          unproductiveTime: row['Unproductive time'] || row['unproductiveTime'] || row['unproductive_time'] || '',
          neutralTime: row['Neutral time'] || row['neutralTime'] || row['neutral_time'] || '',
          totalDeskTime: row['Total DeskTime'] || row['totalDeskTime'] || row['total_desk_time'] || '',
          offlineTime: row['Offline time'] || row['offlineTime'] || row['offline_time'] || '',
          privateTime: row['Private time'] || row['privateTime'] || row['private_time'] || '',
          arrived: row['Arrived'] || row['arrived'] || '',
          left: row['Left'] || row['left'] || '',
          late: row['Late'] || row['late'] || '',
          totalTimeAtWork: row['Total time at work'] || row['totalTimeAtWork'] || row['total_time_at_work'] || '',
          idleTime: row['Idle time'] || row['idleTime'] || row['idle_time'] || '',
          extraHoursBeforeWork: row['Extra hours before work'] || row['extraHoursBeforeWork'] || row['extra_hours_before_work'] || '',
          extraHoursAfterWork: row['Extra hours after work'] || row['extraHoursAfterWork'] || row['extra_hours_after_work'] || '',
          hourlyRate: parseFloat(row['Hourly rate'] || row['hourlyRate'] || row['hourly_rate'] || 0),
          metadata: {
            batchId,
            uploadedAt: new Date(),
            uploadedBy,
            originalFilename
          }
        };

        // Validate required fields
        if (!record.userId || !record.name || !record.email) {
          throw new Error('Missing required fields: userId, name, or email');
        }

        records.push(record);
      } catch (error) {
        errors.push({
          row: i + 1,
          error: error.message
        });
      }
    }

    if (errors.length > 0 && records.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid records found in the file',
        errors
      });
    }

    // Insert records into database
    const result = await DeskTime.insertMany(records, { ordered: false });

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${result.length} DeskTime records`,
      batchId,
      totalRecords: result.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error processing DeskTime upload:', error);
    res.status(500).json({
      success: false,
      message: 'Server error processing file upload',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/desktime/batches
 * @desc    Get list of all upload batches
 * @access  Private
 */
router.get('/batches', auth, async (req, res) => {
  try {
    const batches = await DeskTime.aggregate([
      { $group: { 
        _id: '$metadata.batchId',
        uploadedAt: { $first: '$metadata.uploadedAt' },
        uploadedBy: { $first: '$metadata.uploadedBy' },
        originalFilename: { $first: '$metadata.originalFilename' },
        recordCount: { $sum: 1 }
      }},
      { $sort: { uploadedAt: -1 } }
    ]);

    res.status(200).json({
      success: true,
      count: batches.length,
      data: batches
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error retrieving batches',
      error: error.message
    });
  }
});


module.exports = router;
