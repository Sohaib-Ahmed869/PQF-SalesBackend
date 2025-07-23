// controllers/salesManagerDashboard.controller.js
const User = require("../models/User");
const Customer = require("../models/Customer");
const Invoice = require("../models/Invoice");
const SalesOrder = require("../models/SalesOrder");
const Quotation = require("../models/Quotation");
const CallData = require("../models/CallData");
const mongoose = require("mongoose");

/**
 * Helper function to get agent name by customer code
 */
function getAgentNameByCustomerCode(cardCode, customerToAgentMap, teamMembers) {
  const agentId = customerToAgentMap[cardCode];
  if (!agentId) return "Unassigned";

  const agent = teamMembers.find((a) => a._id.toString() === agentId);
  return agent ? `${agent.firstName} ${agent.lastName}` : "Unknown";
}

const salesManagerDashboardController = {
  /**
   * Get comprehensive sales manager dashboard data
   */
  getDashboard: async (req, res) => {
    try {
      const managerId = req.user._id;
      const { startDate, endDate } = req.query;

      // Set default date range (last 30 days if not provided)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get team members (sales agents under this manager)
      const teamMembers = await User.find({
        role: "sales_agent",
        manager: managerId,
      })
        .select("firstName lastName email phone target targetAchieved")
        .lean();

      console.log(managerId, "Team Members Count:", teamMembers);

      if (teamMembers.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            summary: getEmptyDashboardData(),
            teamMembers: [],
            performance: [],
            activities: [],
            charts: getEmptyChartData(),
          },
        });
      }

      const teamMemberIds = teamMembers.map((member) => member._id);

      // Get customers assigned to team members
      const teamCustomers = await Customer.find({
        assignedTo: { $in: teamMemberIds },
      }).lean();

      const customerCodes = teamCustomers.map((c) => c.CardCode);

      // Execute all data fetching in parallel
      // Execute all data fetching in parallel
      const [invoices, salesOrders, quotations, callData, teamPerformanceData] =
        await Promise.all([
          // Get invoices for team's customers
          customerCodes.length > 0
            ? Invoice.find({
                CardCode: { $in: customerCodes },
                DocDate: { $gte: start, $lte: end },
              }).lean()
            : [],

          // Get sales orders for team's customers
          customerCodes.length > 0
            ? SalesOrder.find({
                CardCode: { $in: customerCodes },
                DocDate: { $gte: start, $lte: end },
              }).lean()
            : [],

          // Get quotations for team's customers
          customerCodes.length > 0
            ? Quotation.find({
                CardCode: { $in: customerCodes },
                DocDate: { $gte: start, $lte: end },
              }).lean()
            : [],

          // Get call data for team
          getTeamCallData(teamMembers, start, end),

          // Calculate individual team member performance
          calculateTeamPerformance(teamMemberIds, customerCodes, start, end),
        ]);

      // Calculate summary metrics
      const summary = calculateSummaryMetrics(
        teamMembers,
        invoices,
        salesOrders,
        quotations,
        callData
      );

      // Calculate charts data
      const charts = calculateChartsData(
        invoices,
        salesOrders,
        quotations,
        callData,
        start,
        end
      );

      // Get recent activities
      // Get recent activities
      const activities = await getRecentActivities(
        teamMemberIds,
        customerCodes,
        teamCustomers,
        start,
        end
      );

      // Format team performance with member details
      const performance = teamMembers.map((member) => {
        const memberPerf =
          teamPerformanceData.find(
            (p) => p.agentId.toString() === member._id.toString()
          ) || {};

        return {
          agentId: member._id,
          name: `${member.firstName} ${member.lastName}`,
          email: member.email,
          target: member.target || 0,
          achieved: memberPerf.totalSales || 0,
          achievementRate:
            member.target > 0
              ? ((memberPerf.totalSales || 0) / member.target) * 100
              : 0,
          customersCount: memberPerf.customersCount || 0,
          invoicesCount: memberPerf.invoicesCount || 0,
          salesOrdersCount: memberPerf.salesOrdersCount || 0,
          salesOrdersAmount: memberPerf.salesOrdersAmount || 0,
          quotationsCount: memberPerf.quotationsCount || 0,
          quotationsAmount: memberPerf.quotationsAmount || 0,
          callsCount: memberPerf.callsCount || 0,
          lastActivity: memberPerf.lastActivity || null,
        };
      });

      // Create customer to agent mapping for attribution
      const customerToAgentMap = {};
      teamCustomers.forEach((customer) => {
        customerToAgentMap[customer.CardCode] = customer.assignedTo.toString();
      });

      res.status(200).json({
        success: true,
        data: {
          summary,
          teamMembers: performance,
          performance: performance.sort(
            (a, b) => b.achievementRate - a.achievementRate
          ),
          activities,
          charts,
          dateRange: { start, end },
          // Add new data for orders and quotations
          recentOrders: salesOrders
            .sort((a, b) => new Date(b.DocDate) - new Date(a.DocDate))
            .slice(0, 10)
            .map((o) => ({
              id: o._id,
              docNum: o.DocNum,
              customer: o.CardName,
              agent: getAgentNameByCustomerCode(
                o.CardCode,
                customerToAgentMap,
                teamMembers
              ),
              amount: o.DocTotal,
              date: o.DocDate,
              status: o.DocumentStatus,
            })),
          recentQuotations: quotations
            .sort((a, b) => new Date(b.DocDate) - new Date(a.DocDate))
            .slice(0, 10)
            .map((q) => ({
              id: q._id,
              docNum: q.DocNum,
              customer: q.CardName,
              agent: getAgentNameByCustomerCode(
                q.CardCode,
                customerToAgentMap,
                teamMembers
              ),
              amount: q.DocTotal,
              date: q.DocDate,
              status: q.DocumentStatus,
            })),
        },
      });
    } catch (error) {
      console.error("Error fetching sales manager dashboard:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching dashboard data",
        error: error.message,
      });
    }
  },

  /**
   * Get team overview with basic stats
   */
  getTeamOverview: async (req, res) => {
    try {
      const managerId = req.user._id;

      const teamMembers = await User.find({
        role: "sales_agent",
        deactivated: false,
        manager: managerId,
      })
        .select("firstName lastName email phone target targetAchieved")
        .lean();

      const overview = {
        totalTeamMembers: teamMembers.length,
        totalTarget: teamMembers.reduce(
          (sum, member) => sum + (member.target || 0),
          0
        ),
        totalAchieved: teamMembers.reduce(
          (sum, member) => sum + (member.targetAchieved || 0),
          0
        ),
        teamAchievementRate: 0,
      };

      if (overview.totalTarget > 0) {
        overview.teamAchievementRate =
          (overview.totalAchieved / overview.totalTarget) * 100;
      }

      res.status(200).json({
        success: true,
        data: {
          overview,
          teamMembers: teamMembers.map((member) => ({
            id: member._id,
            name: `${member.firstName} ${member.lastName}`,
            email: member.email,
            target: member.target || 0,
            achieved: member.targetAchieved || 0,
            achievementRate:
              member.target > 0
                ? ((member.targetAchieved || 0) / member.target) * 100
                : 0,
          })),
        },
      });
    } catch (error) {
      console.error("Error fetching team overview:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching team overview",
        error: error.message,
      });
    }
  },

  /**
   * Get team calls data
   */
  getTeamCalls: async (req, res) => {
    try {
      const managerId = req.user._id;
      const { startDate, endDate, limit = 20 } = req.query;

      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000); // Default 7 days

      const teamMembers = await User.find({
        role: "sales_agent",
        deactivated: false,
        manager: managerId,
      })
        .select("firstName lastName phone")
        .lean();

      const callData = await getTeamCallData(teamMembers, start, end);

      // Get recent calls with agent names
      const recentCalls = callData
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
        .slice(0, parseInt(limit))
        .map((call) => {
          const agent = teamMembers.find(
            (member) =>
              member.phone &&
              (call.phone === member.phone ||
                call.fromNumber === member.phone ||
                call.toNumber === member.phone)
          );

          return {
            ...call,
            agentName: agent
              ? `${agent.firstName} ${agent.lastName}`
              : "Unknown",
          };
        });

      const stats = {
        totalCalls: callData.length,
        inboundCalls: callData.filter((call) => call.direction === "in").length,
        outboundCalls: callData.filter((call) => call.direction === "out")
          .length,
        missedCalls: callData.filter((call) => call.missed).length,
        totalDuration: callData.reduce(
          (sum, call) => sum + (call.inCallDuration || 0),
          0
        ),
        averageDuration:
          callData.length > 0
            ? callData.reduce(
                (sum, call) => sum + (call.inCallDuration || 0),
                0
              ) / callData.length
            : 0,
      };

      res.status(200).json({
        success: true,
        data: {
          calls: recentCalls,
          stats,
          dateRange: { start, end },
        },
      });
    } catch (error) {
      console.error("Error fetching team calls:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching team calls",
        error: error.message,
      });
    }
  },
};

