// controllers/dashboardController.js
const User = require("../models/User");
const CallData = require("../models/CallData");
const SalesOrder = require("../models/SalesOrder");
const Invoice = require("../models/Invoice");
const mongoose = require("mongoose");

// Get all dashboard data for a sales manager in a single request
// controllers/dashboardController.js
exports.getSalesManagerDashboard = async (req, res) => {
  try {
    const managerId = req.user._id;
    const { startDate, endDate } = req.query;

    // Default date range (last 30 days if not provided)
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get only sales agents managed by this manager
    const salesAgents = await User.find({
      role: "sales_agent",
      deactivated: false,
      manager: managerId,
    }).select("-password");

    if (!salesAgents.length) {
      return res.status(200).json({
        success: true,
        data: {
          agents: [],
          teamPerformance: {
            totalTargets: 0,
            totalAchieved: 0,
            targetAchievementRate: 0,
            callsToday: 0,
            avgCallDuration: 0,
            monthlySales: [],
            topPerformers: [],
            needImprovement: [],
            salesByChannel: [],
          },
          recentCalls: [],
          salesData: [],
        },
      });
    }

    const agentIds = salesAgents.map((agent) => agent._id);

    // **FIX 1: Get actual sales from Invoice collection**
    const salesQuery = {
      DocDate: { $gte: start, $lte: end },
      salesAgent: { $in: agentIds }, // Filter by team agents
    };

    // Get all invoices for the team
    const invoices = await Invoice.find(salesQuery)
      .sort({ DocDate: -1 })
      .lean();

    // **FIX 2: Calculate actual achievement from invoices**
    const agentSalesMap = {};
    let totalTeamSales = 0;

    // Initialize agent sales tracking
    agentIds.forEach((agentId) => {
      agentSalesMap[agentId.toString()] = {
        totalSales: 0,
        invoiceCount: 0,
        recentInvoices: [],
      };
    });

    // Process invoices and calculate sales per agent
    invoices.forEach((invoice) => {
      const agentIdStr = invoice.salesAgent.toString();
      if (agentSalesMap[agentIdStr]) {
        agentSalesMap[agentIdStr].totalSales += invoice.DocTotal || 0;
        agentSalesMap[agentIdStr].invoiceCount += 1;
        agentSalesMap[agentIdStr].recentInvoices.push(invoice);
        totalTeamSales += invoice.DocTotal || 0;
      }
    });

    // **FIX 3: Update agents with actual achievement data**
    const updatedAgents = salesAgents.map((agent) => {
      const agentSales = agentSalesMap[agent._id.toString()] || {
        totalSales: 0,
        invoiceCount: 0,
      };
      return {
        ...agent.toObject(),
        targetAchieved: agentSales.totalSales, // Use actual sales from invoices
        achievementRate:
          agent.target > 0 ? (agentSales.totalSales / agent.target) * 100 : 0,
        invoiceCount: agentSales.invoiceCount,
      };
    });

    // **FIX 4: Calculate proper monthly sales data**
    const monthlySalesMap = {};

    invoices.forEach((invoice) => {
      const date = new Date(invoice.DocDate);
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;
      const monthLabel = date.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });

      if (!monthlySalesMap[monthKey]) {
        monthlySalesMap[monthKey] = {
          month: monthLabel,
          sales: 0,
          invoiceCount: 0,
          date: new Date(date.getFullYear(), date.getMonth(), 1),
        };
      }

      monthlySalesMap[monthKey].sales += invoice.DocTotal || 0;
      monthlySalesMap[monthKey].invoiceCount += 1;
    });

    // Sort and format monthly sales data
    const monthlySales = Object.values(monthlySalesMap)
      .sort((a, b) => a.date - b.date)
      .slice(-6) // Last 6 months
      .map((item) => ({
        month: item.month,
        sales: Math.round(item.sales),
        invoiceCount: item.invoiceCount,
      }));

    // **FIX 5: Get call data for team**
    const teamPhones = salesAgents.map((agent) => agent.phone).filter(Boolean);

    const callDataQuery = {
      startTime: { $gte: start, $lte: end },
      ...(teamPhones.length > 0 ? { phone: { $in: teamPhones } } : {}),
    };

    // Get today's calls
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const callsToday = await CallData.countDocuments({
      ...callDataQuery,
      startTime: { $gte: today },
    });

    // Get average call duration
    const callDurationStats = await CallData.aggregate([
      { $match: callDataQuery },
      {
        $group: {
          _id: null,
          avgDuration: { $avg: "$inCallDuration" },
        },
      },
    ]);

    const avgCallDuration =
      callDurationStats.length > 0
        ? Math.round(callDurationStats[0].avgDuration || 0)
        : 0;

    // **FIX 6: Calculate channel distribution from actual invoices**
    const channelData = await Invoice.aggregate([
      { $match: salesQuery },
      {
        $group: {
          _id: { $ifNull: ["$U_Channel", "Direct"] },
          value: { $sum: 1 },
          totalAmount: { $sum: "$DocTotal" },
        },
      },
    ]);

    const salesByChannel = channelData.map((channel) => ({
      channel: channel._id,
      value: channel.value,
      amount: channel.totalAmount,
    }));

    // **FIX 7: Calculate team performance metrics properly**
    const totalTargets = updatedAgents.reduce(
      (sum, agent) => sum + (agent.target || 0),
      0
    );
    const totalAchieved = totalTeamSales; // Use actual sales total
    const targetAchievementRate =
      totalTargets > 0 ? (totalAchieved / totalTargets) * 100 : 0;

    // **FIX 8: Get top performers based on actual achievement**
    const topPerformers = [...updatedAgents]
      .filter((agent) => agent.target && agent.target > 0)
      .sort((a, b) => b.achievementRate - a.achievementRate)
      .slice(0, 3)
      .map((agent) => ({
        _id: agent._id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        target: agent.target,
        achieved: agent.targetAchieved,
        achievementRate: agent.achievementRate,
        invoiceCount: agent.invoiceCount,
      }));

    // Get agents needing improvement
    const needImprovement = [...updatedAgents]
      .filter((agent) => agent.target && agent.target > 0)
      .sort((a, b) => a.achievementRate - b.achievementRate)
      .slice(0, 3)
      .map((agent) => ({
        _id: agent._id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        target: agent.target,
        achieved: agent.targetAchieved,
        achievementRate: agent.achievementRate,
        invoiceCount: agent.invoiceCount,
      }));

    // **FIX 9: Get recent calls for the team**
    const recentCalls = await CallData.find(callDataQuery)
      .sort({ startTime: -1 })
      .limit(10)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        agents: updatedAgents,
        teamPerformance: {
          totalTargets: Math.round(totalTargets),
          totalAchieved: Math.round(totalAchieved),
          targetAchievementRate: Math.round(targetAchievementRate * 100) / 100,
          callsToday,
          avgCallDuration,
          monthlySales,
          topPerformers,
          needImprovement,
          salesByChannel,
          totalInvoices: invoices.length,
          avgDealSize:
            invoices.length > 0
              ? Math.round(totalTeamSales / invoices.length)
              : 0,
        },
        recentCalls: recentCalls.slice(0, 5), // Limit to 5 for UI
        salesData: monthlySales, // This is the corrected monthly data
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching dashboard data",
      error: error.message,
    });
  }
};

