const cron = require("node-cron");
const axios = require("axios");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const DeskTime = require("../models/desktime.model");
const ApplicationUsage = require("../models/applicationUsage.model");
const timeParser = require("../utils/time-parser");

// Load environment variables
dotenv.config();

// DeskTime API configuration
const DESKTIME_API_KEY = process.env.DESKTIME_API_KEY || "38e1b1d09f38a13fc576fba2b8beafe6";
const DESKTIME_API_BASE_URL = "https://desktime.com/api/v2/json";
const DESKTIME_EMPLOYEE_LIST_URL = `${DESKTIME_API_BASE_URL}/employees`;
const DESKTIME_EMPLOYEE_APPS_URL = `${DESKTIME_API_BASE_URL}/employee/apps`;

// Connect to MongoDB (if not already connected in your main app)
if (!mongoose.connection.readyState) {
  mongoose
    .connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => console.log("MongoDB connected for DeskTime"))
    .catch((err) => console.error("MongoDB connection error:", err));
}

/**
 * Formats a duration in seconds to HH:MM:SS format
 * @param {Number} seconds - Duration in seconds
 * @returns {String} Formatted time string
 */
function formatSecondsToTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(remainingSeconds).padStart(2, "0")}`;
}

/**
 * Convert seconds to hours with decimal points
 * @param {Number} seconds - Duration in seconds
 * @returns {Number} Hours as decimal
 */
function secondsToHours(seconds) {
  if (!seconds || isNaN(seconds)) return 0;
  return parseFloat((seconds / 3600).toFixed(2));
}

/**
 * Fetch all employees from DeskTime API
 * @returns {Promise<Array>} List of employee IDs
 */
async function fetchAllEmployees() {
  try {
    const response = await axios({
      method: "GET",
      url: DESKTIME_EMPLOYEE_LIST_URL,
      params: {
        apiKey: DESKTIME_API_KEY
      }
    });

    // Process the nested employees object format
    if (!response.data || !response.data.employees) {
      console.warn("Invalid response format from DeskTime API:", response.data);
      return [];
    }

    // The response contains employees grouped by date
    const employeeIds = [];
    const employeesByDate = response.data.employees;
    
    // Process all dates
    for (const date in employeesByDate) {
      const employeesForDate = employeesByDate[date];
      
      // Extract the employee IDs
      for (const employeeId in employeesForDate) {
        employeeIds.push(employeeId);
      }
    }

    console.log(`Retrieved ${employeeIds.length} employee IDs from DeskTime API`);
    return employeeIds;
  } catch (error) {
    console.error("Error fetching employees from DeskTime API:", 
      error.response?.data || error.message);
    return [];
  }
}

/**
 * Map DeskTime API response to our DeskTime model
 * @param {Object} employeeData - Data from DeskTime API
 * @param {Date} date - The date for this data
 * @returns {Object} Mapped data for DeskTime model
 */
function mapToDeskTimeModel(employeeData, date) {
  // Generate a batch ID for this import
  const batchId = `desktime_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // Calculate unproductive and neutral time - need to sum from apps data
  let unproductiveSeconds = 0;
  let neutralSeconds = 0;

  if (employeeData.apps) {
    // Unproductive apps (category -1)
    if (employeeData.apps["-1"]) {
      Object.values(employeeData.apps["-1"]).forEach(app => {
        if (app.duration) unproductiveSeconds += app.duration;
      });
    }

    // Neutral apps (category 0)
    if (employeeData.apps["0"]) {
      Object.values(employeeData.apps["0"]).forEach(app => {
        if (app.duration) neutralSeconds += app.duration;
      });
    }
  }

  return {
    date: date,
    userId: employeeData.id.toString(),
    name: employeeData.name || "",
    email: employeeData.email || "",
    userRoles: "", // Not provided in API response
    group: employeeData.group || "",
    absence: "", // Not provided in API response
    productiveTime: formatSecondsToTime(employeeData.productiveTime || 0),
    unproductiveTime: formatSecondsToTime(unproductiveSeconds),
    neutralTime: formatSecondsToTime(neutralSeconds),
    totalDeskTime: formatSecondsToTime(employeeData.desktimeTime || 0),
    offlineTime: formatSecondsToTime(employeeData.offlineTime || 0),
    privateTime: "00:00:00", // Not provided in API response
    arrived: employeeData.arrived ? "Yes" : "No",
    left: employeeData.left ? "Yes" : "No",
    late: employeeData.late ? "Yes" : "No",
    totalTimeAtWork: formatSecondsToTime(employeeData.atWorkTime || 0),
    idleTime: "00:00:00", // Not provided in API response
    extraHoursBeforeWork: formatSecondsToTime(employeeData.beforeWorkTime || 0),
    extraHoursAfterWork: formatSecondsToTime(employeeData.afterWorkTime || 0),
    hourlyRate: 0, // Not provided in API response
    metadata: {
      batchId: batchId,
      uploadedAt: new Date(),
      uploadedBy: "system",
      originalFilename: "api_import",
    },
  };
}

