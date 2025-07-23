// controllers/customerTargetController.js
const CustomerTarget = require("../models/CustomerTarget");
const User = require("../models/User");
const SalesOrder = require("../models/SalesOrder");

const calculateTargetAchievement = async (target) => {
  try {
    const Invoice = require("../models/Invoice");

    // Find all invoices for this customer within the target period
    let dateQuery = {};

    // Handle both new period-based targets and legacy deadline-based targets
    if (target.currentPeriodStart && target.currentPeriodEnd) {
      dateQuery = {
        $gte: target.currentPeriodStart,
        $lte: target.currentPeriodEnd,
      };
    } else if (target.deadline) {
      // For legacy targets, calculate from start of current month/quarter/year to deadline
      const deadline = new Date(target.deadline);
      let periodStart;

      if (target.period === "monthly") {
        periodStart = new Date(deadline.getFullYear(), deadline.getMonth(), 1);
      } else if (target.period === "quarterly") {
        const quarter = Math.floor(deadline.getMonth() / 3);
        periodStart = new Date(deadline.getFullYear(), quarter * 3, 1);
      } else if (target.period === "yearly") {
        periodStart = new Date(deadline.getFullYear(), 0, 1);
      } else {
        // Default to 30 days before deadline
        periodStart = new Date(deadline);
        periodStart.setDate(periodStart.getDate() - 30);
      }

      dateQuery = {
        $gte: periodStart,
        $lte: deadline,
      };
    } else {
      // Fallback: current month
      const now = new Date();
      dateQuery = {
        $gte: new Date(now.getFullYear(), now.getMonth(), 1),
        $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      };
    }

    // Get invoices for this customer in the target period
    const invoices = await Invoice.find({
      CardCode: target.cardCode,
      DocDate: dateQuery,
    });

    // Calculate total achieved amount WITHOUT VAT
    const achievedAmount = invoices.reduce((sum, invoice) => {
      // Calculate amount without VAT
      // Method 1: Use DocTotal - VatSum if VatSum is available
      if (invoice.VatSum && invoice.VatSum > 0) {
        return sum + (invoice.DocTotal - invoice.VatSum);
      }

      // Method 2: If VatPercent is available, calculate net amount
      if (invoice.VatPercent && invoice.VatPercent > 0) {
        const vatMultiplier = 1 + invoice.VatPercent / 100;
        return sum + invoice.DocTotal / vatMultiplier;
      }

      // Method 3: Calculate from DocumentLines (most accurate)
      if (invoice.DocumentLines && invoice.DocumentLines.length > 0) {
        const lineTotal = invoice.DocumentLines.reduce((lineSum, line) => {
          // Use Price * Quantity for net amount (before VAT)
          return lineSum + (line.Quantity || 0) * (line.Price || 0);
        }, 0);
        return sum + lineTotal;
      }

      // Fallback: Assume DocTotal includes VAT, estimate 20% VAT rate if no VAT info available
      // You can adjust this default VAT rate based on your region
      const defaultVatRate = 0.2; // 20% VAT
      const estimatedNetAmount = invoice.DocTotal / (1 + defaultVatRate);
      return sum + estimatedNetAmount;
    }, 0);

    const achievementRate =
      target.targetAmount > 0
        ? (achievedAmount / target.targetAmount) * 100
        : 0;

    console.log(
      `Target ${target._id}: Calculated achievement ${achievedAmount} (excl. VAT) from ${invoices.length} invoices`
    );

    return {
      achievedAmount: parseFloat(achievedAmount.toFixed(2)),
      achievementRate: parseFloat(achievementRate.toFixed(2)),
      invoiceCount: invoices.length,
    };
  } catch (error) {
    console.error("Error calculating target achievement:", error);
    return {
      achievedAmount: 0,
      achievementRate: 0,
      invoiceCount: 0,
    };
  }
};

// Get a single customer target by ID
exports.getCustomerTargetById = async (req, res) => {
  try {
    const targetId = req.params.id;

    console.log("check", targetId);
    const target = await CustomerTarget.findById(targetId)
      .populate("salesAgent", "firstName lastName email")
      .populate("createdBy", "firstName lastName email");

    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Customer target not found",
      });
    }

    // Check permissions
    if (
      req.user.role === "sales_agent" &&
      target.salesAgent._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this target",
      });
    }

    if (
      req.user.role === "sales_manager" &&
      target.salesAgent.manager &&
      target.salesAgent.manager.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this target",
      });
    }

    res.status(200).json({
      success: true,
      data: target,
    });
  } catch (error) {
    console.error("Error fetching customer target:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer target",
      error: error.message,
    });
  }
};