// Helper Functions

/**
 * Get call data for team members
 */
async function getTeamCallData(teamMembers, startDate, endDate) {
  const teamPhones = teamMembers.map((member) => member.phone).filter(Boolean);

  if (teamPhones.length === 0) return [];

  return await CallData.find({
    startTime: { $gte: startDate, $lte: endDate },
    $or: [
      { phone: { $in: teamPhones } },
      { fromNumber: { $in: teamPhones } },
      { toNumber: { $in: teamPhones } },
    ],
  })
    .sort({ startTime: -1 })
    .lean();
}

/**
 * Calculate team performance metrics
 */
async function calculateTeamPerformance(
  teamMemberIds,
  customerCodes,
  startDate,
  endDate
) {
  if (customerCodes.length === 0) return [];

  // Get invoices for each team member's customers
  const customerToAgent = await Customer.find({
    assignedTo: { $in: teamMemberIds },
  })
    .select("CardCode assignedTo")
    .lean();

  const customerAgentMap = {};
  customerToAgent.forEach((customer) => {
    customerAgentMap[customer.CardCode] = customer.assignedTo;
  });

  console.log("Customer to Agent Map:", customerAgentMap);

  // Get all data in parallel
  const [invoices, salesOrders, quotations, callData] = await Promise.all([
    Invoice.find({
      CardCode: { $in: customerCodes },
      DocDate: { $gte: startDate, $lte: endDate },
    }).lean(),

    SalesOrder.find({
      CardCode: { $in: customerCodes },
      DocDate: { $gte: startDate, $lte: endDate },
    }).lean(),

    Quotation.find({
      CardCode: { $in: customerCodes },
      DocDate: { $gte: startDate, $lte: endDate },
    }).lean(),

    CallData.find({
      startTime: { $gte: startDate, $lte: endDate },
    }).lean(),
  ]);

  // Group data by agent
  const agentPerformance = {};

  // Initialize all team members
  teamMemberIds.forEach((agentId) => {
    agentPerformance[agentId.toString()] = {
      agentId,
      totalSales: 0,
      invoicesCount: 0,
      salesOrdersCount: 0,
      salesOrdersAmount: 0,
      quotationsCount: 0,
      quotationsAmount: 0,
      customersCount: 0,
      callsCount: 0,
      lastActivity: null,
    };
  });

  // Process invoices
  invoices.forEach((invoice) => {
    const agentId = customerAgentMap[invoice.CardCode];
    if (agentId) {
      const agentIdStr = agentId.toString();
      if (agentPerformance[agentIdStr]) {
        agentPerformance[agentIdStr].totalSales += invoice.DocTotal || 0;
        agentPerformance[agentIdStr].invoicesCount += 1;

        const invoiceDate = new Date(invoice.DocDate);
        if (
          !agentPerformance[agentIdStr].lastActivity ||
          invoiceDate > agentPerformance[agentIdStr].lastActivity
        ) {
          agentPerformance[agentIdStr].lastActivity = invoiceDate;
        }
      }
    }
  });

  // Process sales orders
  salesOrders.forEach((order) => {
    const agentId = customerAgentMap[order.CardCode];
    if (agentId) {
      const agentIdStr = agentId.toString();
      if (agentPerformance[agentIdStr]) {
        agentPerformance[agentIdStr].salesOrdersCount += 1;
        agentPerformance[agentIdStr].salesOrdersAmount += order.DocTotal || 0;

        const orderDate = new Date(order.DocDate);
        if (
          !agentPerformance[agentIdStr].lastActivity ||
          orderDate > agentPerformance[agentIdStr].lastActivity
        ) {
          agentPerformance[agentIdStr].lastActivity = orderDate;
        }
      }
    }
  });

  // Process quotations
  quotations.forEach((quotation) => {
    const agentId = customerAgentMap[quotation.CardCode];
    if (agentId) {
      const agentIdStr = agentId.toString();
      if (agentPerformance[agentIdStr]) {
        agentPerformance[agentIdStr].quotationsCount += 1;
        agentPerformance[agentIdStr].quotationsAmount +=
          quotation.DocTotal || 0;

        const quotationDate = new Date(quotation.DocDate);
        if (
          !agentPerformance[agentIdStr].lastActivity ||
          quotationDate > agentPerformance[agentIdStr].lastActivity
        ) {
          agentPerformance[agentIdStr].lastActivity = quotationDate;
        }
      }
    }
  });

  // Calculate unique customers per agent
  const agentCustomers = {};
  customerToAgent.forEach((customer) => {
    const agentIdStr = customer.assignedTo.toString();
    if (!agentCustomers[agentIdStr]) agentCustomers[agentIdStr] = new Set();
    agentCustomers[agentIdStr].add(customer.CardCode);
  });

  Object.keys(agentCustomers).forEach((agentIdStr) => {
    if (agentPerformance[agentIdStr]) {
      agentPerformance[agentIdStr].customersCount =
        agentCustomers[agentIdStr].size;
    }
  });

  return Object.values(agentPerformance);
}

