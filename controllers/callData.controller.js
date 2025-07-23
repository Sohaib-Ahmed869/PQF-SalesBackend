const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parse } = require("csv-parse");
const CallData = require("../models/CallData");
const User = require("../models/User");

// Helper function to parse CSV data
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream(filePath)
      .pipe(
        parse({
          delimiter: ";",
          columns: true,
          skip_empty_lines: true,
          trim: true,
        })
      )
      .on("data", (data) => {
        results.push(data);
      })
      .on("error", (error) => {
        reject(error);
      })
      .on("end", () => {
        resolve(results);
      });
  });
};

// Process and transform raw CSV data to match our model
const transformData = (rawData) => {
  return rawData.map((record) => {
    // Parse tags from string format "[\"Tag1\",\"Tag2\"]" to array
    let tags = [];
    if (record.Tags) {
      try {
        const tagsString = record.Tags.replace(/^\[|\]$/g, "").trim();
        tags = tagsString
          ? tagsString
              .split(",")
              .map((tag) => tag.replace(/^"|"$/g, "").trim())
              .filter((tag) => tag)
          : [];
      } catch (e) {
        console.error("Error parsing tags:", e);
      }
    }

    return {
      id: record.id,
      callID: record.CallID,
      channelID: record.ChannelID,
      type: record.type,
      direction: record.direction,
      lastState: record.LastState,
      startTime: record.StartTime ? new Date(record.StartTime) : null,
      answeredTime: record.AnsweredTime ? new Date(record.AnsweredTime) : null,
      hangupTime: record.HangupTime ? new Date(record.HangupTime) : null,
      totalDuration: parseFloat(record.TotalDuration) || 0,
      inCallDuration: parseFloat(record.InCallDuration) || 0,
      queueDuration: parseFloat(record.QueueDuration) || 0,
      holdDuration: parseFloat(record.HoldDuration) || 0,
      ringingDuration: parseFloat(record.RingingDuration) || 0,
      afterCallDuration: parseFloat(record.AfterCallDuration) || 0,
      ivrDuration: parseFloat(record.IVRDuration) || 0,
      fromNumber: record.FromNumber,
      toNumber: record.ToNumber,
      contact: record.contact,
      userID: record.UserID,
      userName: record.UserName,
      ivrID: record.IVRID,
      ivrName: record.IVRName,
      scenarioName: record.ScenarioName,
      file: record.File,
      note: record.Note,
      tags: tags,
      groups: record.Groups,
      notes: record.Notes,
      locations: record.Locations,
      digitEntered: record.DigitEntered,
      missed: record.Missed,
    };
  });
};