// Delete a customer target
exports.deleteCustomerTarget = async (req, res) => {
  try {
    const targetId = req.params.id;

    // Find target
    const target = await CustomerTarget.findById(targetId);
    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Customer target not found",
      });
    }

    // Only admins can delete targets
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only administrators can delete targets",
      });
    }

    await CustomerTarget.findByIdAndDelete(targetId);

    res.status(200).json({
      success: true,
      message: "Customer target deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting customer target:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting customer target",
      error: error.message,
    });
  }
};

// Get customer targets for a specific agent
exports.getAgentCustomerTargets = async (req, res) => {
  try {
    const agentId = req.params.agentId;

    // Check agent exists
    const agent = await User.findById(agentId);
    if (!agent || agent.role !== "sales_agent") {
      return res.status(404).json({
        success: false,
        message: "Sales agent not found",
      });
    }

    // Permission check
    if (
      req.user.role === "sales_agent" &&
      req.user._id.toString() !== agentId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view other agents' targets",
      });
    }

    // Filter options
    const query = { salesAgent: agentId };

    // Status filter
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Get targets
    const targets = await CustomerTarget.find(query).sort({ deadline: 1 });

    res.status(200).json({
      success: true,
      count: targets.length,
      data: targets,
    });
  } catch (error) {
    console.error("Error fetching agent's customer targets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching agent's customer targets",
      error: error.message,
    });
  }
};

// Get customer targets for a specific customer
exports.getCustomerTargetsByCustomer = async (req, res) => {
  try {
    const { cardCode } = req.params;

    // Base query
    const query = { cardCode };

    // Permission restrictions
    if (req.user.role === "sales_agent") {
      query.salesAgent = req.user._id;
    } else if (req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      query.salesAgent = { $in: agentIds };
    }

    // Get targets
    const targets = await CustomerTarget.find(query)
      .populate("salesAgent", "firstName lastName email")
      .sort({ deadline: 1 });

    res.status(200).json({
      success: true,
      count: targets.length,
      data: targets,
    });
  } catch (error) {
    console.error("Error fetching customer targets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer targets",
      error: error.message,
    });
  }
};

// Helper function to check if a sales agent is managed by a specific user
async function isSalesAgentManagedByUser(agentId, managerId) {
  const agent = await User.findById(agentId);
  return (
    agent && agent.manager && agent.manager.toString() === managerId.toString()
  );
}

// Get dashboard summary of customer targets
exports.getCustomerTargetsDashboard = async (req, res) => {
  try {
    // Base query
    let query = {};

    // Permission-based filtering
    if (req.user.role === "sales_agent") {
      query.salesAgent = req.user._id;
    } else if (req.user.role === "sales_manager") {
      // Get only agents managed by this sales manager
      const agentIds = await User.find({
        manager: req.user._id,
        role: "sales_agent",
      }).distinct("_id");

      if (agentIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            summary: {
              totalTargets: 0,
              activeTargets: 0,
              completedTargets: 0,
              expiredTargets: 0,
              totalTargetAmount: 0,
              totalAchievedAmount: 0,
              overallAchievementRate: 0,
            },
            closeToDeadline: [],
            highestAchieving: [],
            lowestAchieving: [],
          },
        });
      }

      query.salesAgent = { $in: agentIds };
    }
    222;
    if (req.query.salesAgentId) {
      query.salesAgent = req.query.salesAgentId;
    }

    // Get all relevant targets
    const allTargetsRaw = await CustomerTarget.find(query).populate(
      "salesAgent",
      "firstName lastName"
    );

    // Calculate achievements for all targets
    const allTargets = await Promise.all(
      allTargetsRaw.map(async (target) => {
        const achievement = await calculateTargetAchievement(target);
        const targetObj = target.toObject();
        targetObj.achievedAmount = achievement.achievedAmount;
        targetObj.achievementRate = achievement.achievementRate;
        return targetObj;
      })
    );

    // Filter by calculated status
    const activeTargets = allTargets.filter((t) => t.status === "active");
    const completedTargets = allTargets.filter(
      (t) =>
        t.status === "completed" || (t.achievementRate >= 100 && !t.isRecurring)
    );
    const expiredTargets = allTargets.filter((t) => {
      if (t.status === "expired") return true;

      // Check if target is expired based on deadline
      const now = new Date();
      const deadline = t.currentPeriodEnd || t.deadline;
      return deadline && new Date(deadline) < now && t.achievementRate < 100;
    });

    // Calculate total target amount and achieved amount
    const totalTargetAmount = allTargets.reduce(
      (sum, t) => sum + t.targetAmount,
      0
    );
    const totalAchievedAmount = allTargets.reduce(
      (sum, t) => sum + t.achievedAmount,
      0
    );
    const overallAchievementRate =
      totalTargetAmount > 0
        ? (totalAchievedAmount / totalTargetAmount) * 100
        : 0;

    // Get targets close to deadline (within 7 days)
    const now = new Date();
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(now.getDate() + 7);

    const closeToDeadline = activeTargets.filter((t) => {
      const deadline = t.currentPeriodEnd || t.deadline;
      return (
        deadline &&
        new Date(deadline) >= now &&
        new Date(deadline) <= sevenDaysLater
      );
    });

    // Get highest achieving targets
    const highestAchieving = [...allTargets]
      .sort((a, b) => b.achievementRate - a.achievementRate)
      .slice(0, 5);

    // Get lowest achieving active targets
    const lowestAchieving = [...activeTargets]
      .sort((a, b) => a.achievementRate - b.achievementRate)
      .slice(0, 5);

    // Return dashboard data
    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalTargets: allTargets.length,
          activeTargets: activeTargets.length,
          completedTargets: completedTargets.length,
          expiredTargets: expiredTargets.length,
          totalTargetAmount,
          totalAchievedAmount,
          overallAchievementRate: parseFloat(overallAchievementRate.toFixed(2)),
        },
        closeToDeadline: closeToDeadline.map((t) => ({
          id: t._id,
          customer: t.cardName,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          achievementRate: t.achievementRate,
          deadline: t.currentPeriodEnd || t.deadline,
          salesAgent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
        })),
        highestAchieving: highestAchieving.map((t) => ({
          id: t._id,
          customer: t.cardName,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          achievementRate: parseFloat(t.achievementRate.toFixed(2)),
          deadline: t.currentPeriodEnd || t.deadline,
          salesAgent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
          status: t.status,
        })),
        lowestAchieving: lowestAchieving.map((t) => ({
          id: t._id,
          customer: t.cardName,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          achievementRate: parseFloat(t.achievementRate.toFixed(2)),
          deadline: t.currentPeriodEnd || t.deadline,
          salesAgent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
        })),
      },
    });
  } catch (error) {
    console.error("Error generating dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Error generating dashboard",
      error: error.message,
    });
  }
};