/**
 * Calculate summary metrics
 */
function calculateSummaryMetrics(
  teamMembers,
  invoices,
  salesOrders,
  quotations,
  callData
) {
  const totalTarget = teamMembers.reduce(
    (sum, member) => sum + (member.target || 0),
    0
  );
  const totalSales = invoices.reduce(
    (sum, invoice) => sum + (invoice.DocTotal || 0),
    0
  );
  const achievementRate =
    totalTarget > 0 ? (totalSales / totalTarget) * 100 : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const callsToday = callData.filter(
    (call) => new Date(call.startTime) >= today
  ).length;

  // Calculate orders metrics
  const totalOrdersAmount = salesOrders.reduce(
    (sum, order) => sum + (order.DocTotal || 0),
    0
  );

  const ordersThisMonth = salesOrders.filter((o) => {
    const orderDate = new Date(o.DocDate);
    const now = new Date();
    return (
      orderDate.getMonth() === now.getMonth() &&
      orderDate.getFullYear() === now.getFullYear()
    );
  });

  // Calculate quotations metrics
  const totalQuotationsAmount = quotations.reduce(
    (sum, quotation) => sum + (quotation.DocTotal || 0),
    0
  );

  const quotationsThisMonth = quotations.filter((q) => {
    const quotationDate = new Date(q.DocDate);
    const now = new Date();
    return (
      quotationDate.getMonth() === now.getMonth() &&
      quotationDate.getFullYear() === now.getFullYear()
    );
  });

  return {
    teamSize: teamMembers.length,
    totalTarget: Math.round(totalTarget),
    totalSales: Math.round(totalSales),
    achievementRate: Math.round(achievementRate * 100) / 100,
    totalInvoices: invoices.length,
    totalCalls: callData.length,
    callsToday,
    averageCallDuration:
      callData.length > 0
        ? Math.round(
            callData.reduce(
              (sum, call) => sum + (call.inCallDuration || 0),
              0
            ) / callData.length
          )
        : 0,
    // New metrics for orders and quotations
    totalOrders: salesOrders.length,
    totalOrdersAmount: Math.round(totalOrdersAmount),
    ordersThisMonth: ordersThisMonth.length,
    ordersThisMonthAmount: Math.round(
      ordersThisMonth.reduce((sum, o) => sum + (o.DocTotal || 0), 0)
    ),
    totalQuotations: quotations.length,
    totalQuotationsAmount: Math.round(totalQuotationsAmount),
    quotationsThisMonth: quotationsThisMonth.length,
    quotationsThisMonthAmount: Math.round(
      quotationsThisMonth.reduce((sum, q) => sum + (q.DocTotal || 0), 0)
    ),
  };
}

