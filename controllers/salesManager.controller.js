// controllers/salesManagerController.js
const User = require("../models/User");
const CustomerTarget = require("../models/CustomerTarget");
const SalesOrder = require("../models/SalesOrder");

// Get team members (sales agents) for the current sales manager
exports.getTeamMembers = async (req, res) => {
  try {
   

    // Base query
    let query = { role: "sales_agent" };

    // Get team members
    const teamMembers = await User.find(query).select(
      "firstName lastName email avatar joinedAt status lastLogin"
    );

    res.status(200).json({
      success: true,
      count: teamMembers.length,
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

// Get performance metrics for sales agents in the team
exports.getTeamPerformance = async (req, res) => {
  try {
  

    // Get date range from query params
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const endDate = req.query.endDate
      ? new Date(req.query.endDate)
      : new Date();

    // Base query for getting agents
    let agentsQuery = { role: "sales_agent" };

    // For sales manager, only get agents assigned to them
    if (req.user.role === "sales_manager") {
      agentsQuery.manager = req.user._id;
    }

    // Get team members
    const agents = await User.find(agentsQuery).select(
      "_id firstName lastName email avatar"
    );

    // Get performance data for each agent
    const agentPerformanceData = await Promise.all(
      agents.map(async (agent) => {
        // Get targets for this agent within date range
        const targets = await CustomerTarget.find({
          salesAgent: agent._id,
          startDate: { $lte: endDate },
          deadline: { $gte: startDate },
        });

        // Calculate metrics
        const totalTargets = targets.length;
        const activeTargets = targets.filter(
          (t) => t.status === "active"
        ).length;
        const completedTargets = targets.filter(
          (t) => t.status === "completed"
        ).length;
        const expiredTargets = targets.filter(
          (t) => t.status === "expired"
        ).length;
        const targetAmount = targets.reduce(
          (sum, t) => sum + t.targetAmount,
          0
        );
        const achievedAmount = targets.reduce(
          (sum, t) => sum + t.achievedAmount,
          0
        );
        const achievementRate =
          targetAmount > 0 ? (achievedAmount / targetAmount) * 100 : 0;

        // Compare with previous period if requested
        let comparisonData = null;
        if (req.query.compareWith) {
          const compareWithStartDate = new Date(startDate);
          const compareWithEndDate = new Date(endDate);
          const period = endDate - startDate;

          if (req.query.compareWith === "previous") {
            // Previous period of same length
            compareWithStartDate.setTime(startDate.getTime() - period);
            compareWithEndDate.setTime(endDate.getTime() - period);
          } else if (req.query.compareWith === "last_year") {
            // Same period last year
            compareWithStartDate.setFullYear(startDate.getFullYear() - 1);
            compareWithEndDate.setFullYear(endDate.getFullYear() - 1);
          }

          const previousTargets = await CustomerTarget.find({
            salesAgent: agent._id,
            startDate: { $lte: compareWithEndDate },
            deadline: { $gte: compareWithStartDate },
          });

          const prevTargetAmount = previousTargets.reduce(
            (sum, t) => sum + t.targetAmount,
            0
          );
          const prevAchievedAmount = previousTargets.reduce(
            (sum, t) => sum + t.achievedAmount,
            0
          );
          const prevAchievementRate =
            prevTargetAmount > 0
              ? (prevAchievedAmount / prevTargetAmount) * 100
              : 0;

          // Calculate change percentages
          comparisonData = {
            targetAmountChange:
              prevTargetAmount > 0
                ? ((targetAmount - prevTargetAmount) / prevTargetAmount) * 100
                : 0,
            achievedAmountChange:
              prevAchievedAmount > 0
                ? ((achievedAmount - prevAchievedAmount) / prevAchievedAmount) *
                  100
                : 0,
            achievementRateChange:
              prevAchievementRate > 0
                ? ((achievementRate - prevAchievementRate) /
                    prevAchievementRate) *
                  100
                : 0,
          };
        }

        return {
          agent: {
            id: agent._id,
            name: `${agent.firstName} ${agent.lastName}`,
            email: agent.email,
            avatar: agent.avatar,
          },
          performance: {
            totalTargets,
            activeTargets,
            completedTargets,
            expiredTargets,
            targetAmount,
            achievedAmount,
            achievementRate,
            comparison: comparisonData,
          },
        };
      })
    );

    // Calculate team totals
    const teamTotals = agentPerformanceData.reduce(
      (totals, agent) => {
        totals.totalTargets += agent.performance.totalTargets;
        totals.activeTargets += agent.performance.activeTargets;
        totals.completedTargets += agent.performance.completedTargets;
        totals.expiredTargets += agent.performance.expiredTargets;
        totals.targetAmount += agent.performance.targetAmount;
        totals.achievedAmount += agent.performance.achievedAmount;
        return totals;
      },
      {
        totalTargets: 0,
        activeTargets: 0,
        completedTargets: 0,
        expiredTargets: 0,
        targetAmount: 0,
        achievedAmount: 0,
      }
    );

    teamTotals.achievementRate =
      teamTotals.targetAmount > 0
        ? (teamTotals.achievedAmount / teamTotals.targetAmount) * 100
        : 0;

    res.status(200).json({
      success: true,
      data: {
        agents: agentPerformanceData,
        teamTotals,
      },
    });
  } catch (error) {
    console.error("Error fetching team performance:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team performance data",
      error: error.message,
    });
  }
};

// Get analytics dashboard data for the sales manager
exports.getAnalyticsDashboard = async (req, res) => {
  try {
  
    // Get date range from query params
    let startDate, endDate;
    const period = req.query.period || "month";

    const now = new Date();
    endDate = new Date(now);

    switch (period) {
      case "week":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "quarter":
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 3);
        break;
      case "year":
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
    }

    // Base query for targets
    let targetQuery = {
      startDate: { $lte: endDate },
      deadline: { $gte: startDate },
    };

    // For sales manager, only get targets for their team
    if (req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      targetQuery.salesAgent = { $in: agentIds };
    }

    // Get all relevant targets
    const allTargets = await CustomerTarget.find(targetQuery).populate(
      "salesAgent",
      "firstName lastName"
    );

    // Get team members
    let agentQuery = { role: "sales_agent" };
    if (req.user.role === "sales_manager") {
      agentQuery.manager = req.user._id;
    }
    const agents = await User.find(agentQuery).select(
      "_id firstName lastName email avatar"
    );

    // Calculate metrics
    const activeTargets = allTargets.filter((t) => t.status === "active");
    const completedTargets = allTargets.filter((t) => t.status === "completed");
    const expiredTargets = allTargets.filter((t) => t.status === "expired");
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

    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(now.getDate() + 7);

    const closeToDeadline = activeTargets.filter(
      (t) => t.deadline >= now && t.deadline <= sevenDaysLater
    );

    // Get highest achieving targets
    const highestAchieving = [...allTargets]
      .sort((a, b) => b.achievementRate - a.achievementRate)
      .slice(0, 5);

    // Get lowest achieving active targets
    const lowestAchieving = [...activeTargets]
      .sort((a, b) => a.achievementRate - b.achievementRate)
      .slice(0, 5);

    // Get performance data per agent
    const agentPerformance = await Promise.all(
      agents.map(async (agent) => {
        const agentTargets = allTargets.filter(
          (t) => t.salesAgent._id.toString() === agent._id.toString()
        );

        const agentActiveTargets = agentTargets.filter(
          (t) => t.status === "active"
        );
        const agentCompletedTargets = agentTargets.filter(
          (t) => t.status === "completed"
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

        return {
          agentId: agent._id,
          agentName: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
          avatar: agent.avatar,
          totalTargets: agentTargets.length,
          activeTargets: agentActiveTargets.length,
          completedTargets: agentCompletedTargets.length,
          targetAmount: totalTargetAmount,
          achievedAmount: totalAchievedAmount,
          achievementRate: achievementRate,
        };
      })
    );

    // Get monthly achievement trend
    const months = [];
    const monthlyAchievement = [];

    // Generate last 6 months for trend data
    for (let i = 5; i >= 0; i--) {
      const trendDate = new Date();
      trendDate.setMonth(trendDate.getMonth() - i);
      const monthName = trendDate.toLocaleString("default", { month: "short" });
      const year = trendDate.getFullYear();
      months.push(`${monthName} ${year}`);

      // Calculate achievement for this month
      const monthStart = new Date(
        trendDate.getFullYear(),
        trendDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        trendDate.getFullYear(),
        trendDate.getMonth() + 1,
        0
      );

      const monthlyTargets = allTargets.filter(
        (t) => t.deadline >= monthStart && t.deadline <= monthEnd
      );

      const targetAmount = monthlyTargets.reduce(
        (sum, t) => sum + t.targetAmount,
        0
      );
      const achievedAmount = monthlyTargets.reduce(
        (sum, t) => sum + t.achievedAmount,
        0
      );
      const rate = targetAmount > 0 ? (achievedAmount / targetAmount) * 100 : 0;

      monthlyAchievement.push(parseFloat(rate.toFixed(1)));
    }

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
          totalAgents: agents.length,
        },
        agentPerformance: agentPerformance,
        closeToDeadline: closeToDeadline.map((t) => ({
          id: t._id,
          customer: t.cardName,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          achievementRate: t.achievementRate,
          deadline: t.deadline,
          salesAgent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
        })),
        highestAchieving: highestAchieving.map((t) => ({
          id: t._id,
          customer: t.cardName,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          achievementRate: parseFloat(t.achievementRate.toFixed(2)),
          deadline: t.deadline,
          salesAgent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
          status: t.status,
        })),
        lowestAchieving: lowestAchieving.map((t) => ({
          id: t._id,
          customer: t.cardName,
          targetAmount: t.targetAmount,
          achievedAmount: t.achievedAmount,
          achievementRate: parseFloat(t.achievementRate.toFixed(2)),
          deadline: t.deadline,
          salesAgent: `${t.salesAgent.firstName} ${t.salesAgent.lastName}`,
        })),
        trends: {
          months: months,
          achievement: monthlyAchievement,
        },
      },
    });
  } catch (error) {
    console.error("Error generating analytics dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Error generating analytics dashboard",
      error: error.message,
    });
  }
};