// Get sales manager specific dashboard with team performance
exports.getSalesManagerDashboard = async (req, res) => {
  try {
    // Get all agents under this sales manager
    let managedAgentsQuery = { role: "sales_agent", deactivated: false };

    if (req.user.role === "sales_manager") {
      // Sales manager can only see their managed agents
      managedAgentsQuery.manager = req.user._id;
    } else if (req.user.role === "admin") {
      // Admin can see all agents - no additional filter needed
      // managedAgentsQuery remains as { role: "sales_agent" }
    } else {
      // For other roles, return empty result
      managedAgentsQuery._id = null; // This will return no results
    }

    const managedAgents = await User.find({
      role: "sales_agent",
      deactivated: false,
    }).select("firstName lastName email target deactivated");

    if (managedAgents.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          summary: {
            totalAgents: 0,
            totalTargets: 0,
            activeTargets: 0,
            completedTargets: 0,
            totalTargetAmount: 0,
            totalAchievedAmount: 0,
            overallAchievementRate: 0,
          },
          agentPerformance: [],
          teamTargets: [],
          recentActivity: [],
        },
      });
    }

    const agentIds = managedAgents.map((agent) => agent._id);

    // Get all targets for managed agents
    const allTargets = await CustomerTarget.find({
      salesAgent: { $in: agentIds },
    }).populate("salesAgent", "firstName lastName email");

    // Calculate achievements for all targets
    const targetsWithAchievements = await Promise.all(
      allTargets.map(async (target) => {
        const achievement = await calculateTargetAchievement(target);
        const targetObj = target.toObject();
        targetObj.achievedAmount = achievement.achievedAmount;
        targetObj.achievementRate = achievement.achievementRate;
        targetObj.invoiceCount = achievement.invoiceCount;
        return targetObj;
      })
    );

    // Calculate team performance by agent
    const agentPerformance = managedAgents.map((agent) => {
      const agentTargets = targetsWithAchievements.filter(
        (t) => t.salesAgent._id.toString() === agent._id.toString()
      );

      const activeTargets = agentTargets.filter((t) => t.status === "active");
      const completedTargets = agentTargets.filter(
        (t) =>
          t.status === "completed" ||
          (t.achievementRate >= 100 && !t.isRecurring)
      );

      const totalTargetAmount = agentTargets.reduce(
        (sum, t) => sum + t.targetAmount,
        0
      );
      const totalAchievedAmount = agentTargets.reduce(
        (sum, t) => sum + t.achievedAmount,
        0
      );
      const achievementRate =
        totalTargetAmount > 0
          ? (totalAchievedAmount / totalTargetAmount) * 100
          : 0;

      // Get targets close to deadline (within 7 days)
      const now = new Date();
      const sevenDaysLater = new Date(now);
      sevenDaysLater.setDate(now.getDate() + 7);

      const urgentTargets = activeTargets.filter((t) => {
        const deadline = new Date(t.currentPeriodEnd || t.deadline);
        return deadline >= now && deadline <= sevenDaysLater;
      });

      return {
        agent: {
          _id: agent._id,
          name: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
          baseTarget: agent.target,
        },
        metrics: {
          totalTargets: agentTargets.length,
          activeTargets: activeTargets.length,
          completedTargets: completedTargets.length,
          urgentTargets: urgentTargets.length,
          totalTargetAmount: parseFloat(totalTargetAmount.toFixed(2)),
          totalAchievedAmount: parseFloat(totalAchievedAmount.toFixed(2)),
          achievementRate: parseFloat(achievementRate.toFixed(2)),
        },
        recentTargets: activeTargets
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 3)
          .map((t) => ({
            id: t._id,
            customer: t.cardName,
            targetAmount: t.targetAmount,
            achievedAmount: t.achievedAmount,
            achievementRate: t.achievementRate,
            deadline: t.currentPeriodEnd || t.deadline,
          })),
      };
    });

    // Overall team summary
    const totalTargets = targetsWithAchievements.length;
    const activeTargets = targetsWithAchievements.filter(
      (t) => t.status === "active"
    ).length;
    const completedTargets = targetsWithAchievements.filter(
      (t) =>
        t.status === "completed" || (t.achievementRate >= 100 && !t.isRecurring)
    ).length;
    const totalTargetAmount = targetsWithAchievements.reduce(
      (sum, t) => sum + t.targetAmount,
      0
    );
    const totalAchievedAmount = targetsWithAchievements.reduce(
      (sum, t) => sum + t.achievedAmount,
      0
    );
    const overallAchievementRate =
      totalTargetAmount > 0
        ? (totalAchievedAmount / totalTargetAmount) * 100
        : 0;

    // Recent activity (last 10 targets created/updated)
    const recentActivity = targetsWithAchievements
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt) -
          new Date(a.updatedAt || a.createdAt)
      )
      .slice(0, 10)
      .map((t) => ({
        id: t._id,
        customer: t.cardName,
        agent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
        targetAmount: t.targetAmount,
        achievedAmount: t.achievedAmount,
        achievementRate: t.achievementRate,
        status: t.status,
        lastUpdated: t.updatedAt || t.createdAt,
      }));

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalAgents: managedAgents.length,
          totalTargets,
          activeTargets,
          completedTargets,
          totalTargetAmount: parseFloat(totalTargetAmount.toFixed(2)),
          totalAchievedAmount: parseFloat(totalAchievedAmount.toFixed(2)),
          overallAchievementRate: parseFloat(overallAchievementRate.toFixed(2)),
        },
        agentPerformance: agentPerformance.sort(
          (a, b) => b.metrics.achievementRate - a.metrics.achievementRate
        ),
        teamTargets: targetsWithAchievements
          .filter((t) => t.status === "active")
          .sort(
            (a, b) =>
              new Date(a.currentPeriodEnd || a.deadline) -
              new Date(b.currentPeriodEnd || b.deadline)
          )
          .slice(0, 20)
          .map((t) => ({
            id: t._id,
            customer: t.cardName,
            agent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
            targetAmount: t.targetAmount,
            achievedAmount: t.achievedAmount,
            achievementRate: t.achievementRate,
            deadline: t.currentPeriodEnd || t.deadline,
            status: t.status,
          })),
        recentActivity,
      },
    });
  } catch (error) {
    console.error("Error fetching sales manager dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching sales manager dashboard",
      error: error.message,
    });
  }
};

