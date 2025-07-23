// controllers/salesAgentJourney.controller.js
const User = require("../models/User");
const Customer = require("../models/Customer");
const SalesOrder = require("../models/SalesOrder");
const CallData = require("../models/CallData");
const Invoice = require("../models/Invoice");
const Quotation = require("../models/Quotation");
const DeskTime = require("../models/desktime.model");
const CustomerTarget = require("../models/CustomerTarget");
const mongoose = require("mongoose");

/**
 * Comprehensive controller to fetch all data related to a sales agent's journey
 * Provides a holistic view of their customers, calls, sales, and productivity
 */
const salesAgentJourneyController = {
  /**
   * Get complete sales agent dashboard with all metrics
   */
  getDashboard: async (req, res) => {
    try {
      const { agentId } = req.params;
      const { startDate, endDate } = req.query;

      // Set default date range if not provided (last 30 days)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Find the sales agent
      const agent = await User.findById(agentId)
        .populate("manager", "firstName lastName email")
        .lean();

      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

     

      const customers = await Customer.find({ assignedTo: agentId }).lean();
      const customerCodes = customers.map((c) => c.CardCode);

      const customerTargets = await CustomerTarget.find({
        salesAgent: agentId,
        status: "active",
      }).lean();

      const totalClientAverages = customerTargets.reduce((sum, target) => {
        return sum + (target.clientExistingAverage || 0);
      }, 0);

      // Get all metrics in parallel for better performance
      const [callData, desktimeData, targetProgress] = await Promise.all([
        // Get call data
        CallData.find({
          startTime: { $gte: start, $lte: end },
          $or: [{ fromNumber: agent.phone }, { toNumber: agent.phone }],
        })
          .sort({ startTime: -1 })
          .lean(),

        // Get productivity data
        DeskTime.find({
          email: agent.email,
          date: { $gte: start, $lte: end },
        })
          .sort({ date: -1 })
          .lean(),

        // Calculate current period target achievement
        getAgentCurrentTargetProgress(agent),
      ]);

      // *** FIX: Use consistent invoice fetching logic ***
      const [invoices, salesOrders] = await Promise.all([
        // Get invoices for assigned customers
        customerCodes.length > 0
          ? Invoice.find({
              CardCode: { $in: customerCodes },
              DocDate: { $gte: start, $lte: end },
            }).lean()
          : [],

        // Get sales orders for assigned customers
        customerCodes.length > 0
          ? SalesOrder.find({
              CardCode: { $in: customerCodes },
              DocDate: { $gte: start, $lte: end },
            }).lean()
          : [],
      ]);

      const totalSales = invoices.reduce(
        (sum, invoice) => sum + (invoice.DocTotal || 0),
        0
      );

      // STEP 4: Now calculate commission eligible sales
      const commissionEligibleSales = totalSales - totalClientAverages;

      // Calculate attendance metrics (4+ hours = half day, 7+ hours = full day)
      let totalWorkingDays = 0;
      let totalFullDays = 0;
      let totalHalfDays = 0;
      let totalAbsentDays = 0;

      // Get working days in the date range (Monday to Friday)
      const current = new Date(start);
      while (current <= end) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          totalWorkingDays++;

          // Find corresponding desktime record
          const dayKey = current.toISOString().split("T")[0];
          const desktimeRecord = desktimeData.find(
            (record) => record.date.toISOString().split("T")[0] === dayKey
          );

          const hoursWorked = desktimeRecord
            ? desktimeRecord.totalDeskTimeHours || 0
            : 0;

          if (hoursWorked >= 7) {
            totalFullDays++;
          } else if (hoursWorked >= 4) {
            totalHalfDays++;
          } else {
            totalAbsentDays++;
          }
        }
        current.setDate(current.getDate() + 1);
      }

      // Calculate summary metrics using the same invoice data
      const summary = {
        // Customer metrics
        totalCustomers: customers.length,
        activeCustomers: customers.filter((c) => c.status === "active").length,

        // Sales metrics - Use invoices for consistency
        totalOrders: invoices.length,
        totalSales: invoices.reduce(
          (sum, invoice) => sum + (invoice.DocTotal || 0),
          0
        ),
        averageOrderValue:
          invoices.length > 0
            ? invoices.reduce(
                (sum, invoice) => sum + (invoice.DocTotal || 0),
                0
              ) / invoices.length
            : 0,
        totalClientAverages: parseFloat(totalClientAverages.toFixed(2)),
        commissionEligibleSales: parseFloat(commissionEligibleSales.toFixed(2)),
        // Sales Orders metrics (separate from invoices)
        totalSalesOrders: salesOrders.length,
        totalSalesOrderAmount: salesOrders.reduce(
          (sum, order) => sum + (order.DocTotal || 0),
          0
        ),

        // Call metrics
        totalCalls: callData.length,
        inboundCalls: callData.filter((call) => call.direction === "in").length,
        outboundCalls: callData.filter((call) => call.direction === "out")
          .length,
        missedCalls: callData.filter((call) => call.missed).length,
        totalCallDuration: callData.reduce(
          (sum, call) => sum + (call.inCallDuration || 0),
          0
        ),
        averageCallDuration:
          callData.length > 0
            ? callData.reduce(
                (sum, call) => sum + (call.inCallDuration || 0),
                0
              ) / callData.length
            : 0,

        // Updated productivity metrics
        totalDeskTime: desktimeData.reduce(
          (sum, record) => sum + (record.totalDeskTimeHours || 0),
          0
        ),
        totalProductiveTime: desktimeData.reduce(
          (sum, record) => sum + (record.productiveTimeHours || 0),
          0
        ),
        averageProductivity:
          desktimeData.length > 0
            ? (desktimeData.reduce(
                (sum, record) => sum + (record.productiveTimeHours || 0),
                0
              ) /
                desktimeData.reduce(
                  (sum, record) => sum + (record.totalDeskTimeHours || 0),
                  0
                )) *
              100
            : 0,

        // New attendance metrics
        totalWorkingDays,
        totalFullDays,
        totalHalfDays,
        totalAbsentDays,
        attendanceRate:
          totalWorkingDays > 0
            ? ((totalFullDays + totalHalfDays) / totalWorkingDays) * 100
            : 0,
        fullDayRate:
          totalWorkingDays > 0 ? (totalFullDays / totalWorkingDays) * 100 : 0,
        averageHoursPerDay:
          totalWorkingDays > 0
            ? desktimeData.reduce(
                (sum, record) => sum + (record.totalDeskTimeHours || 0),
                0
              ) / totalWorkingDays
            : 0,

        // Target metrics
        currentTarget: agent.target || 0,
        targetAchieved: targetProgress.achieved || 0,
        targetProgress: targetProgress.progressPercent || 0,
        remainingTarget: (agent.target || 0) - (targetProgress.achieved || 0),
      };

      console.log("Sales Agent Dashboard Summary:", summary);

      // Format numbers for consistency
      Object.keys(summary).forEach((key) => {
        if (typeof summary[key] === "number") {
          summary[key] = parseFloat(summary[key].toFixed(2));
        }
      });

      // Calculate time-based trends (daily/weekly data)
      const trends = await calculateAgentTrends(agentId, agent, start, end);

      // Get top performing customers
      const topCustomers = await getTopCustomers(agentId, start, end);

      // Get recent sales activities
      const recentActivities = await getRecentActivities(
        agentId,
        agent,
        start,
        end
      );

      return res.status(200).json({
        success: true,
        agent: {
          id: agent._id,
          name: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
          phone: agent.phone,
          target: agent.target,
          manager: agent.manager
            ? `${agent.manager.firstName} ${agent.manager.lastName}`
            : null,
        },
        summary,
        trends,
        topCustomers,
        recentActivities,
        dateRange: {
          start,
          end,
        },
      });
    } catch (error) {
      console.error("Error fetching sales agent dashboard:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching sales agent dashboard",
        error: error.message,
      });
    }
  },

  /**
   * Get all customers assigned to a sales agent with metrics
   */
  getAgentCustomers: async (req, res) => {
    try {
      const { agentId } = req.params;
      const {
        page = 1,
        limit = 10,
        search,
        status,
        startDate,
        endDate,
        sortBy = "CardName",
        sortOrder = "asc",
      } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Build query for customers assigned to this agent
      const query = { assignedTo: agentId };

      // Add search filter if provided
      if (search) {
        query.$or = [
          { CardName: new RegExp(search, "i") },
          { CardCode: new RegExp(search, "i") },
          { Email: new RegExp(search, "i") },
        ];
      }

      // Add status filter if provided
      if (status) {
        query.status = status;
      }

      // Get all matching customers without pagination first (for metrics calculation)
      const allCustomers = await Customer.find(query)
        .select("CardCode CardName Email phoneNumber status assignedTo")
        .populate("assignedTo", "firstName lastName email")
        .lean();

      if (allCustomers.length === 0) {
        return res.status(200).json({
          success: true,
          customers: [],
          pagination: {
            total: 0,
            page: parseInt(page),
            pages: 0,
            limit: parseInt(limit),
          },
        });
      }

      // Extract customer codes for metrics queries
      const customerCodes = allCustomers.map((c) => c.CardCode);

      // Set up date filter for metrics if provided
      let dateFilter = {};
      if (startDate && endDate) {
        dateFilter = {
          DocDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        };
      }

      // Get metrics for all customers in parallel
      const [
        invoiceCounts,
        invoiceTotals,
        orderCounts,
        orderTotals,
        quotationCounts,
        latestInvoiceDates,
      ] = await Promise.all([
        // Invoice counts
        Invoice.aggregate([
          {
            $match: {
              CardCode: { $in: customerCodes },
              ...dateFilter,
            },
          },
          { $group: { _id: "$CardCode", count: { $sum: 1 } } },
        ]),

        // Invoice totals (SAP Turnover)
        Invoice.aggregate([
          {
            $match: {
              CardCode: { $in: customerCodes },
              ...dateFilter,
            },
          },
          { $group: { _id: "$CardCode", totalAmount: { $sum: "$DocTotal" } } },
        ]),

        // Sales Order counts
        SalesOrder.aggregate([
          {
            $match: {
              CardCode: { $in: customerCodes },
              ...dateFilter,
            },
          },
          { $group: { _id: "$CardCode", count: { $sum: 1 } } },
        ]),

        // Sales Order totals
        SalesOrder.aggregate([
          {
            $match: {
              CardCode: { $in: customerCodes },
              ...dateFilter,
            },
          },
          { $group: { _id: "$CardCode", totalAmount: { $sum: "$DocTotal" } } },
        ]),

        // Quotation counts
        Quotation.aggregate([
          {
            $match: {
              CardCode: { $in: customerCodes },
              ...dateFilter,
            },
          },
          { $group: { _id: "$CardCode", count: { $sum: 1 } } },
        ]),

        // Latest invoice dates
        Invoice.aggregate([
          {
            $match: {
              CardCode: { $in: customerCodes },
              ...dateFilter,
            },
          },
          { $sort: { DocDate: -1 } },
          {
            $group: {
              _id: "$CardCode",
              latestInvoiceDate: { $first: "$DocDate" },
            },
          },
        ]),
      ]);

      // Create lookup maps for O(1) access
      const invoiceCountMap = {};
      invoiceCounts.forEach((item) => {
        invoiceCountMap[item._id] = item.count;
      });

      const invoiceTotalMap = {};
      invoiceTotals.forEach((item) => {
        invoiceTotalMap[item._id] = item.totalAmount;
      });

      const orderCountMap = {};
      orderCounts.forEach((item) => {
        orderCountMap[item._id] = item.count;
      });

      const orderTotalMap = {};
      orderTotals.forEach((item) => {
        orderTotalMap[item._id] = item.totalAmount;
      });

      const quotationCountMap = {};
      quotationCounts.forEach((item) => {
        quotationCountMap[item._id] = item.count;
      });

      const latestInvoiceDateMap = {};
      latestInvoiceDates.forEach((item) => {
        latestInvoiceDateMap[item._id] = item.latestInvoiceDate;
      });

      // Enhance customers with metrics
      const enhancedCustomers = allCustomers.map((customer) => {
        return {
          ...customer,
          metrics: {
            invoiceCount: invoiceCountMap[customer.CardCode] || 0,
            sapTurnover: invoiceTotalMap[customer.CardCode] || 0,
            orderCount: orderCountMap[customer.CardCode] || 0,
            orderTotal: orderTotalMap[customer.CardCode] || 0,
            quotationCount: quotationCountMap[customer.CardCode] || 0,
            latestInvoiceDate: latestInvoiceDateMap[customer.CardCode] || null,
          },
        };
      });

      // Apply sorting based on sortBy parameter
      enhancedCustomers.sort((a, b) => {
        let aValue, bValue;
        const sortDirection = sortOrder === "desc" ? -1 : 1;

        switch (sortBy) {
          case "sapTurnover":
            aValue = a.metrics.sapTurnover;
            bValue = b.metrics.sapTurnover;
            break;
          case "invoiceCount":
            aValue = a.metrics.invoiceCount;
            bValue = b.metrics.invoiceCount;
            break;
          case "orderCount":
            aValue = a.metrics.orderCount;
            bValue = b.metrics.orderCount;
            break;
          case "quotationCount":
            aValue = a.metrics.quotationCount;
            bValue = b.metrics.quotationCount;
            break;
          case "latestInvoiceDate":
            aValue = a.metrics.latestInvoiceDate
              ? new Date(a.metrics.latestInvoiceDate).getTime()
              : 0;
            bValue = b.metrics.latestInvoiceDate
              ? new Date(b.metrics.latestInvoiceDate).getTime()
              : 0;
            break;
          case "CardName":
          default:
            return sortDirection * a.CardName.localeCompare(b.CardName);
        }

        return sortDirection * (aValue - bValue);
      });

      // Apply pagination after sorting
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const paginatedCustomers = enhancedCustomers.slice(
        skip,
        skip + parseInt(limit)
      );

      // Get total count
      const total = enhancedCustomers.length;

      return res.status(200).json({
        success: true,
        customers: paginatedCustomers,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          limit: parseInt(limit),
        },
        dateRange: startDate && endDate ? { startDate, endDate } : null,
      });
    } catch (error) {
      console.error("Error fetching agent customers:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent customers",
        error: error.message,
      });
    }
  },

  /**
   * Get all calls made/received by a sales agent
   */
  getAgentCalls: async (req, res) => {
    try {
      const { agentId } = req.params;
      const {
        page = 1,
        limit = 10,
        startDate,
        endDate,
        direction,
        status,
      } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Set default date range if not provided (last 30 days)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Build query
      const query = {
        startTime: { $gte: start, $lte: end },
        $or: [
          { userName: `${agent.firstName} ${agent.lastName}` },
          { userName: agent.email },
          ...(agent.phone
            ? [{ fromNumber: agent.phone }, { toNumber: agent.phone }]
            : []),
        ],
      };
      // Add direction filter if provided
      if (direction && direction !== "all") {
        query.direction = direction;
      }

      // Add status filter if provided
      if (status === "missed") {
        query.$or.push(
          { missed: "Y" },
          { missed: "true" },
          { missed: true },
          { missed: "1" },
          { missed: { $ne: "" } }
        );
      } else if (status === "answered") {
        query.missed = { $in: ["", "N", "false", false, "0", null] };
      }
      // Pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Execute query
      const calls = await CallData.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ startTime: -1 });

      // Get total count
      const total = await CallData.countDocuments(query);

      // Calculate call statistics
      const inboundCalls = await CallData.countDocuments({
        ...query,
        direction: "in",
      });

      const outboundCalls = await CallData.countDocuments({
        ...query,
        direction: "out",
      });

      const missedCalls = await CallData.countDocuments({
        ...query,
        missed: { $ne: "" },
      });

      // Calculate average duration
      const durationStats = await CallData.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalDuration: { $sum: "$inCallDuration" },
            avgDuration: { $avg: "$inCallDuration" },
          },
        },
      ]);

      const averageDuration =
        durationStats.length > 0 ? durationStats[0].avgDuration : 0;

      return res.status(200).json({
        success: true,
        count: calls.length,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        stats: {
          totalCalls: total,
          inboundCalls,
          outboundCalls,
          missedCalls,
          averageDuration,
          answerRate: total > 0 ? ((total - missedCalls) / total) * 100 : 0,
        },
        data: calls,
      });
    } catch (error) {
      console.error("Error fetching agent calls:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent calls",
        error: error.message,
      });
    }
  },

  /**
   * Get all sales orders for a sales agent
   */
  getAgentSalesOrders: async (req, res) => {
    try {
      const { agentId } = req.params;
      const {
        page = 1,
        limit = 10,
        startDate,
        endDate,
        status,
        customerCode,
        sortBy = "DocDate",
        sortDirection = -1,
      } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Set default date range if not provided (last 30 days)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      const customers = await Customer.find({ assignedTo: agentId }).lean();
      const customerCodes = customers.map((c) => c.CardCode);
      // *** FIX: Use direct sales agent assignment (not customer-based) ***
      if (customerCodes.length === 0) {
        return res.status(200).json({
          success: true,
          count: 0,
          total: 0,
          page: parseInt(page),
          pages: 0,
          stats: {
            totalOrders: 0,
            totalAmount: 0,
            averageOrderValue: 0,
            syncedOrders: 0,
            failedOrders: 0,
          },
          data: [],
        });
      }

      // Build query using assigned customer codes
      const query = {
        CardCode: { $in: customerCodes },
        DocDate: { $gte: start, $lte: end },
      };

      // Add status filter if provided
      if (status) {
        query.DocumentStatus = status;
      }

      // Add customer filter if provided
      if (customerCode) {
        query.CardCode = customerCode;
      }

      // Pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Execute query
      const orders = await SalesOrder.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ [sortBy]: parseInt(sortDirection) });

      // Get total count
      const total = await SalesOrder.countDocuments(query);

      // Calculate order statistics
      const totalSales = await SalesOrder.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$DocTotal" },
            avgAmount: { $avg: "$DocTotal" },
          },
        },
      ]);

      const syncedOrders = await SalesOrder.countDocuments({
        ...query,
        SyncedWithSAP: true,
      });

      const failedOrders = await SalesOrder.countDocuments({
        ...query,
        LocalStatus: "SyncFailed",
      });

      return res.status(200).json({
        success: true,
        count: orders.length,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        stats: {
          totalOrders: total,
          totalAmount: totalSales.length > 0 ? totalSales[0].totalAmount : 0,
          averageOrderValue:
            totalSales.length > 0 ? totalSales[0].avgAmount : 0,
          syncedOrders,
          failedOrders,
        },
        data: orders,
      });
    } catch (error) {
      console.error("Error fetching agent sales orders:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent sales orders",
        error: error.message,
      });
    }
  },

  /**
   * Get productivity data for a sales agent
   */
  getAgentProductivity: async (req, res) => {
    try {
      const { agentId } = req.params;
      const { startDate, endDate, groupBy = "day" } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      const customers = await Customer.find({ assignedTo: agentId }).lean();
      const customerCodes = customers.map((c) => c.CardCode);

      // Set default date range if not provided (last 30 days)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Query DeskTime records for this agent
      const desktimeRecords = await DeskTime.find({
        date: { $gte: start, $lte: end },
        email: agent.email,
      }).sort({ date: 1 });

      // Get sales data for the same period
      const salesData =
        customerCodes.length > 0
          ? await Invoice.find({
              CardCode: { $in: customerCodes },
              DocDate: { $gte: start, $lte: end },
            })
          : [];

      // Group data by day, week, or month
      const groupedData = {};
      let totalProductiveHours = 0;
      let totalDeskHours = 0;

      // Process DeskTime records
      desktimeRecords.forEach((record) => {
        const date = record.date;
        let key;

        // Get grouping key based on groupBy parameter
        switch (groupBy) {
          case "week":
            const weekStartDate = new Date(date);
            weekStartDate.setDate(date.getDate() - date.getDay());
            key = weekStartDate.toISOString().split("T")[0];
            break;
          case "month":
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
              2,
              "0"
            )}`;
            break;
          case "day":
          default:
            key = date.toISOString().split("T")[0];
            break;
        }

        // Initialize group if not exists
        if (!groupedData[key]) {
          groupedData[key] = {
            period: key,
            days: 0,
            productiveHours: 0,
            deskHours: 0,
            productivity: 0,
            salesAmount: 0,
            orderCount: 0,
          };
        }

        // Update group data
        groupedData[key].days += 1;
        groupedData[key].productiveHours += record.productiveTimeHours || 0;
        groupedData[key].deskHours += record.totalDeskTimeHours || 0;

        // Update totals
        totalProductiveHours += record.productiveTimeHours || 0;
        totalDeskHours += record.totalDeskTimeHours || 0;
      });

      // Add sales data to the groups
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

        // Update group if exists
        if (groupedData[key]) {
          groupedData[key].salesAmount += sale.DocTotal || 0;
          groupedData[key].orderCount += 1;
        } else {
          // Create group if we have sales but no DeskTime record
          groupedData[key] = {
            period: key,
            days: 0,
            productiveHours: 0,
            deskHours: 0,
            productivity: 0,
            salesAmount: sale.DocTotal || 0,
            orderCount: 1,
          };
        }
      });

      // Calculate productivity percentages and format numbers
      Object.values(groupedData).forEach((data) => {
        data.productivity =
          data.deskHours > 0
            ? (data.productiveHours / data.deskHours) * 100
            : 0;

        // Format numbers to 2 decimal places
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
        totalDays: desktimeRecords.length,
        totalProductiveHours: parseFloat(totalProductiveHours.toFixed(2)),
        totalDeskHours: parseFloat(totalDeskHours.toFixed(2)),
        averageProductivity: parseFloat(overallProductivity.toFixed(2)),
        totalSales: parseFloat(totalSales.toFixed(2)),
        totalOrders: salesData.length,
        salesPerProductiveHour: parseFloat(productivityToSalesRatio.toFixed(2)),
      };

      return res.status(200).json({
        success: true,
        summary,
        timelineData,
      });
    } catch (error) {
      console.error("Error fetching agent productivity:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent productivity",
        error: error.message,
      });
    }
  },

  /**
   * Get performance and target achievement data for a sales agent
   */
  getAgentPerformance: async (req, res) => {
    try {
      const { agentId } = req.params;
      const { year, month } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Default to current year and month if not specified
      const currentDate = new Date();
      const targetYear = year ? parseInt(year) : currentDate.getFullYear();
      const targetMonth = month
        ? month
        : currentDate.toLocaleString("default", { month: "short" });

      // Find target for the specified period
      const targetEntry = agent.targetHistory.find(
        (entry) => entry.year === targetYear && entry.month === targetMonth
      );

      // Find sales history for the specified period
      const salesEntry = agent.salesHistory.find(
        (entry) => entry.year === targetYear && entry.month === targetMonth
      );

      // Get yearly performance
      const yearlyPerformance = agent.targetHistory
        .filter((entry) => entry.year === targetYear)
        .sort((a, b) => {
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

      // Get current period target progress
      const currentTargetProgress = await getAgentCurrentTargetProgress(agent);

      return res.status(200).json({
        success: true,
        agent: {
          id: agent._id,
          name: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
          target: agent.target || 0,
          targetAchieved: agent.targetAchieved || 0,
          overallProgress:
            agent.target > 0 ? (agent.targetAchieved / agent.target) * 100 : 0,
        },
        currentPeriod: {
          year: targetYear,
          month: targetMonth,
          target: targetEntry?.target || 0,
          achieved: targetEntry?.achieved || 0,
          achievementRate: targetEntry?.achievementRate || 0,
          orderCount: salesEntry?.orderCount || 0,
        },
        currentTarget: currentTargetProgress,
        yearlyPerformance: yearlyPerformance.map((entry) => ({
          month: entry.month,
          target: entry.target,
          achieved: entry.achieved,
          achievementRate: entry.achievementRate,
        })),
      });
    } catch (error) {
      console.error("Error fetching agent performance:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent performance",
        error: error.message,
      });
    }
  },

  /**
   * Get customer journey metrics for customers assigned to a sales agent
   */
  getAgentCustomerJourneys: async (req, res) => {
    try {
      const { agentId } = req.params;
      const { limit = 5, metric = "totalSpent" } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Get customers assigned to this agent
      const customers = await Customer.find({ assignedTo: agentId }).lean();
      const customerIds = customers.map((c) => c.CardCode);

      if (customerIds.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No customers assigned to this agent",
          data: [],
        });
      }

      // Get top customers based on selected metric
      let topCustomers = [];

      if (metric === "totalSpent" || metric === "invoiceCount") {
        // For spend or order count metrics, get from orders
        const aggregationField = metric === "totalSpent" ? "$DocTotal" : 1;

        const result = await Invoice.aggregate([
          {
            $match: {
              CardCode: { $in: customerCodes },
            },
          },
          {
            $group: {
              _id: "$CardCode",
              totalSpent: { $sum: "$DocTotal" },
              invoiceCount: { $sum: 1 },
              lastOrderDate: { $max: "$DocDate" },
            },
          },
          {
            $sort:
              metric === "totalSpent"
                ? { totalSpent: -1 }
                : { invoiceCount: -1 },
          },
          { $limit: parseInt(limit) },
        ]);

        // Match with customer details
        const customerMap = {};
        customers.forEach((c) => {
          customerMap[c.CardCode] = c;
        });

        topCustomers = result.map((r) => ({
          cardCode: r._id,
          cardName: customerMap[r._id]?.CardName || r._id,
          totalSpent: r.totalSpent,
          invoiceCount: r.invoiceCount,
          lastOrderDate: r.lastOrderDate,
          email: customerMap[r._id]?.Email,
          phone: customerMap[r._id]?.Phone1,
        }));
      } else if (metric === "recentActivity") {
        // For recent activity, sort by last order date
        const result = await SalesOrder.aggregate([
          {
            $match: {
              CardCode: { $in: customerIds },
              salesAgent: mongoose.Types.ObjectId(agentId),
            },
          },
          {
            $group: {
              _id: "$CardCode",
              totalSpent: { $sum: "$DocTotal" },
              invoiceCount: { $sum: 1 },
              lastOrderDate: { $max: "$DocDate" },
            },
          },
          { $sort: { lastOrderDate: -1 } },
          { $limit: parseInt(limit) },
        ]);

        // Match with customer details
        const customerMap = {};
        customers.forEach((c) => {
          customerMap[c.CardCode] = c;
        });

        topCustomers = result.map((r) => ({
          cardCode: r._id,
          cardName: customerMap[r._id]?.CardName || r._id,
          totalSpent: r.totalSpent,
          invoiceCount: r.invoiceCount,
          lastOrderDate: r.lastOrderDate,
          email: customerMap[r._id]?.Email,
          phone: customerMap[r._id]?.Phone1,
        }));
      } else if (metric === "paymentBehavior") {
        // For payment behavior, we need more complex analysis
        // This would need to be implemented with your specific payment tracking logic
        // Placeholder implementation:
        const result = await SalesOrder.aggregate([
          {
            $match: {
              CardCode: { $in: customerIds },
              salesAgent: mongoose.Types.ObjectId(agentId),
            },
          },
          {
            $group: {
              _id: "$CardCode",
              totalSpent: { $sum: "$DocTotal" },
              invoiceCount: { $sum: 1 },
            },
          },
          { $sort: { totalSpent: -1 } },
          { $limit: parseInt(limit) },
        ]);

        // Match with customer details
        const customerMap = {};
        customers.forEach((c) => {
          customerMap[c.CardCode] = c;
        });

        topCustomers = result.map((r) => ({
          cardCode: r._id,
          cardName: customerMap[r._id]?.CardName || r._id,
          totalSpent: r.totalSpent,
          invoiceCount: r.invoiceCount,
          // Placeholder payment metrics
          onTimePaymentRate: Math.random() * 100, // Replace with actual calculation
          averagePaymentDays: Math.floor(Math.random() * 30), // Replace with actual calculation
        }));
      }

      return res.status(200).json({
        success: true,
        metric,
        data: topCustomers,
      });
    } catch (error) {
      console.error("Error fetching agent customer journeys:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent customer journeys",
        error: error.message,
      });
    }
  },
  /**
   * Get all invoices for a sales agent
   */
  // Updated getAgentInvoices method with debugging and fixes

  getAgentInvoices: async (req, res) => {
    try {
      const { agentId } = req.params;
      const {
        page = 1,
        limit = 10,
        startDate,
        endDate,
        status,
        customerCode,
        sortBy = "DocDate",
        sortDirection = -1,
      } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Set default date range if not provided (last 30 days)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      // *** FIX: Get customers assigned to this agent first ***
      const customers = await Customer.find({ assignedTo: agentId }).lean();
      const customerCodes = customers.map((c) => c.CardCode);
      if (customerCodes.length === 0) {
        return res.status(200).json({
          success: true,
          count: 0,
          total: 0,
          page: parseInt(page),
          pages: 0,
          stats: {
            totalInvoices: 0,
            totalAmount: 0,
            averageInvoiceValue: 0,
            verifiedInvoices: 0,
            verificationRate: 0,
            paymentMethods: [],
          },
          data: [],
        });
      }

      // Build query using customer codes (consistent with dashboard)
      const query = {
        CardCode: { $in: customerCodes },
        DocDate: { $gte: start, $lte: end },
      };

      // Add additional filters
      if (status) {
        query.DocumentStatus = status;
      }

      if (customerCode) {
        query.CardCode = customerCode;
      }

      // Pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Execute main query
      const invoices = await Invoice.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ [sortBy]: parseInt(sortDirection) });

      // Get total count for pagination
      const total = await Invoice.countDocuments(query);

      // Calculate invoice statistics manually for consistency
      let totalAmount = 0;
      let totalAmountNoVat = 0;
      let totalVerified = 0;

      // Get all invoices for stats calculation (not just current page)
      const allInvoicesForStats = await Invoice.find(query);

      allInvoicesForStats.forEach((inv) => {
        totalAmount += inv.DocTotal || 0;
        totalAmountNoVat += (inv.DocTotal || 0) - (inv.VatSum || 0);
        if (inv.verified) totalVerified++;
      });

      const avgAmount = total > 0 ? totalAmount / total : 0;
      const avgAmountNoVat = total > 0 ? totalAmountNoVat / total : 0;

      // Group by payment method
      const paymentMethods = {};
      allInvoicesForStats.forEach((inv) => {
        const method = inv.paymentMethod || "Unknown";
        if (!paymentMethods[method]) {
          paymentMethods[method] = { count: 0, total: 0 };
        }
        paymentMethods[method].count++;
        paymentMethods[method].total += inv.DocTotal || 0;
      });

      const paymentMethodStats = Object.keys(paymentMethods)
        .map((method) => ({
          _id: method,
          count: paymentMethods[method].count,
          total: paymentMethods[method].total,
        }))
        .sort((a, b) => b.count - a.count);

      const stats = {
        totalInvoices: total,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        totalAmountNoVat: parseFloat(totalAmountNoVat.toFixed(2)),
        averageInvoiceValue: parseFloat(avgAmount.toFixed(2)),
        averageInvoiceValueNoVat: parseFloat(avgAmountNoVat.toFixed(2)),
        verifiedInvoices: totalVerified,
        verificationRate:
          total > 0
            ? parseFloat(((totalVerified / total) * 100).toFixed(2))
            : 0,
        paymentMethods: paymentMethodStats,
      };

      return res.status(200).json({
        success: true,
        count: invoices.length,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        stats: stats,
        data: invoices,
      });
    } catch (error) {
      console.error("Error fetching agent invoices:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent invoices",
        error: error.message,
      });
    }
  },
  /**
   * Get combined orders and invoices analytics
   */
  getOrdersInvoicesAnalytics: async (req, res) => {
    try {
      const { agentId } = req.params;
      const { startDate, endDate } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Set default date range if not provided (last 30 days)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      const customers = await Customer.find({ assignedTo: agentId }).lean();
      const customerCodes = customers.map((c) => c.CardCode);
      if (customerCodes.length === 0) {
        return res.status(200).json({
          success: true,
          summary: {
            orders: { count: 0, total: 0, average: 0, min: 0, max: 0 },
            invoices: {
              count: 0,
              total: 0,
              totalNoVat: 0,
              average: 0,
              averageNoVat: 0,
              min: 0,
              max: 0,
            },
            conversion: { rate: 0, totalOrders: 0, convertedOrders: 0 },
          },
          topCustomers: [],
          monthlyData: [],
          dateRange: { start, end },
        });
      }

      // Query base using assigned customers
      const ordersQuery = {
        CardCode: { $in: customerCodes },
        DocDate: { $gte: start, $lte: end },
      };

      const invoicesQuery = {
        CardCode: { $in: customerCodes },
        DocDate: { $gte: start, $lte: end },
      };

      // Execute analytics queries in parallel
      const [
        orderStats,
        invoiceStats,
        topCustomers,
        monthlyOrders,
        monthlyInvoices,
        conversionStats,
      ] = await Promise.all([
        // Orders summary
        SalesOrder.aggregate([
          { $match: ordersQuery },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              total: { $sum: "$DocTotal" },
              average: { $avg: "$DocTotal" },
              min: { $min: "$DocTotal" },
              max: { $max: "$DocTotal" },
            },
          },
        ]),

        // Invoices summary
        Invoice.aggregate([
          { $match: invoicesQuery },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              total: { $sum: "$DocTotal" },
              totalNoVat: { $sum: { $subtract: ["$DocTotal", "$VatSum"] } },
              average: { $avg: "$DocTotal" },
              averageNoVat: { $avg: "$TotalBeforeVat" },
              min: { $min: "$DocTotal" },
              max: { $max: "$DocTotal" },
            },
          },
        ]),

        // Top customers by order and invoice value
        SalesOrder.aggregate([
          { $match: ordersQuery },
          {
            $group: {
              _id: "$CardCode",
              customerName: { $first: "$CardName" },
              orderCount: { $sum: 1 },
              orderTotal: { $sum: "$DocTotal" },
              lastOrderDate: { $max: "$DocDate" },
            },
          },
          { $sort: { orderTotal: -1 } },
          { $limit: 5 },
        ]),

        // Monthly orders trend
        SalesOrder.aggregate([
          { $match: ordersQuery },
          {
            $group: {
              _id: {
                year: { $year: "$DocDate" },
                month: { $month: "$DocDate" },
              },
              count: { $sum: 1 },
              total: { $sum: "$DocTotal" },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
        ]),

        // Monthly invoices trend
        Invoice.aggregate([
          { $match: invoicesQuery },
          {
            $group: {
              _id: {
                year: { $year: "$DocDate" },
                month: { $month: "$DocDate" },
              },
              count: { $sum: 1 },
              total: { $sum: "$DocTotal" },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
        ]),

        // Order to Invoice conversion rate (placeholder - customize based on your data structure)
        // This assumes each order would ideally be converted to an invoice
        SalesOrder.aggregate([
          { $match: ordersQuery },
          {
            $lookup: {
              from: "invoices",
              let: { orderDocEntry: "$DocEntry" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$BaseEntry", "$$orderDocEntry"] },
                        { $eq: ["$BaseType", 17] }, // Assuming 17 is the code for Sales Orders
                      ],
                    },
                  },
                },
              ],
              as: "matchedInvoices",
            },
          },
          {
            $project: {
              _id: 1,
              DocEntry: 1,
              DocNum: 1,
              CardCode: 1,
              CardName: 1,
              DocDate: 1,
              DocTotal: 1,
              hasInvoice: {
                $cond: [
                  { $gt: [{ $size: "$matchedInvoices" }, 0] },
                  true,
                  false,
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              convertedOrders: { $sum: { $cond: ["$hasInvoice", 1, 0] } },
            },
          },
        ]),
      ]);

      // Process monthly trends to fill gaps and format for charts
      const monthlyData = processMonthlyData(
        monthlyOrders,
        monthlyInvoices,
        start,
        end
      );

      return res.status(200).json({
        success: true,
        summary: {
          orders: {
            count: orderStats.length > 0 ? orderStats[0].count : 0,
            total: orderStats.length > 0 ? orderStats[0].total : 0,
            average: orderStats.length > 0 ? orderStats[0].average : 0,
            min: orderStats.length > 0 ? orderStats[0].min : 0,
            max: orderStats.length > 0 ? orderStats[0].max : 0,
          },
          invoices: {
            count: invoiceStats.length > 0 ? invoiceStats[0].count : 0,
            total: invoiceStats.length > 0 ? invoiceStats[0].total : 0,
            totalNoVat:
              invoiceStats.length > 0 ? invoiceStats[0].totalNoVat : 0,
            average: invoiceStats.length > 0 ? invoiceStats[0].average : 0,
            averageNoVat:
              invoiceStats.length > 0 ? invoiceStats[0].averageNoVat : 0,
            min: invoiceStats.length > 0 ? invoiceStats[0].min : 0,
            max: invoiceStats.length > 0 ? invoiceStats[0].max : 0,
          },
          conversion: {
            rate:
              conversionStats.length > 0 && conversionStats[0].totalOrders > 0
                ? (conversionStats[0].convertedOrders /
                    conversionStats[0].totalOrders) *
                  100
                : 0,
            totalOrders:
              conversionStats.length > 0 ? conversionStats[0].totalOrders : 0,
            convertedOrders:
              conversionStats.length > 0
                ? conversionStats[0].convertedOrders
                : 0,
          },
        },
        topCustomers,
        monthlyData,
        dateRange: {
          start,
          end,
        },
      });
    } catch (error) {
      console.error("Error fetching orders and invoices analytics:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching orders and invoices analytics",
        error: error.message,
      });
    }
  },

  // Add this new method to salesAgentJourneyController object
  getAgentAttendance: async (req, res) => {
    try {
      const { agentId } = req.params;
      const { startDate, endDate } = req.query;

      // Validate sales agent
      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "sales_agent") {
        return res.status(404).json({
          success: false,
          message: "Sales agent not found",
        });
      }

      // Set default date range if not provided (last 30 days)
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get productivity data
      const desktimeRecords = await DeskTime.find({
        email: agent.email,
        date: { $gte: start, $lte: end },
      }).sort({ date: 1 });

      // Calculate attendance metrics
      let totalWorkingDays = 0;
      let totalHalfDays = 0;
      let totalFullDays = 0;
      let totalAbsentDays = 0;
      let totalHoursWorked = 0;

      const attendanceDetails = [];

      // Get all working days (Monday to Friday) in the date range
      const workingDays = [];
      const current = new Date(start);
      while (current <= end) {
        const dayOfWeek = current.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          // Monday to Friday
          workingDays.push(new Date(current));
          totalWorkingDays++;
        }
        current.setDate(current.getDate() + 1);
      }

      // Create a map of desktime records by date
      const desktimeMap = {};
      desktimeRecords.forEach((record) => {
        const dateKey = record.date.toISOString().split("T")[0];
        desktimeMap[dateKey] = record;
      });

      // Process each working day
      workingDays.forEach((workingDay) => {
        const dateKey = workingDay.toISOString().split("T")[0];
        const desktimeRecord = desktimeMap[dateKey];

        const hoursWorked = desktimeRecord
          ? desktimeRecord.totalDeskTimeHours || 0
          : 0;
        totalHoursWorked += hoursWorked;

        let attendanceStatus = "absent";
        let attendanceType = "Absent";

        if (hoursWorked >= 7) {
          attendanceStatus = "full_day";
          attendanceType = "Full Day";
          totalFullDays++;
        } else if (hoursWorked >= 4) {
          attendanceStatus = "half_day";
          attendanceType = "Half Day";
          totalHalfDays++;
        } else {
          totalAbsentDays++;
        }

        attendanceDetails.push({
          date: dateKey,
          dayName: workingDay.toLocaleDateString("en-US", { weekday: "long" }),
          hoursWorked: parseFloat(hoursWorked.toFixed(2)),
          productiveHours: desktimeRecord
            ? desktimeRecord.productiveTimeHours || 0
            : 0,
          attendanceStatus,
          attendanceType,
          productivityRate:
            desktimeRecord && hoursWorked > 0
              ? ((desktimeRecord.productiveTimeHours || 0) / hoursWorked) * 100
              : 0,
        });
      });

      // Calculate attendance rates
      const attendanceRate =
        totalWorkingDays > 0
          ? ((totalFullDays + totalHalfDays) / totalWorkingDays) * 100
          : 0;

      const fullDayRate =
        totalWorkingDays > 0 ? (totalFullDays / totalWorkingDays) * 100 : 0;

      const averageHoursPerDay =
        totalWorkingDays > 0 ? totalHoursWorked / totalWorkingDays : 0;

      return res.status(200).json({
        success: true,
        agent: {
          id: agent._id,
          name: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
        },
        summary: {
          totalWorkingDays,
          totalFullDays,
          totalHalfDays,
          totalAbsentDays,
          totalHoursWorked: parseFloat(totalHoursWorked.toFixed(2)),
          attendanceRate: parseFloat(attendanceRate.toFixed(2)),
          fullDayRate: parseFloat(fullDayRate.toFixed(2)),
          averageHoursPerDay: parseFloat(averageHoursPerDay.toFixed(2)),
        },
        attendanceDetails: attendanceDetails.sort((a, b) =>
          b.date.localeCompare(a.date)
        ),
        dateRange: { start, end },
      });
    } catch (error) {
      console.error("Error fetching agent attendance:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching agent attendance",
        error: error.message,
      });
    }
  },
};

function processMonthlyData(orderData, invoiceData, startDate, endDate) {
  // Create a map of months
  const monthlyMap = {};

  // Fill in all months in the date range
  const start = new Date(startDate);
  const end = new Date(endDate);

  let current = new Date(start);
  current.setDate(1); // Start at the beginning of the month

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1; // JavaScript months are 0-based

    const key = `${year}-${month}`;
    const monthName = current.toLocaleString("default", { month: "short" });

    monthlyMap[key] = {
      date: `${monthName} ${year}`,
      year,
      month,
      orders: {
        count: 0,
        total: 0,
      },
      invoices: {
        count: 0,
        total: 0,
      },
    };

    // Move to next month
    current.setMonth(current.getMonth() + 1);
  }

  // Fill in order data
  orderData.forEach((item) => {
    const key = `${item._id.year}-${item._id.month}`;
    if (monthlyMap[key]) {
      monthlyMap[key].orders.count = item.count;
      monthlyMap[key].orders.total = item.total;
    }
  });

  // Fill in invoice data
  invoiceData.forEach((item) => {
    const key = `${item._id.year}-${item._id.month}`;
    if (monthlyMap[key]) {
      monthlyMap[key].invoices.count = item.count;
      monthlyMap[key].invoices.total = item.total;
    }
  });

  // Convert to array and sort by date
  return Object.values(monthlyMap).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
}

/**
 * Helper function to get agent's current period target progress
 */
async function getAgentCurrentTargetProgress(agent) {
  try {
    // Get current month and year
    const now = new Date();
    const currentMonth = now.toLocaleString("default", { month: "short" });
    const currentYear = now.getFullYear();

    // Find target entry for current period
    const targetEntry = agent.targetHistory
      ? agent.targetHistory.find(
          (entry) => entry.year === currentYear && entry.month === currentMonth
        )
      : null;

    if (!targetEntry) {
      return {
        period: `${currentMonth} ${currentYear}`,
        target: agent.target || 0,
        achieved: 0,
        progressPercent: 0,
        remainingAmount: agent.target || 0,
        daysInMonth: new Date(currentYear, now.getMonth() + 1, 0).getDate(),
        daysPassed: now.getDate(),
        daysRemaining:
          new Date(currentYear, now.getMonth() + 1, 0).getDate() -
          now.getDate(),
        expectedProgress:
          (now.getDate() /
            new Date(currentYear, now.getMonth() + 1, 0).getDate()) *
          100,
      };
    }

    // Calculate days information
    const daysInMonth = new Date(currentYear, now.getMonth() + 1, 0).getDate();
    const daysPassed = now.getDate();
    const daysRemaining = daysInMonth - daysPassed;

    // Calculate expected progress based on days passed
    const expectedProgress = (daysPassed / daysInMonth) * 100;

    return {
      period: `${currentMonth} ${currentYear}`,
      target: targetEntry.target,
      achieved: targetEntry.achieved,
      progressPercent: targetEntry.achievementRate,
      remainingAmount: targetEntry.target - targetEntry.achieved,
      daysInMonth,
      daysPassed,
      daysRemaining,
      expectedProgress,
      isAhead: targetEntry.achievementRate > expectedProgress,
      isBehind: targetEntry.achievementRate < expectedProgress,
    };
  } catch (error) {
    console.error("Error calculating agent target progress:", error);
    return {
      period: "Current Month",
      target: agent.target || 0,
      achieved: 0,
      progressPercent: 0,
      remainingAmount: agent.target || 0,
    };
  }
}

/**
 * Calculate time-based trends for an agent
 */
async function calculateAgentTrends(agentId, agent, startDate, endDate) {
  try {
    // Date processing helpers
    const getDayKey = (date) => date.toISOString().split("T")[0];
    const getWeekKey = (date) => {
      const d = new Date(date);
      d.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
      return d.toISOString().split("T")[0];
    };

    // Initialize data structure
    const dailyData = {};
    const weeklyData = {};

    // Create date range for all days
    const dayMS = 24 * 60 * 60 * 1000;
    for (
      let d = new Date(startDate);
      d <= endDate;
      d = new Date(d.getTime() + dayMS)
    ) {
      const dayKey = getDayKey(d);
      const weekKey = getWeekKey(d);

      dailyData[dayKey] = {
        date: dayKey,
        sales: 0,
        orders: 0,
        calls: 0,
        productivity: 0,
        deskHours: 0,
      };

      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = {
          week: weekKey,
          sales: 0,
          orders: 0,
          calls: 0,
          productivity: 0,
          deskHours: 0,
          productiveHours: 0,
          days: 0,
        };
      }
    }

    // Fetch data for trends
    const [assignedCustomers, callData, productivityData] = await Promise.all([
      // Get assigned customers
      Customer.find({ assignedTo: agentId }).lean(),

      // Get call data - Updated with better agent matching
      CallData.find({
        startTime: { $gte: startDate, $lte: endDate },
        $or: [
          { userName: `${agent.firstName} ${agent.lastName}` },
          { userName: agent.email },
          ...(agent.phone
            ? [{ fromNumber: agent.phone }, { toNumber: agent.phone }]
            : []),
        ],
      }).lean(),

      // Get productivity data
      DeskTime.find({
        email: agent.email,
        date: { $gte: startDate, $lte: endDate },
      }).lean(),
    ]);

    const customerCodes = assignedCustomers.map((c) => c.CardCode);

    // *** UPDATED: Use customer-based invoice fetching logic ***
    const invoices =
      customerCodes.length > 0
        ? await Invoice.find({
            CardCode: { $in: customerCodes },
            DocDate: { $gte: startDate, $lte: endDate },
          }).lean()
        : [];

    // Process invoices
    invoices.forEach((invoice) => {
      const date = new Date(invoice.DocDate);
      const dayKey = getDayKey(date);
      const weekKey = getWeekKey(date);

      if (dailyData[dayKey]) {
        dailyData[dayKey].sales += invoice.DocTotal || 0;
        dailyData[dayKey].orders += 1;
      }

      if (weeklyData[weekKey]) {
        weeklyData[weekKey].sales += invoice.DocTotal || 0;
        weeklyData[weekKey].orders += 1;
      }
    });

    // Process call data
    callData.forEach((call) => {
      const date = new Date(call.startTime);
      const dayKey = getDayKey(date);
      const weekKey = getWeekKey(date);

      if (dailyData[dayKey]) {
        dailyData[dayKey].calls += 1;
      }

      if (weeklyData[weekKey]) {
        weeklyData[weekKey].calls += 1;
      }
    });

    // Process productivity data
    productivityData.forEach((record) => {
      const date = record.date;
      const dayKey = getDayKey(date);
      const weekKey = getWeekKey(date);

      if (dailyData[dayKey]) {
        dailyData[dayKey].deskHours = record.totalDeskTimeHours || 0;
        dailyData[dayKey].productivity = record.productivityRatio || 0;
      }

      if (weeklyData[weekKey]) {
        weeklyData[weekKey].deskHours += record.totalDeskTimeHours || 0;
        weeklyData[weekKey].productiveHours += record.productiveTimeHours || 0;
        weeklyData[weekKey].days += 1;
      }
    });

    // Calculate weekly productivity percentage
    Object.values(weeklyData).forEach((week) => {
      if (week.deskHours > 0) {
        week.productivity = (week.productiveHours / week.deskHours) * 100;
      }

      // Format numbers for consistency
      week.productivity = parseFloat(week.productivity.toFixed(2));
      week.sales = parseFloat(week.sales.toFixed(2));
      week.deskHours = parseFloat(week.deskHours.toFixed(2));
      week.productiveHours = parseFloat(week.productiveHours.toFixed(2));
    });

    // Convert to arrays and sort by date
    const dailyTrends = Object.values(dailyData).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const weeklyTrends = Object.values(weeklyData).sort((a, b) =>
      a.week.localeCompare(b.week)
    );

    return {
      daily: dailyTrends,
      weekly: weeklyTrends,
    };
  } catch (error) {
    console.error("Error calculating agent trends:", error);
    return {
      daily: [],
      weekly: [],
    };
  }
}

/**
 * Get top performing customers for an agent
 */
async function getTopCustomers(agentId, startDate, endDate) {
  try {
    // Get customers assigned to this agent
    const assignedCustomers = await Customer.find({
      assignedTo: agentId,
    }).lean();
    const customerCodes = assignedCustomers.map((c) => c.CardCode);

    if (customerCodes.length === 0) {
      return {
        topByRevenue: [],
        topByFrequency: [],
        recentCustomers: [],
      };
    }

    // *** UPDATED: Use invoices for customer performance metrics ***
    const [topByRevenue, topByFrequency, recentCustomers] = await Promise.all([
      // Get top customers by invoice amount
      Invoice.aggregate([
        {
          $match: {
            CardCode: { $in: customerCodes },
            DocDate: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: "$CardCode",
            totalSpent: { $sum: "$DocTotal" },
            invoiceCount: { $sum: 1 },
            lastInvoiceDate: { $max: "$DocDate" },
            customerName: { $first: "$CardName" },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 5 },
      ]),

      // Get top customers by invoice frequency
      Invoice.aggregate([
        {
          $match: {
            CardCode: { $in: customerCodes },
            DocDate: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: "$CardCode",
            totalSpent: { $sum: "$DocTotal" },
            invoiceCount: { $sum: 1 },
            lastInvoiceDate: { $max: "$DocDate" },
            customerName: { $first: "$CardName" },
          },
        },
        { $sort: { invoiceCount: -1 } },
        { $limit: 5 },
      ]),

      // Get most recent customer invoices
      Invoice.aggregate([
        {
          $match: {
            CardCode: { $in: customerCodes },
            DocDate: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: "$CardCode",
            totalSpent: { $sum: "$DocTotal" },
            invoiceCount: { $sum: 1 },
            lastInvoiceDate: { $max: "$DocDate" },
            customerName: { $first: "$CardName" },
          },
        },
        { $sort: { lastInvoiceDate: -1 } },
        { $limit: 5 },
      ]),
    ]);

    return {
      topByRevenue: topByRevenue.map((c) => ({
        cardCode: c._id,
        cardName: c.customerName || c._id,
        totalSpent: parseFloat(c.totalSpent.toFixed(2)),
        orderCount: c.invoiceCount,
        lastOrderDate: c.lastInvoiceDate,
      })),
      topByFrequency: topByFrequency.map((c) => ({
        cardCode: c._id,
        cardName: c.customerName || c._id,
        totalSpent: parseFloat(c.totalSpent.toFixed(2)),
        orderCount: c.invoiceCount,
        lastOrderDate: c.lastInvoiceDate,
      })),
      recentCustomers: recentCustomers.map((c) => ({
        cardCode: c._id,
        cardName: c.customerName || c._id,
        totalSpent: parseFloat(c.totalSpent.toFixed(2)),
        orderCount: c.invoiceCount,
        lastOrderDate: c.lastInvoiceDate,
      })),
    };
  } catch (error) {
    console.error("Error getting top customers:", error);
    return {
      topByRevenue: [],
      topByFrequency: [],
      recentCustomers: [],
    };
  }
}

/**
 * Get recent sales activities for an agent
 */
async function getRecentActivities(agentId, agent, startDate, endDate) {
  try {
    // Get assigned customers first
    const assignedCustomers = await Customer.find({
      assignedTo: agentId,
    }).lean();
    const customerCodes = assignedCustomers.map((c) => c.CardCode);

    // Get recent sales orders and invoices for assigned customers
    const [recentOrders, recentInvoices, recentCalls] = await Promise.all([
      // Recent sales orders for assigned customers
      customerCodes.length > 0
        ? SalesOrder.find({
            CardCode: { $in: customerCodes },
            DocDate: { $gte: startDate, $lte: endDate },
          })
            .sort({ DocDate: -1 })
            .limit(5)
            .lean()
        : [],

      // Recent invoices for assigned customers
      customerCodes.length > 0
        ? Invoice.find({
            CardCode: { $in: customerCodes },
            DocDate: { $gte: startDate, $lte: endDate },
          })
            .sort({ DocDate: -1 })
            .limit(5)
            .lean()
        : [],

      // Recent calls with updated agent matching
      CallData.find({
        startTime: { $gte: startDate, $lte: endDate },
        $or: [
          { userName: `${agent.firstName} ${agent.lastName}` },
          { userName: agent.email },
          ...(agent.phone
            ? [{ fromNumber: agent.phone }, { toNumber: agent.phone }]
            : []),
        ],
      })
        .sort({ startTime: -1 })
        .limit(5)
        .lean(),
    ]);

    // Combine and sort activities
    const activities = [
      ...recentOrders.map((order) => ({
        type: "order",
        date: order.DocDate,
        title: `Created sales order #${order.DocNum}`,
        customer: order.CardName,
        customerCode: order.CardCode,
        amount: order.DocTotal,
        status: order.DocumentStatus,
        details: {
          docEntry: order.DocEntry,
          docTotal: order.DocTotal,
          syncStatus: order.SyncedWithSAP ? "Synced with SAP" : "Not synced",
        },
      })),

      ...recentInvoices.map((invoice) => ({
        type: "invoice",
        date: invoice.DocDate,
        title: `Generated invoice #${invoice.DocNum}`,
        customer: invoice.CardName,
        customerCode: invoice.CardCode,
        amount: invoice.DocTotal,
        status: invoice.DocumentStatus,
        details: {
          docEntry: invoice.DocEntry,
          docTotal: invoice.DocTotal,
          verified: invoice.verified,
          paymentMethod: invoice.paymentMethod,
        },
      })),

      ...recentCalls.map((call) => ({
        type: "call",
        date: call.startTime,
        title: `${call.direction === "in" ? "Received" : "Made"} a call ${
          call.missed === "Y" ||
          call.missed === "true" ||
          call.missed === true ||
          call.missed === "1"
            ? "(Missed)"
            : ""
        }`,
        contact: call.contact || call.fromNumber || call.toNumber,
        duration: call.inCallDuration,
        direction: call.direction,
        details: {
          callID: call.callID,
          missed: call.missed,
          fromNumber: call.fromNumber,
          toNumber: call.toNumber,
          note: call.note,
        },
      })),
    ];

    // Sort by date (newest first)
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));

    return activities.slice(0, 20); // Return max 20 activities
  } catch (error) {
    console.error("Error getting recent activities:", error);
    return [];
  }
}

module.exports = salesAgentJourneyController;