/**
 * Calculate chart data
 */
function calculateChartsData(
  invoices,
  salesOrders,
  quotations,
  callData,
  startDate,
  endDate
) {
  // Monthly trends for all three types
  const monthlyData = {};

  // Process invoices
  invoices.forEach((invoice) => {
    const date = new Date(invoice.DocDate);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;
    const monthLabel = date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthLabel,
        sales: 0,
        orders: 0,
        quotations: 0,
        invoices: 0,
        ordersCount: 0,
        quotationsCount: 0,
        date: new Date(date.getFullYear(), date.getMonth(), 1),
      };
    }

    monthlyData[monthKey].sales += invoice.DocTotal || 0;
    monthlyData[monthKey].invoices += 1;
  });

  // Process sales orders
  salesOrders.forEach((order) => {
    const date = new Date(order.DocDate);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;
    const monthLabel = date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthLabel,
        sales: 0,
        orders: 0,
        quotations: 0,
        invoices: 0,
        ordersCount: 0,
        quotationsCount: 0,
        date: new Date(date.getFullYear(), date.getMonth(), 1),
      };
    }

    monthlyData[monthKey].orders += order.DocTotal || 0;
    monthlyData[monthKey].ordersCount += 1;
  });

  // Process quotations
  quotations.forEach((quotation) => {
    const date = new Date(quotation.DocDate);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;
    const monthLabel = date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthLabel,
        sales: 0,
        orders: 0,
        quotations: 0,
        invoices: 0,
        ordersCount: 0,
        quotationsCount: 0,
        date: new Date(date.getFullYear(), date.getMonth(), 1),
      };
    }

    monthlyData[monthKey].quotations += quotation.DocTotal || 0;
    monthlyData[monthKey].quotationsCount += 1;
  });

  const combinedTrend = Object.values(monthlyData)
    .sort((a, b) => a.date - b.date)
    .slice(-6) // Last 6 months
    .map((item) => ({
      month: item.month,
      sales: Math.round(item.sales),
      orders: Math.round(item.orders),
      quotations: Math.round(item.quotations),
      invoices: item.invoices,
      ordersCount: item.ordersCount,
      quotationsCount: item.quotationsCount,
    }));

  // Daily calls trend (last 7 days)
  const dailyCalls = {};
  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);

  callData
    .filter((call) => new Date(call.startTime) >= last7Days)
    .forEach((call) => {
      const date = new Date(call.startTime);
      const dayKey = date.toISOString().split("T")[0];
      const dayLabel = date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

      if (!dailyCalls[dayKey]) {
        dailyCalls[dayKey] = { day: dayLabel, calls: 0, duration: 0 };
      }

      dailyCalls[dayKey].calls += 1;
      dailyCalls[dayKey].duration += call.inCallDuration || 0;
    });

  const callsTrend = Object.values(dailyCalls).slice(-7);

  return {
    salesTrend: combinedTrend,
    callsTrend,
  };
}