exports.createCustomerTarget = async (req, res) => {
  try {
    const {
      cardCode,
      cardName,
      targetAmount,
      salesAgentId,
      notes,
      period = "monthly",
      isRecurring = true,
      clientExistingAverage = 0,
    } = req.body;

    // Validate required fields
    if (!cardCode || !cardName || !targetAmount || !salesAgentId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Validate sales agent exists and is a sales agent
    const salesAgent = await User.findById(salesAgentId);
    if (!salesAgent || salesAgent.role !== "sales_agent") {
      return res.status(400).json({
        success: false,
        message: "Invalid sales agent",
      });
    }

    // Permission check - only admin and sales managers can create targets
    if (req.user.role === "sales_agent") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to create customer targets",
      });
    }

    // Sales managers can only create targets for their agents
    if (
      req.user.role === "sales_manager" &&
      salesAgent.manager.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to create targets for this agent",
      });
    }

    // Set up the current period based on the chosen period type
    const now = new Date();
    let currentPeriodStart, currentPeriodEnd;

    if (period === "monthly") {
      currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      currentPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (period === "quarterly") {
      const quarter = Math.floor(now.getMonth() / 3);
      currentPeriodStart = new Date(now.getFullYear(), quarter * 3, 1);
      currentPeriodEnd = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
    } else if (period === "yearly") {
      currentPeriodStart = new Date(now.getFullYear(), 0, 1);
      currentPeriodEnd = new Date(now.getFullYear(), 11, 31);
    }

    // Create new customer target with recurring settings
    const newTarget = new CustomerTarget({
      cardCode,
      cardName,
      targetAmount,
      clientExistingAverage,
      isRecurring,
      period,
      currentPeriodStart,
      currentPeriodEnd,
      deadline: currentPeriodEnd, // For backwards compatibility
      startDate: new Date(),
      salesAgent: salesAgentId,
      createdBy: req.user._id,
      notes,
    });

    await newTarget.save();

    res.status(201).json({
      success: true,
      data: newTarget,
      message: "Customer target created successfully",
    });
  } catch (error) {
    console.error("Error creating customer target:", error);
    res.status(500).json({
      success: false,
      message: "Error creating customer target",
      error: error.message,
    });
  }
};