// Get recent calls for sales manager's team
exports.getTeamRecentCalls = async (req, res) => {
  try {
    const managerId = req.user._id;
    const limit = parseInt(req.query.limit) || 10;

    // Get team members
    const salesAgents = await User.find({
      role: "sales_agent",
      deactivated: false,
      manager: managerId,
    }).select("phone firstName lastName");

    if (!salesAgents.length) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const teamPhones = salesAgents.map((agent) => agent.phone).filter(Boolean);
    const phoneToAgentMap = {};

    salesAgents.forEach((agent) => {
      if (agent.phone) {
        phoneToAgentMap[agent.phone] = `${agent.firstName} ${agent.lastName}`;
      }
    });

    // Get recent calls
    const recentCalls = await CallData.find({
      phone: { $in: teamPhones },
    })
      .sort({ startTime: -1 })
      .limit(limit)
      .lean();

    // Add agent names to calls
    const callsWithAgentNames = recentCalls.map((call) => ({
      ...call,
      agentName: phoneToAgentMap[call.phone] || "Unknown Agent",
    }));

    res.status(200).json({
      success: true,
      data: callsWithAgentNames,
    });
  } catch (error) {
    console.error("Error fetching team calls:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team calls",
      error: error.message,
    });
  }
};

// Add a new endpoint to get team members for sales manager
exports.getTeamMembers = async (req, res) => {
  try {
    const managerId = req.user._id;

    // Check if user is a sales manager
    if (req.user.role !== "sales_manager" && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only sales managers can view team members.",
      });
    }

    // For admin, get all sales agents; for sales manager, get only their team
    const query = {
      role: "sales_agent",
      deactivated: false,
    };

    if (req.user.role === "sales_manager") {
      query.manager = managerId;
    }

    const teamMembers = await User.find(query).select("-password");

    res.status(200).json({
      success: true,
      data: teamMembers,
    });
  } catch (error) {
    console.error("Error fetching team members:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team members",
      error: error.message,
    });
  }
};