/**
 * Map application data from DeskTime API to our ApplicationUsage model
 * @param {Object} employeeData - Data from DeskTime API
 * @param {Date} date - The date for this data
 * @returns {Array} Array of application usage records
 */
function mapToApplicationUsageModels(employeeData, date) {
  // Generate a batch ID for this import
  const batchId = `desktime_apps_${Date.now()}_${Math.floor(
    Math.random() * 1000
  )}`;
  const appRecords = [];

  // Process all app categories (0, 1, -1, etc.)
  Object.keys(employeeData.apps || {}).forEach((category) => {
    const categoryApps = employeeData.apps[category];

    // Map each app in this category
    Object.keys(categoryApps).forEach((appKey) => {
      const app = categoryApps[appKey];

      // Skip if duration is not provided or zero
      if (!app.duration) return;

      // Map productivity category based on the category number
      let productivity;
      switch (category) {
        case "1":
          productivity = "Productive";
          break;
        case "0":
          productivity = "Neutral";
          break;
        case "-1":
          productivity = "Unproductive";
          break;
        default:
          productivity = "Unknown";
      }

      // Create app usage record
      appRecords.push({
        date: date,
        userId: employeeData.id.toString(),
        name: employeeData.name || "",
        email: employeeData.email || "",
        userRoles: "", // Not provided in API response
        group: employeeData.group || "",
        application: app.name || app.app || "Unknown",
        productivity: productivity,
        timeSpent: formatSecondsToTime(app.duration),
        timeSpentHours: secondsToHours(app.duration),
        metadata: {
          batchId: batchId,
          uploadedAt: new Date(),
          uploadedBy: "system",
          originalFilename: "api_import",
        },
      });
    });
  });

  return appRecords;
}

/**
 * Fetch employee data from DeskTime API for a specific date
 * @param {String} employeeId - DeskTime employee ID
 * @param {Date} date - Date to fetch data for
 * @returns {Promise<Object>} - API response data
 */