// Get all customer targets with filtering and pagination
exports.getAllCustomerTargets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 200;
    const skip = (page - 1) * limit;

    // Base query

    let query = {};

    // Filter by sales agent if agent ID is provided
    if (req.query.salesAgentId) {
      query.salesAgent = req.query.salesAgentId;
    }

    // Filter by customer if customer code is provided
    if (req.query.cardCode) {
      query.cardCode = req.query.cardCode;
    }

    // Filter by status
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Filter by period type
    if (req.query.period) {
      query.period = req.query.period;
    }

    // Restrict to agent's own targets if user is sales agent
    if (req.user.role === "sales_agent") {
      query.salesAgent = req.user._id;
    }

    // Restrict to manager's agents if user is sales manager
    if (req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      query.salesAgent = { $in: agentIds };
    }

    // Get targets with pagination
    const targets = await CustomerTarget.find(query)
      .populate("salesAgent", "firstName lastName email")
      .populate("createdBy", "firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort({ currentPeriodEnd: 1 });

    // Calculate achievements for all targets
    const targetsWithAchievements = await Promise.all(
      targets.map(async (target) => {
        const achievement = await calculateTargetAchievement(target);

        // Convert to plain object and add calculated fields
        const targetObj = target.toObject();
        targetObj.achievedAmount = achievement.achievedAmount;
        targetObj.achievementRate = achievement.achievementRate;
        targetObj.invoiceCount = achievement.invoiceCount;

        // Update status based on achievement (optional)
        if (
          achievement.achievementRate >= 100 &&
          targetObj.status === "active" &&
          !targetObj.isRecurring
        ) {
          targetObj.calculatedStatus = "completed";
        } else {
          targetObj.calculatedStatus = targetObj.status;
        }

        return targetObj;
      })
    );

    // Count total
    const total = await CustomerTarget.countDocuments(query);

    res.status(200).json({
      success: true,
      count: targetsWithAchievements.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: targetsWithAchievements,
    });
  } catch (error) {
    console.error("Error fetching customer targets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer targets",
      error: error.message,
    });
  }
};
// Update a customer target
exports.updateCustomerTarget = async (req, res) => {
  try {
    const targetId = req.params.id;
    const { targetAmount, notes, status, period, isRecurring } = req.body;

    // Find target
    const target = await CustomerTarget.findById(targetId);
    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Customer target not found",
      });
    }

    // Check permissions
    if (req.user.role === "sales_agent") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update targets",
      });
    }

    if (
      req.user.role === "sales_manager" &&
      target.salesAgent &&
      !(await isSalesAgentManagedByUser(target.salesAgent, req.user._id))
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this target",
      });
    }

    // Update fields
    if (targetAmount !== undefined) target.targetAmount = targetAmount;
    if (notes !== undefined) target.notes = notes;
    if (status !== undefined) target.status = status;

    // Update recurring settings if provided
    if (isRecurring !== undefined) target.isRecurring = isRecurring;

    // Update period type if provided and recalculate period dates
    if (period !== undefined && period !== target.period) {
      target.period = period;

      const now = new Date();

      // Calculate new period dates based on period type
      if (period === "monthly") {
        target.currentPeriodStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        );
        target.currentPeriodEnd = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0
        );
      } else if (period === "quarterly") {
        const quarter = Math.floor(now.getMonth() / 3);
        target.currentPeriodStart = new Date(now.getFullYear(), quarter * 3, 1);
        target.currentPeriodEnd = new Date(
          now.getFullYear(),
          (quarter + 1) * 3,
          0
        );
      } else if (period === "yearly") {
        target.currentPeriodStart = new Date(now.getFullYear(), 0, 1);
        target.currentPeriodEnd = new Date(now.getFullYear(), 11, 31);
      }

      // Update deadline for backward compatibility
      target.deadline = target.currentPeriodEnd;
    }

    // Recalculate achievement rate if target amount changed
    if (targetAmount !== undefined) {
      target.achievementRate = (target.achievedAmount / targetAmount) * 100;
    }

    await target.save();

    res.status(200).json({
      success: true,
      data: target,
      message: "Customer target updated successfully",
    });
  } catch (error) {
    console.error("Error updating customer target:", error);
    res.status(500).json({
      success: false,
      message: "Error updating customer target",
      error: error.message,
    });
  }
};