// Controller methods
const callDataController = {
  // Upload and process CSV file
  uploadCSV: async (req, res) => {
    try {
      const startTime = Date.now();

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("Starting CSV import...");
      const filePath = req.file.path;

      // Parse the CSV file
      const rawData = await parseCSV(filePath);
      console.log(`Parsed ${rawData.length} rows from CSV`);

      // Transform data to match our model
      const transformedData = transformData(rawData);
      console.log(`Transformed ${transformedData.length} records`);

      let savedCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;
      const errors = [];

      // First, check for existing records to avoid duplicates
      const recordIds = transformedData
        .map((record) => record.id)
        .filter((id) => id);
      const existingRecords = await CallData.find(
        { id: { $in: recordIds } },
        { id: 1 }
      ).lean();

      const existingIds = new Set(existingRecords.map((record) => record.id));
      console.log(`Found ${existingIds.size} existing records`);

      // Filter out existing records
      const newRecords = transformedData.filter((record) => {
        if (existingIds.has(record.id)) {
          duplicateCount++;
          return false;
        }
        return true;
      });

      console.log(
        `${newRecords.length} new records to insert, ${duplicateCount} duplicates skipped`
      );

      // Process new records in batches
      const batchSize = 1000;

      for (let i = 0; i < newRecords.length; i += batchSize) {
        const batch = newRecords.slice(i, i + batchSize);

        try {
          const result = await CallData.insertMany(batch, {
            ordered: false, // Continue processing even if some documents fail
          });
          savedCount += result.length;
          console.log(
            `Batch ${Math.floor(i / batchSize) + 1}: ${
              result.length
            } records saved`
          );
        } catch (error) {
          if (error.name === "BulkWriteError") {
            // Handle bulk write errors
            const writeErrors = error.writeErrors || [];
            const insertedCount = error.result?.insertedCount || 0;

            savedCount += insertedCount;

            // Process each error
            writeErrors.forEach((writeError, index) => {
              if (writeError.code === 11000) {
                // This shouldn't happen since we pre-filtered, but just in case
                duplicateCount++;
                console.log(`Unexpected duplicate found: ${writeError.errmsg}`);
              } else {
                // Other validation or processing errors
                errorCount++;
                errors.push({
                  row: i + (writeError.index || index) + 1,
                  error: writeError.errmsg || writeError.message,
                  recordId: batch[writeError.index]?.id || "unknown",
                });
              }
            });

            console.log(
              `Batch ${
                Math.floor(i / batchSize) + 1
              }: ${insertedCount} saved, ${
                writeErrors.filter((e) => e.code !== 11000).length
              } errors`
            );
          } else {
            // Non-bulk write error - try individual inserts
            console.log(`Batch failed, attempting individual inserts...`);

            for (let j = 0; j < batch.length; j++) {
              try {
                await CallData.create(batch[j]);
                savedCount++;
              } catch (individualError) {
                if (individualError.code === 11000) {
                  duplicateCount++;
                  console.log(
                    `Duplicate found during individual insert: ${batch[j].id}`
                  );
                } else {
                  errorCount++;
                  errors.push({
                    row: i + j + 1,
                    error: individualError.message,
                    recordId: batch[j]?.id || "unknown",
                  });
                }
              }
            }
          }
        }
      }

      // Clean up - remove the temporary file
      fs.unlinkSync(filePath);

      const endTime = Date.now();
      const processingTime = ((endTime - startTime) / 1000).toFixed(2);

      console.log(
        `CSV import completed: ${savedCount} saved, ${duplicateCount} duplicates, ${errorCount} errors`
      );

      return res.status(200).json({
        success: true,
        message: "CSV data processed successfully",
        data: {
          totalRowsProcessed: rawData.length,
          recordsTransformed: transformedData.length,
          recordsSaved: savedCount,
          duplicatesSkipped: duplicateCount,
          recordsWithErrors: errorCount,
          processingTimeSeconds: processingTime,
          summary: {
            successRate: `${(
              (savedCount / transformedData.length) *
              100
            ).toFixed(1)}%`,
            duplicateRate: `${(
              (duplicateCount / transformedData.length) *
              100
            ).toFixed(1)}%`,
            errorRate: `${((errorCount / transformedData.length) * 100).toFixed(
              1
            )}%`,
          },
        },
        // Only include error details if there are errors and the list isn't too long
        ...(errors.length > 0 &&
          errors.length <= 10 && {
            errorDetails: errors,
          }),
        // If there are many errors, just show a sample
        ...(errors.length > 10 && {
          errorSample: errors.slice(0, 5),
          totalErrors: errors.length,
          note: "Showing first 5 errors. Check server logs for complete error list.",
        }),
      });
    } catch (error) {
      console.error("Error processing CSV:", error);

      // If the file exists but there was an error processing it, clean up
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(500).json({
        success: false,
        error: "Error processing CSV file",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  },

  // Get all call data
  getAllCallData: async (req, res) => {
    try {
      const callData = await CallData.find();
      return res.status(200).json(callData);
    } catch (error) {
      console.error("Error fetching call data:", error);
      return res.status(500).json({
        error: "Error fetching call data",
        details: error.message,
      });
    }
  },

  // Get call data by ID
  getCallDataById: async (req, res) => {
    try {
      const { id } = req.params;
      const callData = await CallData.findOne({ id });

      if (!callData) {
        return res.status(404).json({ error: "Call data not found" });
      }

      return res.status(200).json(callData);
    } catch (error) {
      console.error("Error fetching call data by ID:", error);
      return res.status(500).json({
        error: "Error fetching call data",
        details: error.message,
      });
    }
  },

  // Delete call data by ID
  deleteCallDataById: async (req, res) => {
    try {
      const { id } = req.params;
      const result = await CallData.findOneAndDelete({ id });

      if (!result) {
        return res.status(404).json({ error: "Call data not found" });
      }

      return res
        .status(200)
        .json({ message: "Call data deleted successfully" });
    } catch (error) {
      console.error("Error deleting call data:", error);
      return res.status(500).json({
        error: "Error deleting call data",
        details: error.message,
      });
    }
  },

  getAgentCallData: async (req, res) => {
    try {
      const { phone } = req.user; // Assuming you have auth middleware that adds user to req
      if (!phone) {
        return res.status(200).json({
          data: [],
          pagination: {
            total: 0,
            page: 1,
            limit: 10,
            pages: 0,
          },
        });
      }
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Build filter object based on query params
      const filter = { fromNumber: phone };

      if (req.query.startDate && req.query.endDate) {
        filter.startTime = {
          $gte: new Date(req.query.startDate),
          $lte: new Date(req.query.endDate),
        };
      }

      if (req.query.direction) {
        filter.direction = req.query.direction;
      }

      if (req.query.type) {
        filter.type = req.query.type;
      }

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, "i");
        filter.$or = [
          { fromNumber: searchRegex },
          { toNumber: searchRegex },
          { contact: searchRegex },
        ];
      }

      // Execute query with pagination
      const callData = await CallData.find(filter)
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await CallData.countDocuments(filter);

      return res.status(200).json({
        data: callData,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error fetching agent call data:", error);
      return res.status(500).json({
        error: "Error fetching agent call data",
        details: error.message,
      });
    }
  },

  // Get call statistics for a specific agent
  getAgentCallStatistics: async (req, res) => {
    try {
      console.log("Fetching call statistics for agent:", req.user);
      const { phone } = req.user; // From auth middleware
      const { startDate, endDate } = req.query;

      if (!phone) {
        return res.status(200).json({
          summary: {
            totalCalls: 0,
            inboundCalls: 0,
            outboundCalls: 0,
            missedCalls: 0,
            answerRate: 0,
            averageDuration: 0,
            totalTalkTime: 0,
            totalHoldTime: 0,
          },
          dailyTrend: [],
        });
      }

      // Set default date range if not provided (last 30 days)
      const endDateTime = endDate ? new Date(endDate) : new Date();
      const startDateTime = startDate
        ? new Date(startDate)
        : new Date(endDateTime.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Filter for date range and agent ID
      const filter = {
        fromNumber: phone,
        startTime: {
          $gte: startDateTime,
          $lte: endDateTime,
        },
      };

      // Total calls statistics
      const totalCalls = await CallData.countDocuments(filter);
      const inboundCalls = await CallData.countDocuments({
        ...filter,
        direction: "in",
      });
      const outboundCalls = await CallData.countDocuments({
        ...filter,
        direction: "out",
      });
      const missedCalls = await CallData.countDocuments({
        ...filter,
        lastState: "MISSED",
      });

      // Duration statistics
      const durationStats = await CallData.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalDuration: { $sum: "$totalDuration" },
            avgDuration: { $avg: "$inCallDuration" },
            maxDuration: { $max: "$inCallDuration" },
            totalInCallDuration: { $sum: "$inCallDuration" },
            avgHoldDuration: { $avg: "$holdDuration" },
            totalHoldDuration: { $sum: "$holdDuration" },
          },
        },
      ]);

      // Daily call trend
      const dailyTrend = await CallData.aggregate([
        { $match: filter },
        {
          $project: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$startTime" } },
            duration: "$inCallDuration",
            direction: 1,
          },
        },
        {
          $group: {
            _id: { date: "$date", direction: "$direction" },
            count: { $sum: 1 },
            totalDuration: { $sum: "$duration" },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]);

      // Format daily trend data
      const formattedDailyTrend = dailyTrend.reduce((acc, curr) => {
        const { date, direction } = curr._id;
        if (!acc[date]) {
          acc[date] = { date, inbound: 0, outbound: 0, totalDuration: 0 };
        }

        if (direction === "in") {
          acc[date].inbound = curr.count;
        } else if (direction === "out") {
          acc[date].outbound = curr.count;
        }

        acc[date].totalDuration += curr.totalDuration || 0;
        return acc;
      }, {});

      // Convert to array and fill missing dates
      const trendArray = Object.values(formattedDailyTrend);

      return res.status(200).json({
        summary: {
          totalCalls,
          inboundCalls,
          outboundCalls,
          missedCalls,
          answerRate:
            totalCalls > 0
              ? (((totalCalls - missedCalls) / totalCalls) * 100).toFixed(1)
              : 0,
          averageDuration:
            durationStats.length > 0 ? durationStats[0].avgDuration || 0 : 0,
          totalTalkTime:
            durationStats.length > 0
              ? durationStats[0].totalInCallDuration || 0
              : 0,
          totalHoldTime:
            durationStats.length > 0
              ? durationStats[0].totalHoldDuration || 0
              : 0,
        },
        dailyTrend: trendArray,
      });
    } catch (error) {
      console.error("Error fetching call statistics:", error);
      return res.status(500).json({
        error: "Error fetching call statistics",
        details: error.message,
      });
    }
  },

  // Get call data for all agents (manager view) with pagination and filtering
  getTeamCallData: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Build filter object based on query params
      const filter = {};

      if (req.query.agentId) {
        //find the agent by ID
        const agent = await User.findById(req.query.agentId);

        const agentName = agent ? agent.firstName + " " + agent.lastName : null;

        if (agentName) {
          //match the agent name with the call data UserName field
          filter.userName = agentName;
        }
      }

      // Add agent name filter for call log view
      if (req.query.agentName) {
        filter.userName = req.query.agentName;
      }

      if (req.query.startDate && req.query.endDate) {
        filter.startTime = {
          $gte: new Date(req.query.startDate),
          $lte: new Date(req.query.endDate),
        };
      }

      if (req.query.type) {
        filter.type = req.query.type;
      }

      if (req.query.status) {
        console.log(req.query.status);
        if (req.query.status === "missed") {
          filter.lastState = "MISSED";
        } else if (req.query.status === "answered") {
          filter.lastState = { $ne: "MISSED" };
        }
      }

      // Add direction filter to the main filter object
      if (req.query.direction && req.query.direction !== "all") {
        filter.direction = req.query.direction;
      }

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, "i");
        filter.$or = [
          { fromNumber: searchRegex },
          { toNumber: searchRegex },
          { contact: searchRegex },
          { userName: searchRegex },
        ];
      }

      console.log("Final filter:", filter);

      // Execute query with pagination - use single query with complete filter
      const callData = await CallData.find(filter)
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await CallData.countDocuments(filter);

      return res.status(200).json({
        data: callData,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error fetching team call data:", error);
      return res.status(500).json({
        error: "Error fetching team call data",
        details: error.message,
      });
    }
  },

  // Get team call statistics grouped by different dimensions (for manager view)
  getTeamCallStatistics: async (req, res) => {
    try {
      const { startDate, endDate, groupBy = "agent" } = req.query;

      // Set default date range if not provided (last 30 days)
      const endDateTime = endDate ? new Date(endDate) : new Date();
      const startDateTime = startDate
        ? new Date(startDate)
        : new Date(endDateTime.getTime() - 30 * 24 * 60 * 60 * 1000);

      console.log(
        "Fetching team call statistics direction:",
        req.query.direction
      );

      // Filter for date range
      const filter =
        req.query.direction !== "all"
          ? {
              direction: req.query.direction,
              startTime: {
                $gte: startDateTime,
                $lte: endDateTime,
              },
            }
          : {
              startTime: {
                $gte: startDateTime,
                $lte: endDateTime,
              },
            };

      if (req.query.agentId) {
        //find the agent by ID
        const agent = await User.findById(req.query.agentId);

        const agentName = agent ? agent.firstName + " " + agent.lastName : null;

        if (agentName) {
          //match the agent name with the call data UserName field
          filter.userName = agentName;
        }
      }

      // Overall statistics
      const totalCalls = await CallData.countDocuments(filter);
      const inboundCalls = await CallData.countDocuments({
        ...filter,
        direction: "in",
      });
      const outboundCalls = await CallData.countDocuments({
        ...filter,
        direction: "out",
      });
      const missedCalls = await CallData.countDocuments({
        ...filter,
        lastState: "MISSED",
      });

      // Duration statistics
      const durationStats = await CallData.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalDuration: { $sum: "$totalDuration" },
            avgDuration: { $avg: "$inCallDuration" },
            maxDuration: { $max: "$inCallDuration" },
            totalInCallDuration: { $sum: "$inCallDuration" },
            avgHoldDuration: { $avg: "$holdDuration" },
            totalHoldDuration: { $sum: "$holdDuration" },
          },
        },
      ]);

      // Group data based on requested dimension
      let groupField;
      if (groupBy === "agent") {
        groupField = { agent: "$userName" };
      } else if (groupBy === "day") {
        groupField = {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$startTime" } },
        };
      } else if (groupBy === "week") {
        groupField = {
          week: { $dateToString: { format: "%G-W%V", date: "$startTime" } },
        };
      } else if (groupBy === "month") {
        groupField = {
          month: { $dateToString: { format: "%Y-%m", date: "$startTime" } },
        };
      } else {
        groupField = { agent: "$userName" }; // Default to agent
      }

      // Aggregated statistics by group
      const groupedStats = await CallData.aggregate([
        { $match: filter },
        {
          $group: {
            _id: groupField,
            totalCalls: { $sum: 1 },
            inboundCalls: {
              $sum: { $cond: [{ $eq: ["$direction", "in"] }, 1, 0] },
            },
            outboundCalls: {
              $sum: { $cond: [{ $eq: ["$direction", "out"] }, 1, 0] },
            },
            missedCalls: {
              $sum: { $cond: [{ $eq: ["$lastState", "MISSED"] }, 1, 0] },
            },
            totalDuration: { $sum: "$totalDuration" },
            inCallDuration: { $sum: "$inCallDuration" },
            avgCallDuration: { $avg: "$inCallDuration" },
          },
        },
        { $sort: { totalCalls: -1 } },
      ]);

      // Format the response
      const formattedGroupedStats = groupedStats.map((group) => {
        const groupKey = Object.keys(group._id)[0];
        const groupValue = group._id[groupKey];

        return {
          [groupKey]: groupValue,
          totalCalls: group.totalCalls,
          inboundCalls: group.inboundCalls,
          outboundCalls: group.outboundCalls,
          missedCalls: group.missedCalls,
          answerRate:
            group.totalCalls > 0
              ? (
                  ((group.totalCalls - group.missedCalls) / group.totalCalls) *
                  100
                ).toFixed(1)
              : 0,
          avgCallDuration: group.avgCallDuration || 0,
          totalTalkTime: group.inCallDuration || 0,
        };
      });

      return res.status(200).json({
        summary: {
          totalCalls,
          inboundCalls,
          outboundCalls,
          missedCalls,
          answerRate:
            totalCalls > 0
              ? (((totalCalls - missedCalls) / totalCalls) * 100).toFixed(1)
              : 0,
          averageDuration:
            durationStats.length > 0 ? durationStats[0].avgDuration || 0 : 0,
          totalTalkTime:
            durationStats.length > 0
              ? durationStats[0].totalInCallDuration || 0
              : 0,
          totalHoldTime:
            durationStats.length > 0
              ? durationStats[0].totalHoldDuration || 0
              : 0,
        },
        groupedStats: formattedGroupedStats,
      });
    } catch (error) {
      console.error("Error fetching team call statistics:", error);
      return res.status(500).json({
        error: "Error fetching team call statistics",
        details: error.message,
      });
    }
  },

  // Get agent performance comparison for managers
  // Get agent performance comparison for managers
  getAgentPerformanceComparison: async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      // Set default date range if not provided (last 30 days)
      const endDateTime = endDate ? new Date(endDate) : new Date();
      const startDateTime = startDate
        ? new Date(startDate)
        : new Date(endDateTime.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Filter for date range
      const filter = {
        startTime: {
          $gte: startDateTime,
          $lte: endDateTime,
        },
      };

      // Get all agents with their call stats
      const agentStats = await CallData.aggregate([
        { $match: filter },
        {
          $group: {
            _id: { userID: "$userID", userName: "$userName" },

            totalCalls: { $sum: 1 },
            answeredCalls: {
              $sum: { $cond: [{ $eq: ["$lastState", "MISSED"] }, 0, 1] },
            },

            totalDuration: { $sum: "$totalDuration" },
            inCallDuration: { $sum: "$inCallDuration" },
            avgCallDuration: { $avg: "$inCallDuration" },
            maxCallDuration: { $max: "$inCallDuration" },
            inboundCalls: {
              $sum: { $cond: [{ $eq: ["$direction", "in"] }, 1, 0] },
            },
            outboundCalls: {
              $sum: { $cond: [{ $eq: ["$direction", "out"] }, 1, 0] },
            },
            // Add average quality score calculation
            totalQualityScore: { $sum: "$qualityScore" },
            analyzedCalls: {
              $sum: { $cond: [{ $gt: ["$qualityScore", 0] }, 1, 0] },
            },
          },
        },
        {
          $project: {
            _id: "$_id.userID",
            userID: "$_id.userID",
            userName: "$_id.userName",
            totalCalls: 1,
            answeredCalls: 1,
            missedCalls: { $subtract: ["$totalCalls", "$answeredCalls"] },
            answerRate: {
              $multiply: [
                { $divide: ["$answeredCalls", { $max: ["$totalCalls", 1] }] },
                100,
              ],
            },
            totalDuration: 1,
            inCallDuration: 1,
            avgCallDuration: 1,
            maxCallDuration: 1,
            inboundCalls: 1,
            outboundCalls: 1,
            // Add quality score calculation with default value if no analyzed calls
            qualityScore: {
              $cond: [
                { $gt: ["$analyzedCalls", 0] },
                { $divide: ["$totalQualityScore", "$analyzedCalls"] },
                null,
              ],
            },
            analyzedCalls: 1,
          },
        },
        { $sort: { totalCalls: -1 } },
      ]);

      // For each agent, calculate daily trend
      const agentDailyTrends = await Promise.all(
        agentStats.map(async (agent) => {
          const dailyTrend = await CallData.aggregate([
            {
              $match: {
                ...filter,
                userID: agent.userID,
              },
            },
            {
              $project: {
                date: {
                  $dateToString: { format: "%Y-%m-%d", date: "$startTime" },
                },
                direction: 1,
                lastState: 1, // Change from missed: 1 to lastState: 1
                inCallDuration: 1,
                qualityScore: 1,
              },
            },
            {
              $group: {
                _id: { date: "$date" },
                calls: { $sum: 1 },
                answeredCalls: {
                  $sum: { $cond: [{ $eq: ["$lastState", "MISSED"] }, 0, 1] },
                },
                inCallDuration: { $sum: "$inCallDuration" },
                // Add quality score average for daily trend
                dailyQualityScore: { $avg: "$qualityScore" },
              },
            },
            { $sort: { "_id.date": 1 } },
          ]);

          return {
            ...agent,
            dailyTrend: dailyTrend.map((day) => ({
              date: day._id.date,
              calls: day.calls,
              answeredCalls: day.answeredCalls,
              missedCalls: day.calls - day.answeredCalls,
              inCallDuration: day.inCallDuration,
              qualityScore: day.dailyQualityScore || null,
            })),
          };
        })
      );

      console.log("Agent daily trends:", agentDailyTrends);

      return res.status(200).json({
        agents: agentDailyTrends,
        dateRange: {
          startDate: startDateTime,
          endDate: endDateTime,
        },
      });
    } catch (error) {
      console.error("Error fetching agent performance comparison:", error);
      return res.status(500).json({
        error: "Error fetching agent performance comparison",
        details: error.message,
      });
    }
  },
  // Add this new function to callDataController
  getAgentHourlyData: async (req, res) => {
    try {
      const { agentId } = req.params;
      const { startDate, endDate } = req.query;

      // Find the agent by ID to get their name
      const agent = await User.findById(agentId);
      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const agentName = `${agent.firstName} ${agent.lastName}`;

      // Set default date range if not provided
      const endDateTime = endDate ? new Date(endDate) : new Date();
      const startDateTime = startDate
        ? new Date(startDate)
        : new Date(endDateTime.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Filter for the specific agent and date range
      const filter = {
        userName: agentName,
        startTime: {
          $gte: startDateTime,
          $lte: endDateTime,
        },
      };

      // Aggregate calls by hour
      const hourlyData = await CallData.aggregate([
        { $match: filter },
        {
          $project: {
            hour: { $hour: "$startTime" },
            inCallDuration: 1,
            qualityScore: 1,
            lastState: 1,
          },
        },
        {
          $group: {
            _id: { hour: "$hour" },
            calls: { $sum: 1 },
            duration: { $sum: "$inCallDuration" },
            totalQualityScore: { $sum: "$qualityScore" },
            qualityCount: {
              $sum: { $cond: [{ $gt: ["$qualityScore", 0] }, 1, 0] },
            },
            missedCalls: {
              $sum: { $cond: [{ $eq: ["$lastState", "MISSED"] }, 1, 0] },
            },
          },
        },
        { $sort: { "_id.hour": 1 } },
      ]);

      // Create array for all 24 hours
      const hourlyStats = new Array(24).fill(0).map((_, hour) => {
        const hourData = hourlyData.find((h) => h._id.hour === hour);

        return {
          hour,
          calls: hourData ? hourData.calls : 0,
          duration: hourData ? hourData.duration : 0,
          qualityScore:
            hourData && hourData.qualityCount > 0
              ? hourData.totalQualityScore / hourData.qualityCount
              : 0,
          missedCalls: hourData ? hourData.missedCalls : 0,
          answeredCalls: hourData ? hourData.calls - hourData.missedCalls : 0,
        };
      });

      return res.status(200).json({
        agentName,
        hourlyData: hourlyStats,
        dateRange: {
          startDate: startDateTime,
          endDate: endDateTime,
        },
      });
    } catch (error) {
      console.error("Error fetching agent hourly data:", error);
      return res.status(500).json({
        error: "Error fetching agent hourly data",
        details: error.message,
      });
    }
  },
  analyzeCall: async (req, res) => {
    try {
      const { callID, audioUrl } = req.body;

      // Validate required parameters
      if (!callID) {
        return res.status(400).json({ error: "Missing callID parameter" });
      }

      // Find the call in the database
      const callData = await CallData.findOne({ callID });
      if (!callData) {
        return res.status(404).json({ error: "Call not found" });
      }

      // Check if analysis already exists and is less than 30 days old
      if (
        callData.analysis &&
        callData.transcript &&
        callData.qualityScore > 0
      ) {
        const analysisAge = callData.analysisTimestamp
          ? (new Date() - new Date(callData.analysisTimestamp)) /
            (1000 * 60 * 60 * 24)
          : 999;

        if (analysisAge < 30) {
          // Return existing analysis
          return res.status(200).json({
            transcript: callData.transcript,
            analysis: callData.analysis,
            qualityScore: callData.qualityScore,
            structuredAnalysis: callData.structuredAnalysis || null,
            fromCache: true,
          });
        }
      }

      // Continue with API call if analysis doesn't exist or is outdated
      if (!audioUrl) {
        return res.status(400).json({ error: "Missing audioUrl parameter" });
      }

      // Create axios request to the Flask API
      const axios = require("axios");
      try {
        // Send request to the Flask API
        const response = await axios.post(
          "http://127.0.0.1:5001/analyze-call",
          {
            audio_url: audioUrl,
            call_id: callID,
          }
        );

        // Get the analysis result
        const analysisResult = response.data;

        // FIX: Properly update and save the call data
        await CallData.findOneAndUpdate(
          { callID: callID },
          {
            $set: {
              transcript: analysisResult.transcript,
              analysis: analysisResult.analysis,
              qualityScore: analysisResult.qualityScore || 0,
              analysisTimestamp: new Date(),
              structuredAnalysis: analysisResult.structuredAnalysis || null,
            },
          },
          { new: true }
        );

        console.log(`Analysis saved for call ${callID}`);

        // Return the analysis results to the client
        return res.status(200).json({
          ...analysisResult,
          fromCache: false,
        });
      } catch (apiError) {
        console.error("Error calling analysis API:", apiError.message);

        // Get detailed error if available in the response
        const errorDetails = apiError.response?.data || {
          error: apiError.message,
        };

        return res.status(500).json({
          error: "Error during call analysis",
          details: errorDetails,
          callID,
        });
      }
    } catch (error) {
      console.error("Error analyzing call:", error);
      return res.status(500).json({
        error: "Error analyzing call",
        details: error.message,
      });
    }
  },
};

module.exports = callDataController;