async function fetchEmployeeData(employeeId, date) {
  const formattedDate = date.toISOString().split("T")[0]; // Format: YYYY-MM-DD

  try {
    const response = await axios({
      method: "GET",
      url: DESKTIME_EMPLOYEE_APPS_URL,
      params: {
        apiKey: DESKTIME_API_KEY,
        id: employeeId,
        date: formattedDate,
      },
    });

    return response.data;
  } catch (error) {
    console.error(
      `Error fetching DeskTime data for employee ${employeeId} on ${formattedDate}:`,
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Process and save employee data for a specific date
 * @param {String} employeeId - DeskTime employee ID
 * @param {Date} date - Date to process data for
 * @returns {Promise<Object>} - Results of the operation
 */
async function processEmployeeData(employeeId, date) {
  try {
    console.log(
      `Fetching DeskTime data for employee ${employeeId} on ${
        date.toISOString().split("T")[0]
      }`
    );

    // Fetch data from DeskTime API
    const employeeData = await fetchEmployeeData(employeeId, date);

    // Ensure we have valid data with required fields
    if (!employeeData || !employeeData.id) {
      console.warn(`No valid data returned for employee ${employeeId}`);
      return { success: false, message: "No valid data returned" };
    }

    // Skip if no email is available - we need this for linking records
    if (!employeeData.email) {
      console.warn(`No email available for employee ${employeeId}, skipping`);
      return { success: false, message: "No email available for linking" };
    }

    // Map data to our models
    const deskTimeRecord = mapToDeskTimeModel(employeeData, date);
    const appUsageRecords = mapToApplicationUsageModels(employeeData, date);

    // Save DeskTime record
    await DeskTime.findOneAndUpdate(
      {
        email: deskTimeRecord.email, // Using email as the primary identifier
        date: deskTimeRecord.date,
      },
      deskTimeRecord,
      { upsert: true, new: true }
    );

    // Save Application Usage records
    let savedAppCount = 0;
    for (const record of appUsageRecords) {
      await ApplicationUsage.findOneAndUpdate(
        {
          email: record.email, // Using email as the primary identifier
          date: record.date,
          application: record.application,
        },
        record,
        { upsert: true, new: true }
      );
      savedAppCount++;
    }

    console.log(
      `Successfully processed data for employee ${employeeId} (${employeeData.email}): DeskTime record saved, ${savedAppCount} application records saved`
    );

    return {
      success: true,
      employeeId,
      email: employeeData.email,
      date: date.toISOString().split("T")[0],
      appRecordsSaved: savedAppCount,
    };
  } catch (error) {
    console.error(`Error processing employee ${employeeId} data:`, error);
    return {
      success: false,
      employeeId,
      date: date.toISOString().split("T")[0],
      error: error.message,
    };
  }
}

/**
 * Process data for all employees for a specific date
 * @param {Date} date - The date to process
 */
async function processDailyData(date) {
  console.log(`Starting DeskTime data sync for ${date.toISOString().split("T")[0]}`);

  // First, fetch all employee IDs
  const employeeIds = await fetchAllEmployees();

  if (!employeeIds.length) {
    console.error("No employees found to process");
    return {
      success: false,
      error: "No employees found",
      date: date.toISOString().split("T")[0]
    };
  }

  const results = {
    success: [],
    errors: [],
    date: date.toISOString().split("T")[0],
    totalEmployees: employeeIds.length
  };

  // Process each employee
  for (const employeeId of employeeIds) {
    try {
      const result = await processEmployeeData(employeeId, date);

      if (result.success) {
        results.success.push(result);
      } else {
        results.errors.push(result);
      }
    } catch (error) {
      console.error(`Failed to process employee ${employeeId}:`, error);
      results.errors.push({
        employeeId: employeeId,
        date: date.toISOString().split("T")[0],
        error: error.message,
      });
    }

    // Add a small delay between API requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(
    `DeskTime data sync completed for ${date.toISOString().split("T")[0]}. ` +
    `Successes: ${results.success.length}, Errors: ${results.errors.length}, ` +
    `Total employees: ${results.totalEmployees}`
  );
  
  return results;
}

/**
 * Process data for all employees for yesterday
 */
async function processYesterdayData() {
  // Calculate yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  return processDailyData(yesterday);
}

/**
 * Process data for all employees for today (current date)
 */
async function processTodayData() {
  // Get today's date
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return processDailyData(today);
}

/**
 * Process data for a date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 */
async function processDateRange(startDate, endDate) {
  console.log(
    `Starting DeskTime data sync for range: ${
      startDate.toISOString().split("T")[0]
    } to ${endDate.toISOString().split("T")[0]}`
  );

  const results = {
    success: [],
    errors: [],
    dateRange: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0]
    }
  };

  // Clone the start date to avoid modifying the original
  let currentDate = new Date(startDate);

  // Process each day in the range
  while (currentDate <= endDate) {
    console.log(`Processing date: ${currentDate.toISOString().split("T")[0]}`);
    
    const dailyResult = await processDailyData(new Date(currentDate));
    
    // Combine results
    results.success = [...results.success, ...dailyResult.success];
    results.errors = [...results.errors, ...dailyResult.errors];
    
    // Move to the next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log(
    `DeskTime data range sync completed. ` +
    `Total successes: ${results.success.length}, ` +
    `Total errors: ${results.errors.length}`
  );
  
  return results;
}

// Schedule the task to run daily at 3:00 AM
// Changed from every minute (* * * * *) to 3 AM daily (0 3 * * *)
cron.schedule("0 1 * * *", async () => {
  console.log("Running scheduled DeskTime data fetch task");
  await processYesterdayData();
});

// Initialize job
console.log("DeskTime daily data fetch scheduler initialized");

module.exports = {
  processYesterdayData,
  processTodayData,
  processDailyData,
  processDateRange,
  // Export these for testing purposes
  mapToDeskTimeModel,
  mapToApplicationUsageModels,
  fetchAllEmployees
};