// Get customer targets for a specific customer
exports.getCustomerTargets = async (req, res) => {
  try {
    const { cardCode } = req.params;

    // Base query
    const query = { cardCode };

    // Permission restrictions
    if (req.user.role === "sales_agent") {
      query.salesAgent = req.user._id;
    } else if (req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      query.salesAgent = { $in: agentIds };
    }

    // Get targets
    const targets = await CustomerTarget.find(query)
      .populate("salesAgent", "firstName lastName email")
      .sort({ currentPeriodEnd: 1 });

    // Calculate achievements for all targets (same as getAllCustomerTargets)
    const targetsWithAchievements = await Promise.all(
      targets.map(async (target) => {
        const achievement = await calculateTargetAchievement(target);

        // Convert to plain object and add calculated fields
        const targetObj = target.toObject();
        targetObj.achievedAmount = achievement.achievedAmount;
        targetObj.achievementRate = achievement.achievementRate;
        targetObj.invoiceCount = achievement.invoiceCount;

        // Update status based on achievement (optional)
        if (
          achievement.achievementRate >= 100 &&
          targetObj.status === "active" &&
          !targetObj.isRecurring
        ) {
          targetObj.calculatedStatus = "completed";
        } else {
          targetObj.calculatedStatus = targetObj.status;
        }

        return targetObj;
      })
    );

    res.status(200).json({
      success: true,
      count: targetsWithAchievements.length,
      data: targetsWithAchievements,
    });
  } catch (error) {
    console.error("Error fetching customer targets:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer targets",
      error: error.message,
    });
  }
};
// Updated helper to update customer target progress when an invoice is processed
exports.updateCustomerTargetProgressFromInvoice = async (invoice) => {
  try {
    if (!invoice.CardCode || !invoice.DocTotal) {
      console.log("Insufficient invoice data to update customer target");
      return;
    }

    // Find the customer to get their assigned sales agent
    const Customer = require("../models/Customer");
    const customer = await Customer.findOne({ CardCode: invoice.CardCode });

    if (!customer || !customer.assignedTo) {
      console.log(
        `No assigned sales agent found for customer ${invoice.CardCode}`
      );
      return;
    }

    // Find active targets for this customer and sales agent
    const targets = await CustomerTarget.find({
      cardCode: invoice.CardCode,
      salesAgent: customer.assignedTo,
      status: "active",
    });

    if (targets.length === 0) {
      console.log(`No active targets found for customer ${invoice.CardCode}`);
      return;
    }

    // Get invoice date to check which targets are in the current period
    const invoiceDate = invoice.DocDate
      ? new Date(invoice.DocDate)
      : new Date();

    // Filter for targets where the invoice falls within the current period
    const currentPeriodTargets = targets.filter(
      (target) =>
        invoiceDate >= target.currentPeriodStart &&
        invoiceDate <= target.currentPeriodEnd
    );

    if (currentPeriodTargets.length === 0) {
      console.log(
        `No targets found in the current period for customer ${invoice.CardCode}`
      );
      return;
    }

    // Update the most recent target if multiple exist
    const target = currentPeriodTargets.sort(
      (a, b) => b.createdAt - a.createdAt
    )[0];

    // Update target with this invoice
    target.achievedAmount += invoice.DocTotal;
    target.achievementRate =
      (target.achievedAmount / target.targetAmount) * 100;

    // Add invoice to the list (modify the orders field to be more generic or add invoices field)
    target.orders.push({
      orderId: invoice._id,
      docEntry: invoice.DocEntry,
      docTotal: invoice.DocTotal,
      docDate: invoice.DocDate,
      docType: "invoice", // Add type to distinguish from orders
    });

    // Check if target is completed for this period
    if (target.achievedAmount >= target.targetAmount) {
      // For recurring targets, we don't mark it as completed permanently
      if (!target.isRecurring) {
        target.status = "completed";
      }
    }

    await target.save();
    console.log(
      `Updated target for customer ${invoice.CardCode}, new achieved amount: ${target.achievedAmount}`
    );

    return target;
  } catch (error) {
    console.error(
      "Error updating customer target progress from invoice:",
      error
    );
  }
};