/**
 * Get recent activities
 */
async function getRecentActivities(
  teamMemberIds,
  customerCodes,
  teamCustomers,
  startDate,
  endDate
) {
  const activities = [];

  // Create customer to agent mapping
  const customerToAgentMap = {};
  teamCustomers.forEach((customer) => {
    customerToAgentMap[customer.CardCode] = customer.assignedTo;
  });

  // Get team members for name lookup
  const teamMembers = await User.find({
    _id: { $in: teamMemberIds },
  })
    .select("firstName lastName")
    .lean();

  const agentNameMap = {};
  teamMembers.forEach((member) => {
    agentNameMap[
      member._id.toString()
    ] = `${member.firstName} ${member.lastName}`;
  });

  if (customerCodes.length > 0) {
    // Get recent invoices
    const recentInvoices = await Invoice.find({
      CardCode: { $in: customerCodes },
      DocDate: { $gte: startDate, $lte: endDate },
    })
      .sort({ DocDate: -1 })
      .limit(5)
      .lean();

    recentInvoices.forEach((invoice) => {
      const agentId = customerToAgentMap[invoice.CardCode];
      const agentName = agentId ? agentNameMap[agentId.toString()] : "Unknown";

      activities.push({
        type: "invoice",
        date: invoice.DocDate,
        title: `Invoice #${invoice.DocNum} created`,
        description: `${invoice.CardName} - ${formatCurrency(
          invoice.DocTotal
        )} by ${agentName}`,
        amount: invoice.DocTotal,
        customer: invoice.CardName,
        agent: agentName,
      });
    });

    // Get recent sales orders
    const recentOrders = await SalesOrder.find({
      CardCode: { $in: customerCodes },
      DocDate: { $gte: startDate, $lte: endDate },
    })
      .sort({ DocDate: -1 })
      .limit(5)
      .lean();

    recentOrders.forEach((order) => {
      const agentId = customerToAgentMap[order.CardCode];
      const agentName = agentId ? agentNameMap[agentId.toString()] : "Unknown";

      activities.push({
        type: "order",
        date: order.DocDate,
        title: `Sales Order #${order.DocNum} created`,
        description: `${order.CardName} - ${formatCurrency(
          order.DocTotal
        )} by ${agentName}`,
        amount: order.DocTotal,
        customer: order.CardName,
        agent: agentName,
      });
    });

    // Get recent quotations
    const recentQuotations = await Quotation.find({
      CardCode: { $in: customerCodes },
      DocDate: { $gte: startDate, $lte: endDate },
    })
      .sort({ DocDate: -1 })
      .limit(5)
      .lean();

    recentQuotations.forEach((quotation) => {
      const agentId = customerToAgentMap[quotation.CardCode];
      const agentName = agentId ? agentNameMap[agentId.toString()] : "Unknown";

      activities.push({
        type: "quotation",
        date: quotation.DocDate,
        title: `Quotation #${quotation.DocNum} created`,
        description: `${quotation.CardName} - ${formatCurrency(
          quotation.DocTotal
        )} by ${agentName}`,
        amount: quotation.DocTotal,
        customer: quotation.CardName,
        agent: agentName,
      });
    });
  }

  // Sort activities by date
  activities.sort((a, b) => new Date(b.date) - new Date(a.date));

  return activities.slice(0, 20); // Return latest 20 activities
}

/**
 * Get empty dashboard data structure
 */
function getEmptyDashboardData() {
  return {
    teamSize: 0,
    totalTarget: 0,
    totalSales: 0,
    achievementRate: 0,
    totalInvoices: 0,
    totalCalls: 0,
    callsToday: 0,
    averageCallDuration: 0,
  };
}

/**
 * Get empty chart data structure
 */
function getEmptyChartData() {
  return {
    salesTrend: [],
    callsTrend: [],
  };
}

/**
 * Format currency for display
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

module.exports = salesManagerDashboardController;
