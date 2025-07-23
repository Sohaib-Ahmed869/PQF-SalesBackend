// controllers/salesPerformance.controller.js
const DeskTime = require("../models/desktime.model");
const User = require("../models/User"); // Assuming you have this model
const SalesOrder = require("../models/SalesOrder"); // Assuming you have this model
const mongoose = require("mongoose");
const timeParser = require("../utils/time-parser");

// Get all records for a specific sales agent
exports.getSalesAgentRecords = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      limit = 30,
      skip = 0,
      sortBy = "date",
      sortDirection = -1,
    } = req.query;

    // Find the user to verify they're a sales agent
    const user = await User.findById(id);
    if (!user || user.role !== "sales_agent") {
      return res.status(404).json({
        success: false,
        message: "Sales agent not found",
      });
    }

    // Query DeskTime records for this user
    const records = await DeskTime.find({
      email: user.email, // Use hubspotId if available, otherwise use MongoDB ID
    })
      .sort({ [sortBy]: parseInt(sortDirection) })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    // Get total count
    const total = await DeskTime.countDocuments({
      email: user.email,
    });

    res.status(200).json({
      success: true,
      count: records.length,
      total,
      data: records,
    });
  } catch (error) {
    console.error("Error getting sales agent records:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Get records for a specific sales agent in a date range
exports.getSalesAgentTimeRecords = async (req, res) => {
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

    // Find the user to verify they're a sales agent
    const user = await User.findById(id);
    if (!user || user.role !== "sales_agent") {
      return res.status(404).json({
        success: false,
        message: "Sales agent not found",
      });
    }

    // Query DeskTime records for this user within the date range
    const records = await DeskTime.find({
      date: { $gte: start, $lte: end },

      email: user.email,
    });

    console.log(`Found ${records.length} records for ${user.email}`);

    // Calculate aggregated stats
    let totalProductiveTime = 0;
    let totalDeskTime = 0;

    records.forEach((record) => {
      totalProductiveTime += record.productiveTimeHours || 0;
      totalDeskTime += record.totalDeskTimeHours || 0;
    });

    const avgProductivity =
      totalDeskTime > 0 ? (totalProductiveTime / totalDeskTime) * 100 : 0;

    res.status(200).json({
      success: true,
      count: records.length,
      summary: {
        totalProductiveHours: parseFloat(totalProductiveTime.toFixed(2)),
        totalDeskHours: parseFloat(totalDeskTime.toFixed(2)),
        averageProductivity: parseFloat(avgProductivity.toFixed(2)),
      },
      data: records,
    });
  } catch (error) {
    console.error("Error getting sales agent time records:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Get overall team performance metrics
exports.getOverallPerformance = async (req, res) => {
  try {
    const { startDate, endDate, group } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Both startDate and endDate are required",
      });
    }

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Query builder
    const query = {
      date: { $gte: start, $lte: end },
    };

    // Add group filter if provided
    if (group) {
      query.group = group;
    }

    // Get sales agents
    const salesAgents = await User.find({ role: "sales_agent" });
    const salesAgentIds = salesAgents.map(
      (agent) => agent.hubspotId || agent._id.toString()
    );

    // Add filter for sales agents only
    query.email = { $in: salesAgents.map((agent) => agent.email) };
    // Fetch records
    const records = await DeskTime.find(query);

    // Group by user
    const userStats = {};
    records.forEach((record) => {
      if (!userStats[record.userId]) {
        userStats[record.userId] = {
          userId: record.userId,
          name: record.name,
          email: record.email,
          group: record.group,
          totalDays: 0,
          totalProductiveHours: 0,
          totalDeskHours: 0,
          averageProductivity: 0,
        };
      }

      userStats[record.userId].totalDays += 1;
      userStats[record.userId].totalProductiveHours +=
        record.productiveTimeHours || 0;
      userStats[record.userId].totalDeskHours += record.totalDeskTimeHours || 0;
    });

    // Calculate averages and format
    Object.values(userStats).forEach((stats) => {
      stats.averageProductivity =
        stats.totalDeskHours > 0
          ? (stats.totalProductiveHours / stats.totalDeskHours) * 100
          : 0;

      stats.totalProductiveHours = parseFloat(
        stats.totalProductiveHours.toFixed(2)
      );
      stats.totalDeskHours = parseFloat(stats.totalDeskHours.toFixed(2));
      stats.averageProductivity = parseFloat(
        stats.averageProductivity.toFixed(2)
      );
    });

    // Sort by productivity (descending)
    const sortedStats = Object.values(userStats).sort(
      (a, b) => b.averageProductivity - a.averageProductivity
    );

    // Calculate team averages
    const teamStats = {
      totalAgents: sortedStats.length,
      averageProductivity:
        sortedStats.length > 0
          ? sortedStats.reduce(
              (sum, agent) => sum + agent.averageProductivity,
              0
            ) / sortedStats.length
          : 0,
      totalDays: records.length,
      topPerformer: sortedStats.length > 0 ? sortedStats[0] : null,
      needsImprovement:
        sortedStats.length > 0 ? sortedStats[sortedStats.length - 1] : null,
    };

    res.status(200).json({
      success: true,
      teamStats,
      agentStats: sortedStats,
    });
  } catch (error) {
    console.error("Error getting overall performance:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Get detailed performance for a specific sales agent
exports.getSalesAgentPerformance = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, groupBy = "day" } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Both startDate and endDate are required",
      });
    }

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Find the user to verify they're a sales agent
    const user = await User.findById(id);
    if (!user || user.role !== "sales_agent") {
      return res.status(404).json({
        success: false,
        message: "Sales agent not found",
      });
    }

    // Query DeskTime records
    const records = await DeskTime.find({
      date: { $gte: start, $lte: end },
      email: user.email,
    });

    // Get sales data for the same period
    const salesData = await SalesOrder.find({
      DocDate: { $gte: start, $lte: end },
      salesAgent: user._id,
    });

    console.log(
      `Found ${records.length} records and ${salesData.length} sales for ${user.email}`
    );

    // Aggregate data by day, week, or month
    let groupedData = {};
    let totalProductiveHours = 0;
    let totalDeskHours = 0;

    // If no DeskTime records found but sales exist, create timeline entries for sales dates
    if (records.length === 0 && salesData.length > 0) {
      console.log(
        "No DeskTime records found, but sales exist. Creating timeline entries for sales dates."
      );

      // Create entries in groupedData for each sales date
      salesData.forEach((sale) => {
        const saleDate = new Date(sale.DocDate);
        let key;

        switch (groupBy) {
          case "week":
            const weekStartDate = new Date(saleDate);
            weekStartDate.setDate(saleDate.getDate() - saleDate.getDay());
            key = weekStartDate.toISOString().split("T")[0];
            break;

          case "month":
            key = `${saleDate.getFullYear()}-${String(
              saleDate.getMonth() + 1
            ).padStart(2, "0")}`;
            break;

          case "day":
          default:
            key = saleDate.toISOString().split("T")[0];
            break;
        }

        if (!groupedData[key]) {
          groupedData[key] = {
            period: key,
            days: 0,
            productiveHours: 0,
            deskHours: 0,
            productivity: 0,
            salesAmount: 0.0,
            orderCount: 0,
          };
        }

        groupedData[key].salesAmount += sale.DocTotal || 0;
        groupedData[key].orderCount += 1;
      });
    }

    records.forEach((record) => {
      // Debug sample record
      if (records.indexOf(record) === 0) {
        console.log("Sample record:", {
          date: record.date,
          productiveTime: record.productiveTime,
          totalDeskTime: record.totalDeskTime,
        });
      }

      // Parse time strings directly instead of using virtual properties
      const productiveHours =
        timeParser.parseTimeToHours(record.productiveTime) || 0;
      const deskHours = timeParser.parseTimeToHours(record.totalDeskTime) || 0;

      // *** FIX: Only count as work day if at least 4 hours desk time ***
      if (deskHours < 4) {
        return; // Skip this record - not a valid work day
      }

      const date = record.date;
      let key;

      switch (
        groupBy
        // ... switch cases remain the same ...
      ) {
      }

      if (!groupedData[key]) {
        groupedData[key] = {
          period: key,
          days: 0,
          productiveHours: 0,
          deskHours: 0,
          productivity: 0,
          salesAmount: 0.0,
          orderCount: 0,
        };
      }

      // Update group stats
      groupedData[key].days += 1;
      groupedData[key].productiveHours += productiveHours;
      groupedData[key].deskHours += deskHours;

      // Update totals
      totalProductiveHours += productiveHours;
      totalDeskHours += deskHours;
    });

    // Add sales data to grouped periods
    salesData.forEach((sale) => {
      const saleDate = new Date(sale.DocDate);
      let key;

      switch (groupBy) {
        case "week":
          const weekStartDate = new Date(saleDate);
          weekStartDate.setDate(saleDate.getDate() - saleDate.getDay());
          key = weekStartDate.toISOString().split("T")[0];
          break;

        case "month":
          key = `${saleDate.getFullYear()}-${saleDate.getMonth() + 1}`;
          break;

        case "day":
        default:
          key = saleDate.toISOString().split("T")[0];
          break;
      }

      if (groupedData[key]) {
        groupedData[key].salesAmount += sale.DocTotal || 0;
        groupedData[key].orderCount += 1;
      }
    });

    // Calculate productivity percentages and format numbers
    Object.values(groupedData).forEach((data) => {
      data.productivity =
        data.deskHours > 0 ? (data.productiveHours / data.deskHours) * 100 : 0;

      data.productiveHours = parseFloat(data.productiveHours.toFixed(2));
      data.deskHours = parseFloat(data.deskHours.toFixed(2));
      data.productivity = parseFloat(data.productivity.toFixed(2));
      data.salesAmount = parseFloat(data.salesAmount.toFixed(2));
    });

    // Sort by period
    const timelineData = Object.values(groupedData).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    // Calculate overall stats
    const overallProductivity =
      totalDeskHours > 0 ? (totalProductiveHours / totalDeskHours) * 100 : 0;

    const totalSales = salesData.reduce(
      (sum, sale) => sum + (sale.DocTotal || 0),
      0
    );

    // Calculate productivity to sales ratio
    const productivityToSalesRatio =
      totalProductiveHours > 0 ? totalSales / totalProductiveHours : 0;

    const summary = {
      totalDays: records.length,
      totalProductiveHours: parseFloat(totalProductiveHours.toFixed(2)),
      totalDeskHours: parseFloat(totalDeskHours.toFixed(2)),
      averageProductivity: parseFloat(overallProductivity.toFixed(2)),
      totalSales: parseFloat(totalSales.toFixed(2)),
      totalOrders: salesData.length,
      salesPerProductiveHour: parseFloat(productivityToSalesRatio.toFixed(2)),
    };

    res.status(200).json({
      success: true,
      agentInfo: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        target: user.target || 0,
        achieved: user.targetAchieved || 0,
      },
      summary,
      timelineData,
    });
  } catch (error) {
    console.error("Error getting sales agent performance:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