// Get dashboard data for a specific sales agent
exports.getSalesAgentDashboard = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { startDate, endDate } = req.query;

    // Check if the agent exists and is assigned to this manager
    const agent = await User.findOne({
      _id: agentId,
      role: "sales_agent",
      deactivated: false,
    }).select("-password");

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Sales agent not found",
      });
    }

    // Check if the current user is admin or the manager of this agent
    if (
      req.user.role !== "admin" &&
      agent.manager &&
      agent.manager.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to view this agent's dashboard",
      });
    }

    // Default date range (last 30 days if not provided)
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get call data
    const callDataQuery = {
      startTime: { $gte: start, $lte: end },
      userID: agent._id.toString(),
    };

    // Get today's calls
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const callsToday = await CallData.countDocuments({
      ...callDataQuery,
      startTime: { $gte: today },
    });

    // Get call statistics
    const callStats = await CallData.aggregate([
      { $match: callDataQuery },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          avgDuration: { $avg: "$inCallDuration" },
          totalDuration: { $sum: "$inCallDuration" },
          inboundCalls: {
            $sum: { $cond: [{ $eq: ["$direction", "in"] }, 1, 0] },
          },
          outboundCalls: {
            $sum: { $cond: [{ $eq: ["$direction", "out"] }, 1, 0] },
          },
          missedCalls: { $sum: { $cond: [{ $ne: ["$missed", ""] }, 1, 0] } },
        },
      },
    ]);

    const callStatistics =
      callStats.length > 0
        ? {
            totalCalls: callStats[0].totalCalls,
            avgDuration: Math.round(callStats[0].avgDuration || 0),
            totalDuration: callStats[0].totalDuration,
            inboundCalls: callStats[0].inboundCalls,
            outboundCalls: callStats[0].outboundCalls,
            missedCalls: callStats[0].missedCalls,
            callsToday,
          }
        : {
            totalCalls: 0,
            avgDuration: 0,
            totalDuration: 0,
            inboundCalls: 0,
            outboundCalls: 0,
            missedCalls: 0,
            callsToday: 0,
          };

    // Get recent calls
    const recentCalls = await CallData.find(callDataQuery)
      .sort({ startTime: -1 })
      .limit(5)
      .lean();

    // Get sales data
    const salesQuery = {
      DocDate: { $gte: start, $lte: end },
      salesAgent: agent._id,
    };

    const salesOrders = await SalesOrder.find(salesQuery)
      .sort({ DocDate: -1 })
      .lean();

    // Calculate sales statistics
    const totalSales = salesOrders.reduce(
      (sum, order) => sum + (order.DocTotal || 0),
      0
    );
    const orderCount = salesOrders.length;

    // Calculate monthly sales data
    const monthlySalesMap = {};

    salesOrders.forEach((order) => {
      const date = new Date(order.DocDate);
      const month = date.toLocaleString("default", { month: "short" });
      const year = date.getFullYear();
      const key = `${month}-${year}`;

      if (!monthlySalesMap[key]) {
        monthlySalesMap[key] = {
          month,
          year,
          sales: 0,
          orders: 0,
        };
      }

      monthlySalesMap[key].sales += order.DocTotal || 0;
      monthlySalesMap[key].orders += 1;
    });

    const monthlySales = Object.values(monthlySalesMap).sort((a, b) => {
      // Sort by year and month
      if (a.year !== b.year) return a.year - b.year;

      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return months.indexOf(a.month) - months.indexOf(b.month);
    });

    // Calculate achievement rate
    const targetAchievementRate =
      agent.target > 0 ? (agent.targetAchieved / agent.target) * 100 : 0;

    // Get target history
    const targetHistory = agent.targetHistory || [];

    res.status(200).json({
      success: true,
      data: {
        agent,
        callStatistics,
        recentCalls,
        salesStatistics: {
          totalSales,
          orderCount,
          target: agent.target || 0,
          achieved: agent.targetAchieved || 0,
          achievementRate: targetAchievementRate,
        },
        monthlySales,
        targetHistory,
        recentOrders: salesOrders.slice(0, 5), // Last 5 orders
      },
    });
  } catch (error) {
    console.error("Error fetching agent dashboard data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching agent dashboard data",
      error: error.message,
    });
  }
};