// Function to recalculate all targets based on existing invoices
exports.recalculateAllTargetsFromInvoices = async () => {
  try {
    console.log("Starting recalculation of all targets from invoices...");

    // Get all active targets
    const targets = await CustomerTarget.find({ status: "active" });

    const Invoice = require("../models/Invoice");
    const Customer = require("../models/Customer");

    for (const target of targets) {
      console.log(`Recalculating target for customer ${target.cardCode}...`);

      // Reset achievement for recalculation
      target.achievedAmount = 0;
      target.orders = []; // Clear existing orders/invoices

      // Get customer to verify sales agent assignment
      const customer = await Customer.findOne({ CardCode: target.cardCode });

      if (
        !customer ||
        !customer.assignedTo ||
        customer.assignedTo.toString() !== target.salesAgent.toString()
      ) {
        console.log(
          `Sales agent mismatch for customer ${target.cardCode}, skipping...`
        );
        continue;
      }

      // Find all invoices for this customer within the target period
      const invoices = await Invoice.find({
        CardCode: target.cardCode,
        DocDate: {
          $gte: target.currentPeriodStart,
          $lte: target.currentPeriodEnd,
        },
      });

      // Calculate total from invoices
      let totalFromInvoices = 0;
      const invoiceEntries = [];

      for (const invoice of invoices) {
        totalFromInvoices += invoice.DocTotal;
        invoiceEntries.push({
          orderId: invoice._id,
          docEntry: invoice.DocEntry,
          docTotal: invoice.DocTotal,
          docDate: invoice.DocDate,
          docType: "invoice",
        });
      }

      // Update target
      target.achievedAmount = totalFromInvoices;
      target.achievementRate =
        (target.achievedAmount / target.targetAmount) * 100;
      target.orders = invoiceEntries;

      // Update status if needed
      if (target.achievedAmount >= target.targetAmount && !target.isRecurring) {
        target.status = "completed";
      }

      await target.save();
      console.log(
        `Updated target for ${target.cardCode}: ${target.achievedAmount}/${target.targetAmount}`
      );
    }

    console.log("Finished recalculating all targets from invoices.");
    return { success: true, message: "All targets recalculated successfully" };
  } catch (error) {
    console.error("Error recalculating targets from invoices:", error);
    return { success: false, error: error.message };
  }
};

// Endpoint to manually recalculate all targets from invoices
exports.recalculateTargetsFromInvoices = async (req, res) => {
  try {
    // Only allow admins to perform this operation
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only administrators can recalculate targets",
      });
    }

    console.log(
      `Admin ${req.user.firstName} ${req.user.lastName} initiated target recalculation`
    );

    const result = await exports.recalculateAllTargetsFromInvoices();

    if (result.success) {
      return res.status(200).json({
        success: true,
        message:
          "All customer targets have been recalculated based on invoices",
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Error during recalculation",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Error in recalculation endpoint:", error);
    return res.status(500).json({
      success: false,
      message: "Error recalculating targets",
      error: error.message,
    });
  }
};