// Get individual agent performance details
exports.getAgentPerformanceDetails = async (req, res) => {
  try {
    const { agentId } = req.params;

  
    // Get date range from query params
    let startDate, endDate;
    const period = req.query.period || "month";

    const now = new Date();
    endDate = new Date(now);

    switch (period) {
      case "week":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "quarter":
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 3);
        break;
      case "year":
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
    }

    // Get agent details
    const agent = await User.findById(agentId).select(
      "firstName lastName email avatar joinedAt lastLogin"
    );

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    // Get targets for this agent
    const targets = await CustomerTarget.find({
      salesAgent: agentId,
      startDate: { $lte: endDate },
      deadline: { $gte: startDate },
    }).sort({ deadline: 1 });

    // Get sales orders for this agent
    const orders = await SalesOrder.find({
      salesAgent: agentId,
      DocDate: { $gte: startDate, $lte: endDate },
    }).sort({ DocDate: -1 });

    // Calculate metrics
    const activeTargets = targets.filter((t) => t.status === "active");
    const completedTargets = targets.filter((t) => t.status === "completed");
    const expiredTargets = targets.filter((t) => t.status === "expired");

    const totalTargetAmount = targets.reduce(
      (sum, t) => sum + t.targetAmount,
      0
    );
    const totalAchievedAmount = targets.reduce(
      (sum, t) => sum + t.achievedAmount,
      0
    );
    const overallAchievementRate =
      totalTargetAmount > 0
        ? (totalAchievedAmount / totalTargetAmount) * 100
        : 0;

    // Get targets close to deadline (within 7 days)

    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(now.getDate() + 7);

    const closeToDeadline = activeTargets.filter(
      (t) => t.deadline >= now && t.deadline <= sevenDaysLater
    );

    // Calculate total orders and revenue
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.DocTotal || 0), 0);

    // Generate monthly trend data
    const months = [];
    const revenueData = [];
    const targetData = [];

    // Get last 6 months
    for (let i = 5; i >= 0; i--) {
      const trendDate = new Date();
      trendDate.setMonth(trendDate.getMonth() - i);

      const monthName = trendDate.toLocaleString("default", { month: "short" });
      const year = trendDate.getFullYear();
      months.push(`${monthName} ${year}`);

      // Calculate revenue for this month
      const monthStart = new Date(
        trendDate.getFullYear(),
        trendDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        trendDate.getFullYear(),
        trendDate.getMonth() + 1,
        0
      );

      const monthOrders = orders.filter(
        (o) =>
          new Date(o.DocDate) >= monthStart && new Date(o.DocDate) <= monthEnd
      );

      const monthlyRevenue = monthOrders.reduce(
        (sum, o) => sum + (o.DocTotal || 0),
        0
      );
      revenueData.push(monthlyRevenue);

      // Calculate target achievement for this month
      const monthTargets = targets.filter(
        (t) => t.deadline >= monthStart && t.deadline <= monthEnd
      );

      const targetAmount = monthTargets.reduce(
        (sum, t) => sum + t.targetAmount,
        0
      );
      const achievedAmount = monthTargets.reduce(
        (sum, t) => sum + t.achievedAmount,
        0
      );
      const achievement =
        targetAmount > 0 ? (achievedAmount / targetAmount) * 100 : 0;

      targetData.push(parseFloat(achievement.toFixed(1)));
    }

    // Return agent performance details
    res.status(200).json({
      success: true,
      data: {
        agent: {
          id: agent._id,
          name: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
          avatar: agent.avatar,
          joinedAt: agent.joinedAt,
          lastLogin: agent.lastLogin,
        },
        summary: {
          totalTargets: targets.length,
          activeTargets: activeTargets.length,
          completedTargets: completedTargets.length,
          expiredTargets: expiredTargets.length,
          totalOrders: totalOrders,
          targetAmount: totalTargetAmount,
          achievedAmount: totalAchievedAmount,
          achievementRate: parseFloat(overallAchievementRate.toFixed(2)),
          revenue: totalRevenue,
        },
        targets: {
          active: activeTargets.map((t) => ({
            id: t._id,
            customer: t.cardName,
            targetAmount: t.targetAmount,
            achievedAmount: t.achievedAmount,
            achievementRate: parseFloat(t.achievementRate.toFixed(2)),
            deadline: t.deadline,
            startDate: t.startDate,
            status: t.status,
            daysLeft: Math.ceil(
              (new Date(t.deadline) - new Date()) / (1000 * 60 * 60 * 24)
            ),
          })),
          completed: completedTargets.map((t) => ({
            id: t._id,
            customer: t.cardName,
            targetAmount: t.targetAmount,
            achievedAmount: t.achievedAmount,
            achievementRate: parseFloat(t.achievementRate.toFixed(2)),
            deadline: t.deadline,
            startDate: t.startDate,
            status: t.status,
          })),
          closeToDeadline: closeToDeadline.map((t) => ({
            id: t._id,
            customer: t.cardName,
            targetAmount: t.targetAmount,
            achievedAmount: t.achievedAmount,
            achievementRate: parseFloat(t.achievementRate.toFixed(2)),
            deadline: t.deadline,
            daysLeft: Math.ceil(
              (new Date(t.deadline) - new Date()) / (1000 * 60 * 60 * 24)
            ),
          })),
        },
        trends: {
          months: months,
          revenue: revenueData,
          achievement: targetData,
        },
        recentOrders: orders.slice(0, 5).map((o) => ({
          id: o._id,
          docNum: o.DocNum,
          customer: o.CardName,
          date: o.DocDate,
          amount: o.DocTotal,
          status: o.DocumentStatus,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching agent performance details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching agent performance details",
      error: error.message,
    });
  }
};