// Get target achievement details with invoice breakdown
exports.getTargetAchievementDetails = async (req, res) => {
  try {
    const { targetId } = req.params;

    const target = await CustomerTarget.findById(targetId).populate(
      "salesAgent",
      "firstName lastName email"
    );

    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Target not found",
      });
    }

    // Check permissions
    if (
      req.user.role === "sales_agent" &&
      target.salesAgent._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this target",
      });
    }

    // Calculate achievement and get invoices
    const achievement = await calculateTargetAchievement(target);

    // Get detailed invoice information using the same date logic
    const Invoice = require("../models/Invoice");
    let dateQuery = {};

    if (target.currentPeriodStart && target.currentPeriodEnd) {
      dateQuery = {
        $gte: target.currentPeriodStart,
        $lte: target.currentPeriodEnd,
      };
    } else if (target.deadline) {
      const deadline = new Date(target.deadline);
      let periodStart;

      if (target.period === "monthly") {
        periodStart = new Date(deadline.getFullYear(), deadline.getMonth(), 1);
      } else if (target.period === "quarterly") {
        const quarter = Math.floor(deadline.getMonth() / 3);
        periodStart = new Date(deadline.getFullYear(), quarter * 3, 1);
      } else if (target.period === "yearly") {
        periodStart = new Date(deadline.getFullYear(), 0, 1);
      } else {
        periodStart = new Date(deadline);
        periodStart.setDate(periodStart.getDate() - 30);
      }

      dateQuery = {
        $gte: periodStart,
        $lte: deadline,
      };
    }

    const invoices = await Invoice.find({
      CardCode: target.cardCode,
      DocDate: dateQuery,
    }).sort({ DocDate: -1 });

    // Calculate net amounts for each invoice (for display purposes)
    const invoicesWithNetAmounts = invoices.map((invoice) => {
      let netAmount = 0;

      // Same logic as above to calculate net amount
      if (invoice.VatSum && invoice.VatSum > 0) {
        netAmount = invoice.DocTotal - invoice.VatSum;
      } else if (invoice.VatPercent && invoice.VatPercent > 0) {
        const vatMultiplier = 1 + invoice.VatPercent / 100;
        netAmount = invoice.DocTotal / vatMultiplier;
      } else if (invoice.DocumentLines && invoice.DocumentLines.length > 0) {
        netAmount = invoice.DocumentLines.reduce((lineSum, line) => {
          return lineSum + (line.Quantity || 0) * (line.Price || 0);
        }, 0);
      } else {
        const defaultVatRate = 0.2;
        netAmount = invoice.DocTotal / (1 + defaultVatRate);
      }

      return {
        ...invoice.toObject(),
        netAmount: parseFloat(netAmount.toFixed(2)),
        vatAmount: parseFloat((invoice.DocTotal - netAmount).toFixed(2)),
      };
    });

    // Calculate summary based on net amounts
    const summary = {
      totalInvoices: invoices.length,
      totalAmount: achievement.achievedAmount,
      totalAmountWithVAT: invoices.reduce((sum, inv) => sum + inv.DocTotal, 0),
      averageInvoiceValue:
        invoices.length > 0 ? achievement.achievedAmount / invoices.length : 0,
      largestInvoice:
        invoicesWithNetAmounts.length > 0
          ? Math.max(...invoicesWithNetAmounts.map((inv) => inv.netAmount))
          : 0,
      mostRecentInvoice: invoices.length > 0 ? invoices[0].DocDate : null,
      achievementRate: achievement.achievementRate,
      totalVATSaved: invoicesWithNetAmounts.reduce(
        (sum, inv) => sum + inv.vatAmount,
        0
      ),
    };

    // Add calculated fields to target object
    const targetWithAchievement = target.toObject();
    targetWithAchievement.achievedAmount = achievement.achievedAmount;
    targetWithAchievement.achievementRate = achievement.achievementRate;

    return res.status(200).json({
      success: true,
      data: {
        target: targetWithAchievement,
        invoices: invoicesWithNetAmounts,
        summary,
      },
    });
  } catch (error) {
    console.error("Error getting target achievement details:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching target details",
      error: error.message,
    });
  }
};
// Function to roll over to a new period - can be scheduled to run at the start of each month
exports.rolloverTargetPeriods = async () => {
  try {
    // Get current date
    const now = new Date();

    // Find all active recurring targets that need to be rolled over (their period has ended)
    const targetsToRollover = await CustomerTarget.find({
      isRecurring: true,
      status: "active",
      currentPeriodEnd: { $lt: now },
    });

    console.log(
      `Rolling over ${targetsToRollover.length} targets to new period`
    );

    // Process each target
    for (const target of targetsToRollover) {
      // Use the helper method to start a new period
      target.startNewPeriod();
      await target.save();
    }

    return {
      success: true,
      count: targetsToRollover.length,
      message: `Successfully rolled over ${targetsToRollover.length} targets to new period`,
    };
  } catch (error) {
    console.error("Error rolling over target periods:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// New endpoint to manually trigger rollover for a specific target
exports.manualRolloverTarget = async (req, res) => {
  try {
    const { targetId } = req.params;

    // Find the target
    const target = await CustomerTarget.findById(targetId);
    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Target not found",
      });
    }

    // Check if it's recurring
    if (!target.isRecurring) {
      return res.status(400).json({
        success: false,
        message: "Only recurring targets can be rolled over to a new period",
      });
    }

    // Roll over the target
    target.startNewPeriod();
    await target.save();

    return res.status(200).json({
      success: true,
      message: "Target successfully rolled over to new period",
      data: target,
    });
  } catch (error) {
    console.error("Error in manual target rollover:", error);
    return res.status(500).json({
      success: false,
      message: "Error rolling over target",
      error: error.message,
    });
  }
};
