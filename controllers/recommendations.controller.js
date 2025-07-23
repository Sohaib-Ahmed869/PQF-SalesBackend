// controllers/recommendationsController.js
const User = require("../models/User");
const Customer = require("../models/Customer");
const Invoice = require("../models/Invoice");
const SalesOrder = require("../models/SalesOrder");
const Payment = require("../models/payment");
const mongoose = require("mongoose");

/**
 * Get personalized recommendations based on user role
 * - Sales Agents see recommendations for their assigned customers
 * - Sales Managers see general recommendations across all customers/agents
 */
exports.getRecommendations = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;

    // Common recommendations object structure
    const recommendations = {
      highPotentialCustomers: [],
      upsellOpportunities: [],
      crossSellSuggestions: [],
      businessInsights: [],
      performanceInsights: [],
    };

    // Filter query based on user role
    let customerQuery = {};
    let agentQuery = {};

    if (userRole === "sales_agent") {
      // For sales agents, only show customers assigned to them
      customerQuery = { assignedTo: userId };
      agentQuery = { _id: userId };
    } else if (userRole === "sales_manager") {
      // For sales managers, show all customers/agents
      // Optionally could filter to only see agents they manage
      agentQuery = { role: "sales_agent" };
    } else {
      // Admin can see everything
      agentQuery = { role: "sales_agent" };
    }

    // Get assigned customers and associated data
    const customers = await Customer.find(customerQuery)
      .populate("assignedTo", "firstName lastName email")
      .lean();

    if (customers.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No customers found for recommendations",
        data: recommendations,
      });
    }

    const customerIds = customers.map((customer) => customer.CardCode);

    // Get invoices for these customers - with a limit to prevent overloading
    const invoices = await Invoice.find({
      CardCode: { $in: customerIds },
    })
      .sort({ DocDate: -1 }) // Sort by newest first
      .limit(1000) // Limit to prevent performance issues
      .lean();

    // Get payments for analysis - but not as a primary recommendation
    const payments = await Payment.find({
      CardCode: { $in: customerIds },
    })
      .sort({ DocDate: -1 })
      .limit(500)
      .lean();

    // Get sales agents if needed
    const salesAgents = await User.find(agentQuery).select("-password").lean();

    // 1. Identify high-potential customers (high order value, consistent buying)
    recommendations.highPotentialCustomers =
      await identifyHighPotentialCustomers(customers, invoices, payments);

    // 2. Identify upsell opportunities based on purchase history
    recommendations.upsellOpportunities = await identifyUpsellOpportunities(
      customers,
      invoices
    );

    // 3. Generate cross-sell suggestions based on customer purchase patterns
    recommendations.crossSellSuggestions = await generateCrossSellSuggestions(
      customers,
      invoices
    );

    // 4. Generate business insights (KPIs, trends, facts)
    recommendations.businessInsights = await generateBusinessInsights(
      customers,
      invoices,
      payments
    );

    // 5. Performance insights (only for managers or admins)
    if (userRole === "sales_manager" || userRole === "admin") {
      recommendations.performanceInsights = await getPerformanceInsights(
        salesAgents,
        customers,
        invoices
      );
    }

    return res.status(200).json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recommendations",
      error: error.message,
    });
  }
};

/**
 * Identify high-potential customers based on order value and frequency
 */
async function identifyHighPotentialCustomers(customers, invoices, payments) {
  // Group invoices by customer
  const customerInvoices = {};
  invoices.forEach((invoice) => {
    if (!customerInvoices[invoice.CardCode]) {
      customerInvoices[invoice.CardCode] = [];
    }
    customerInvoices[invoice.CardCode].push(invoice);
  });

  // For each customer, calculate total spend, frequency, and recency
  const potentialCustomers = customers.map((customer) => {
    const customerInvoiceList = customerInvoices[customer.CardCode] || [];

    // Calculate total spend
    const totalSpend = customerInvoiceList.reduce(
      (sum, inv) => sum + inv.DocTotal,
      0
    );

    // Calculate purchase frequency (average days between orders)
    let purchaseFrequency = 0;
    if (customerInvoiceList.length > 1) {
      // Sort invoices by date
      const sortedInvoices = [...customerInvoiceList].sort(
        (a, b) => new Date(a.DocDate) - new Date(b.DocDate)
      );

      let daysBetween = [];
      for (let i = 1; i < sortedInvoices.length; i++) {
        const dayDiff = Math.floor(
          (new Date(sortedInvoices[i].DocDate) -
            new Date(sortedInvoices[i - 1].DocDate)) /
            (1000 * 60 * 60 * 24)
        );
        daysBetween.push(dayDiff);
      }

      purchaseFrequency =
        daysBetween.reduce((sum, days) => sum + days, 0) / daysBetween.length;
    }

    // Calculate recency (days since last purchase)
    let recency = 365; // Default high value
    if (customerInvoiceList.length > 0) {
      const sortedByRecent = [...customerInvoiceList].sort(
        (a, b) => new Date(b.DocDate) - new Date(a.DocDate)
      );

      recency = Math.floor(
        (new Date() - new Date(sortedByRecent[0].DocDate)) /
          (1000 * 60 * 60 * 24)
      );
    }

    // Customer lifetime value estimation based on average purchase value and frequency
    const avgOrderValue =
      customerInvoiceList.length > 0
        ? totalSpend / customerInvoiceList.length
        : 0;

    const estimatedAnnualValue =
      purchaseFrequency > 0 ? (avgOrderValue * 365) / purchaseFrequency : 0;

    // Combine factors into a potential score
    // Lower score is better (recent + frequent + high spend)
    const potentialScore =
      recency * 0.4 + purchaseFrequency * 0.3 - totalSpend / 1000;

    return {
      customer: {
        cardCode: customer.CardCode,
        cardName: customer.CardName,
        assignedTo: customer.assignedTo,
      },
      metrics: {
        totalSpend,
        avgOrderValue,
        purchaseFrequency,
        recency,
        estimatedAnnualValue,
        invoiceCount: customerInvoiceList.length,
        potentialScore,
      },
      opportunities: [],
    };
  });

  // Sort by potential score (lower is better) and take top 5
  const highPotential = potentialCustomers
    .filter((c) => c.metrics.invoiceCount > 0) // Must have at least one invoice
    .sort((a, b) => a.metrics.potentialScore - b.metrics.potentialScore)
    .slice(0, 5);

  // Add specific opportunities for each high potential customer
  highPotential.forEach((customer) => {
    if (customer.metrics.recency < 30) {
      // Recent customer
      customer.opportunities.push({
        type: "loyalty",
        description: "Regular buyer eligible for loyalty program",
        action: "Offer exclusive access to new products or premium services",
      });
    } else if (customer.metrics.recency < 90) {
      // Moderately recent
      customer.opportunities.push({
        type: "reengagement",
        description: "Previous regular customer showing reduced activity",
        action: "Personalized offer based on past purchase patterns",
      });
    } else {
      // Not recent
      customer.opportunities.push({
        type: "reactivation",
        description: "Previously valuable customer has become inactive",
        action: "Targeted reactivation campaign with special incentives",
      });
    }

    if (customer.metrics.totalSpend > 10000) {
      customer.opportunities.push({
        type: "vip",
        description: "High-value customer",
        action: "Schedule quarterly business review meeting",
      });
    }

    if (customer.metrics.estimatedAnnualValue > 20000) {
      customer.opportunities.push({
        type: "growth",
        description: "High CLV potential",
        action: "Develop custom expansion strategy to grow account share",
      });
    }
  });

  return highPotential;
}

/**
 * Identify upsell opportunities based on purchase history
 */
async function identifyUpsellOpportunities(customers, invoices) {
  // Group invoices by customer
  const customerInvoices = {};
  invoices.forEach((invoice) => {
    if (!customerInvoices[invoice.CardCode]) {
      customerInvoices[invoice.CardCode] = [];
    }
    customerInvoices[invoice.CardCode].push(invoice);
  });

  // Analyze each customer's purchase patterns
  const opportunities = customers
    .map((customer) => {
      const customerInvoiceList = customerInvoices[customer.CardCode] || [];

      if (customerInvoiceList.length < 2) {
        return null; // Need at least 2 invoices for meaningful analysis
      }

      // Sort invoices by date (newest first)
      const sortedInvoices = [...customerInvoiceList].sort(
        (a, b) => new Date(b.DocDate) - new Date(a.DocDate)
      );

      // Calculate average order value
      const avgOrderValue =
        sortedInvoices.reduce((sum, inv) => sum + inv.DocTotal, 0) /
        sortedInvoices.length;

      // Calculate days since last order
      const daysSinceLastOrder = Math.floor(
        (new Date() - new Date(sortedInvoices[0].DocDate)) /
          (1000 * 60 * 60 * 24)
      );

      // Calculate average days between orders
      let daysBetween = [];
      for (let i = 1; i < sortedInvoices.length; i++) {
        daysBetween.push(
          Math.floor(
            (new Date(sortedInvoices[i - 1].DocDate) -
              new Date(sortedInvoices[i].DocDate)) /
              (1000 * 60 * 60 * 24)
          )
        );
      }

      const avgDaysBetweenOrders =
        daysBetween.length > 0
          ? daysBetween.reduce((sum, days) => sum + days, 0) /
            daysBetween.length
          : null;

      // Only proceed if:
      // - Customer has ordered recently (within 120 days)
      // - There's a pattern of regular ordering
      if (daysSinceLastOrder > 120 || !avgDaysBetweenOrders) {
        return null;
      }

      // Determine if they're due for another order
      const isDueForOrder = daysSinceLastOrder >= avgDaysBetweenOrders * 0.8;

      // Calculate average purchase growth rate
      let purchaseGrowthRate = 0;
      if (sortedInvoices.length >= 4) {
        const recentHalf = sortedInvoices.slice(
          0,
          Math.ceil(sortedInvoices.length / 2)
        );
        const olderHalf = sortedInvoices.slice(
          Math.ceil(sortedInvoices.length / 2)
        );

        const recentAvg =
          recentHalf.reduce((sum, inv) => sum + inv.DocTotal, 0) /
          recentHalf.length;
        const olderAvg =
          olderHalf.reduce((sum, inv) => sum + inv.DocTotal, 0) /
          olderHalf.length;

        purchaseGrowthRate = ((recentAvg - olderAvg) / olderAvg) * 100;
      }

      // Determine opportunity type based on purchase patterns
      let opportunityType = "";
      let recommendation = "";
      let upsellProduct = "";
      let expectedValue = 0;

      if (isDueForOrder) {
        opportunityType = "Reorder";
        recommendation = "Contact customer about reordering typical items";
        upsellProduct = "Premium or bulk version of regularly purchased items";
        expectedValue = avgOrderValue * 1.2; // Estimate 20% increase over typical order
      }

      // Add specific upsell based on order value
      if (avgOrderValue > 5000) {
        opportunityType = "Premium Upsell";
        recommendation =
          "Offer premium product upgrades based on high spending pattern";
        upsellProduct =
          "Enterprise-level solutions or exclusive premium options";
        expectedValue = avgOrderValue * 0.3; // Estimate 30% of current avg order as upsell value
      } else if (avgOrderValue > 1000) {
        opportunityType = "Value-Add Upsell";
        recommendation = "Suggest add-on services or product upgrades";
        upsellProduct =
          "Add-on services, warranties, or complementary products";
        expectedValue = avgOrderValue * 0.25; // Estimate 25% of current avg order as upsell value
      } else {
        opportunityType = "Bundle Upgrade";
        recommendation = "Promote discounted bundle upgrade";
        upsellProduct = "Bundle package with volume discount";
        expectedValue = avgOrderValue * 0.5; // Estimate 50% increase through bundling
      }

      // Adjust based on growth trend
      if (purchaseGrowthRate > 20) {
        opportunityType = "Growth Account Expansion";
        recommendation =
          "Schedule account review to discuss expanded partnership";
        upsellProduct = "Comprehensive solution package";
        expectedValue = avgOrderValue * 2; // Potential to double business
      } else if (purchaseGrowthRate < -10) {
        opportunityType = "Value Recovery";
        recommendation = "Proactive outreach to address potential issues";
        upsellProduct = "Simplified solution package with service guarantees";
        expectedValue = Math.max(avgOrderValue * 0.5, 1000); // Recover at least half of previous business
      }

      return {
        customer: {
          cardCode: customer.CardCode,
          cardName: customer.CardName,
          assignedTo: customer.assignedTo,
        },
        metrics: {
          invoiceCount: sortedInvoices.length,
          avgOrderValue,
          avgDaysBetweenOrders,
          daysSinceLastOrder,
          isDueForOrder,
          purchaseGrowthRate,
        },
        opportunity: {
          type: opportunityType,
          recommendation,
          product: upsellProduct,
          bestTimeToContact: isDueForOrder
            ? "Immediately"
            : `In approximately ${Math.round(
                avgDaysBetweenOrders - daysSinceLastOrder
              )} days`,
          expectedValue: Math.round(expectedValue),
        },
      };
    })
    .filter(Boolean); // Remove null entries

  // Sort by opportunity priority (due for order + high value first)
  return opportunities
    .sort((a, b) => {
      // First sort by whether they're due for an order
      if (a.metrics.isDueForOrder !== b.metrics.isDueForOrder) {
        return a.metrics.isDueForOrder ? -1 : 1;
      }

      // Then by expected value
      return b.opportunity.expectedValue - a.opportunity.expectedValue;
    })
    .slice(0, 5); // Return top 5
}

/**
 * Generate cross-sell suggestions based on customer purchase patterns
 */
async function generateCrossSellSuggestions(customers, invoices) {
  // To simplify, we'll create cross-sell suggestions based on industry, recent purchases,
  // and purchase volume patterns. In a real implementation, you would use actual product data.

  // Group invoices by customer
  const customerInvoices = {};
  invoices.forEach((invoice) => {
    if (!customerInvoices[invoice.CardCode]) {
      customerInvoices[invoice.CardCode] = [];
    }
    customerInvoices[invoice.CardCode].push(invoice);
  });

  // Define some product categories (simplified example)
  const productCategories = [
    { id: 1, name: "Food Products", relatedCategories: [2, 5] },
    { id: 2, name: "Beverages", relatedCategories: [1, 3] },
    { id: 3, name: "Snacks", relatedCategories: [1, 2] },
    { id: 4, name: "Frozen Products", relatedCategories: [1, 6] },
    { id: 5, name: "Dairy Products", relatedCategories: [1, 4] },
    { id: 6, name: "Specialty Foods", relatedCategories: [4, 5] },
  ];

  // Simplified assignment of industry/category to customers based on name (would use actual data in real impl)
  const customerCategories = {};
  customers.forEach((customer) => {
    const name = customer.CardName.toLowerCase();
    if (
      name.includes("restaurant") ||
      name.includes("cafe") ||
      name.includes("catering")
    ) {
      customerCategories[customer.CardCode] = 1; // Food Products
    } else if (
      name.includes("mart") ||
      name.includes("store") ||
      name.includes("market")
    ) {
      customerCategories[customer.CardCode] = 2; // Beverages
    } else if (name.includes("bakery") || name.includes("pastry")) {
      customerCategories[customer.CardCode] = 3; // Snacks
    } else if (name.includes("frozen") || name.includes("ice")) {
      customerCategories[customer.CardCode] = 4; // Frozen Products
    } else if (name.includes("dairy") || name.includes("farm")) {
      customerCategories[customer.CardCode] = 5; // Dairy Products
    } else {
      customerCategories[customer.CardCode] = 6; // Specialty Foods (default)
    }
  });

  // Generate cross-sell suggestions
  const crossSellSuggestions = customers
    .filter((customer) => {
      const invoiceList = customerInvoices[customer.CardCode] || [];
      return invoiceList.length > 0; // Only suggest for customers with at least one purchase
    })
    .map((customer) => {
      const invoiceList = customerInvoices[customer.CardCode] || [];
      const sortedInvoices = [...invoiceList].sort(
        (a, b) => new Date(b.DocDate) - new Date(a.DocDate)
      );

      // Calculate metrics
      const totalSpent = invoiceList.reduce(
        (sum, inv) => sum + inv.DocTotal,
        0
      );
      const avgOrderValue =
        invoiceList.length > 0 ? totalSpent / invoiceList.length : 0;

      // Get main category and related categories
      const mainCategory = customerCategories[customer.CardCode] || 6;
      const category = productCategories.find((c) => c.id === mainCategory);
      const relatedCategories = category ? category.relatedCategories : [1, 2];

      // Generate complementary product suggestions based on main category
      const complementaryProducts = relatedCategories.map((catId) => {
        const relatedCategory = productCategories.find((c) => c.id === catId);
        return {
          category: relatedCategory ? relatedCategory.name : "Related Products",
          product: `Premium ${
            relatedCategory ? relatedCategory.name : "Products"
          }`,
          fit: "High",
          potentialValue: Math.round(avgOrderValue * 0.3), // 30% of avg order value
        };
      });

      // Determine cross-sell strategy based on purchase volume
      let crossSellStrategy;
      if (totalSpent > 10000) {
        crossSellStrategy = {
          name: "Premium Cross-Category Expansion",
          approach:
            "Scheduled business review with product portfolio presentation",
          timing: "Quarterly business review",
        };
      } else if (totalSpent > 5000) {
        crossSellStrategy = {
          name: "Complementary Product Introduction",
          approach: "Email campaign followed by sales call",
          timing: "Within 2 weeks of last purchase",
        };
      } else {
        crossSellStrategy = {
          name: "Entry-Level Product Sampling",
          approach: "Include product samples with next delivery",
          timing: "Next order",
        };
      }

      return {
        customer: {
          cardCode: customer.CardCode,
          cardName: customer.CardName,
          assignedTo: customer.assignedTo,
          primaryCategory: category ? category.name : "Specialty Foods",
        },
        metrics: {
          recentPurchaseDate: sortedInvoices[0]
            ? sortedInvoices[0].DocDate
            : null,
          totalSpent,
          avgOrderValue,
          purchaseCount: invoiceList.length,
        },
        crossSell: {
          strategy: crossSellStrategy,
          complementaryProducts: complementaryProducts.slice(0, 2), // Top 2 complementary products
        },
      };
    });

  // Sort by total spent (highest first) and take top 5
  return crossSellSuggestions
    .sort((a, b) => b.metrics.totalSpent - a.metrics.totalSpent)
    .slice(0, 5);
}

/**
 * Generate business insights based on customer data
 */
async function generateBusinessInsights(customers, invoices, payments) {
  // Calculate key metrics
  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((c) => {
    const customerInvoices = invoices.filter(
      (inv) => inv.CardCode === c.CardCode
    );
    if (customerInvoices.length === 0) return false;

    const lastInvoiceDate = new Date(
      Math.max(...customerInvoices.map((inv) => new Date(inv.DocDate)))
    );
    const daysSinceLastInvoice = Math.floor(
      (new Date() - lastInvoiceDate) / (1000 * 60 * 60 * 24)
    );
    return daysSinceLastInvoice <= 90; // Active if purchased in last 90 days
  }).length;

  // Calculate total revenue
  const totalRevenue = invoices.reduce((sum, inv) => sum + inv.DocTotal, 0);

  // Calculate average order value
  const avgOrderValue =
    invoices.length > 0 ? totalRevenue / invoices.length : 0;

  // Calculate customer lifetime value (simplified)
  const customerLifetimeValues = {};
  invoices.forEach((invoice) => {
    if (!customerLifetimeValues[invoice.CardCode]) {
      customerLifetimeValues[invoice.CardCode] = 0;
    }
    customerLifetimeValues[invoice.CardCode] += invoice.DocTotal;
  });

  const avgCustomerLifetimeValue =
    Object.values(customerLifetimeValues).length > 0
      ? Object.values(customerLifetimeValues).reduce(
          (sum, val) => sum + val,
          0
        ) / Object.values(customerLifetimeValues).length
      : 0;

  // Monthly revenue trend (past 6 months)
  const today = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(today.getMonth() - 6);

  const recentInvoices = invoices.filter(
    (inv) => new Date(inv.DocDate) >= sixMonthsAgo
  );

  const monthlyTrends = {};
  for (let i = 0; i < 6; i++) {
    const targetMonth = new Date();
    targetMonth.setMonth(today.getMonth() - i);
    const monthKey = `${targetMonth.getFullYear()}-${String(
      targetMonth.getMonth() + 1
    ).padStart(2, "0")}`;
    monthlyTrends[monthKey] = {
      month: targetMonth.toLocaleString("default", { month: "short" }),
      year: targetMonth.getFullYear(),
      revenue: 0,
      orderCount: 0,
    };
  }

  // Populate monthly trends
  recentInvoices.forEach((invoice) => {
    const invoiceDate = new Date(invoice.DocDate);
    const monthKey = `${invoiceDate.getFullYear()}-${String(
      invoiceDate.getMonth() + 1
    ).padStart(2, "0")}`;

    if (monthlyTrends[monthKey]) {
      monthlyTrends[monthKey].revenue += invoice.DocTotal;
      monthlyTrends[monthKey].orderCount += 1;
    }
  });

  // Calculate growth rates
  const monthKeys = Object.keys(monthlyTrends).sort();
  const revenueGrowth =
    monthKeys.length >= 2
      ? ((monthlyTrends[monthKeys[0]].revenue -
          monthlyTrends[monthKeys[monthKeys.length - 1]].revenue) /
          monthlyTrends[monthKeys[monthKeys.length - 1]].revenue) *
        100
      : 0;

  // Industry benchmarks (simulated)
  const industryBenchmarks = {
    avgOrderValue: avgOrderValue * 0.9, // Simulated benchmark
    customerRetention: 70, // Percentage
    salesCycleLength: 15, // Days
  };

  // Generate insights based on calculations
  const insights = [
    // {
    //   title: "Revenue Growth",
    //   metric: `${revenueGrowth.toFixed(1)}%`,
    //   description: `Revenue has ${
    //     revenueGrowth >= 0 ? "grown" : "declined"
    //   } by ${Math.abs(revenueGrowth).toFixed(1)}% over the last 6 months`,
    //   trend: revenueGrowth >= 0 ? "positive" : "negative",
    //   icon: "revenue",
    // },
    {
      title: "Customer Engagement",
      metric: `${Math.round((activeCustomers / totalCustomers) * 100)}%`,
      description: `${activeCustomers} out of ${totalCustomers} customers have placed orders in the last 90 days`,
      trend: activeCustomers / totalCustomers > 0.7 ? "positive" : "neutral",
      icon: "customers",
    },
    {
      title: "Average Order Value",
      metric: `$${Math.round(avgOrderValue).toLocaleString()}`,
      description: `${
        avgOrderValue > industryBenchmarks.avgOrderValue ? "Above" : "Below"
      } industry average of $${Math.round(
        industryBenchmarks.avgOrderValue
      ).toLocaleString()}`,
      trend:
        avgOrderValue > industryBenchmarks.avgOrderValue
          ? "positive"
          : "negative",
      icon: "orders",
    },
    {
      title: "Customer Lifetime Value",
      metric: `$${Math.round(avgCustomerLifetimeValue).toLocaleString()}`,
      description: "Average total revenue generated per customer",
      trend: "neutral",
      icon: "value",
    },
  ];

  // Add key facts based on data analysis
  const topCustomer = Object.entries(customerLifetimeValues)
    .sort((a, b) => b[1] - a[1])
    .map(([cardCode, value]) => {
      const customer = customers.find((c) => c.CardCode === cardCode);
      return {
        cardCode,
        cardName: customer ? customer.CardName : "Unknown",
        value,
      };
    })[0];

  const highestMonthlyRevenue = Object.values(monthlyTrends).sort(
    (a, b) => b.revenue - a.revenue
  )[0];

  // Add data facts
  const facts = [
    {
      title: "Top Customer",
      detail: topCustomer
        ? `${topCustomer.cardName} ($${Math.round(
            topCustomer.value
          ).toLocaleString()})`
        : "N/A",
      icon: "star",
    },
    {
      title: "Best Performing Month",
      detail: highestMonthlyRevenue
        ? `${highestMonthlyRevenue.month} ${
            highestMonthlyRevenue.year
          } ($${Math.round(highestMonthlyRevenue.revenue).toLocaleString()})`
        : "N/A",
      icon: "calendar",
    },
    {
      title: "Average Sales Cycle",
      detail: `${industryBenchmarks.salesCycleLength} days`,
      icon: "cycle",
    },
    {
      title: "Customer Retention Rate",
      detail: `${industryBenchmarks.customerRetention}%`,
      icon: "retention",
    },
  ];

  // Return the structured data
  return {
    metrics: {
      totalCustomers,
      activeCustomers,
      totalRevenue,
      avgOrderValue,
      avgCustomerLifetimeValue,
    },
    monthlyTrends: Object.values(monthlyTrends).sort((a, b) => {
      // Sort by year and month (ascending)
      if (a.year !== b.year) return a.year - b.year;
      return (
        new Date(Date.parse(`${a.month} 1, 2000`)) -
        new Date(Date.parse(`${b.month} 1, 2000`))
      );
    }),
    keyInsights: insights,
    keyFacts: facts,
  };
}

/**
 * Generate performance insights for sales managers
 */
async function getPerformanceInsights(salesAgents, customers, invoices) {
  // Skip if no sales agents
  if (!salesAgents.length) {
    return [];
  }

  // Create a map of agents by ID for easier lookup
  const agentsById = {};
  salesAgents.forEach((agent) => {
    agentsById[agent._id] = agent;
  });

  // Create a map of customer assignments
  const customerAssignments = {};
  customers.forEach((customer) => {
    if (customer.assignedTo) {
      if (!customerAssignments[customer.assignedTo]) {
        customerAssignments[customer.assignedTo] = [];
      }
      customerAssignments[customer.assignedTo].push(customer);
    }
  });

  // Group invoices by assigned agent (using customer assignment)
  const agentInvoices = {};

  for (const invoice of invoices) {
    // Find the customer
    const customer = customers.find((c) => c.CardCode === invoice.CardCode);

    if (customer && customer.assignedTo) {
      const agentId = customer.assignedTo;

      if (!agentInvoices[agentId]) {
        agentInvoices[agentId] = [];
      }

      agentInvoices[agentId].push(invoice);
    }
  }

  // Generate insights for each agent
  const insights = [];

  for (const agentId in agentInvoices) {
    const agent = agentsById[agentId];

    if (!agent) continue;

    const agentName = `${agent.firstName} ${agent.lastName}`;
    const assignedCustomerCount = (customerAssignments[agentId] || []).length;
    const activeInvoices = agentInvoices[agentId] || [];

    // Calculate key metrics
    const recentInvoices = activeInvoices.filter((inv) => {
      const invoiceDate = new Date(inv.DocDate);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return invoiceDate >= thirtyDaysAgo;
    });

    const recentSales = recentInvoices.reduce(
      (sum, inv) => sum + inv.DocTotal,
      0
    );

    // Calculate conversion rate (customers with orders / total customers)
    const customersWithOrders = new Set();
    activeInvoices.forEach((inv) => {
      customersWithOrders.add(inv.CardCode);
    });

    const conversionRate =
      assignedCustomerCount > 0
        ? (customersWithOrders.size / assignedCustomerCount) * 100
        : 0;

    // Calculate average deal size
    const avgDealSize =
      activeInvoices.length > 0
        ? activeInvoices.reduce((sum, inv) => sum + inv.DocTotal, 0) /
          activeInvoices.length
        : 0;

    // Calculate sales velocity (deals per month)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const sixMonthInvoices = activeInvoices.filter(
      (inv) => new Date(inv.DocDate) >= sixMonthsAgo
    );

    const salesVelocity = sixMonthInvoices.length / 6; // Deals per month

    // Determine performance category
    let performanceCategory = "";
    let insights = [];

    if (recentSales > 50000) {
      performanceCategory = "Top Performer";
      insights.push("Consistently exceeding sales targets");
    } else if (recentSales > 25000) {
      performanceCategory = "Solid Performer";
      insights.push("Meeting expectations with good results");
    } else if (recentSales > 10000) {
      performanceCategory = "Average Performer";
      insights.push("Meeting basic targets but has room to improve");
    } else {
      performanceCategory = "Needs Improvement";
      insights.push("Struggling to meet sales targets");
    }

    // Add additional insights based on metrics
    if (conversionRate < 30) {
      insights.push(
        "Low customer conversion rate - may need help with closing techniques"
      );
    } else if (conversionRate > 70) {
      insights.push(
        "Excellent conversion rate - consider having them share best practices"
      );
    }

    if (avgDealSize < 1000) {
      insights.push("Low average deal size - focus on upselling strategies");
    } else if (avgDealSize > 5000) {
      insights.push(
        "High average deal value - excellent at selling premium solutions"
      );
    }

    if (salesVelocity < 2) {
      insights.push(
        "Low sales velocity - consider pipeline management training"
      );
    } else if (salesVelocity > 10) {
      insights.push("High deal flow - excellent at prospecting and closing");
    }

    if (assignedCustomerCount < 5) {
      insights.push(
        "Low customer assignment - consider assigning more accounts"
      );
    } else if (assignedCustomerCount > 30) {
      insights.push(
        "Very high customer load - may need support or redistribution"
      );
    }

    // Generate coaching recommendations
    let recommendations = [];

    switch (performanceCategory) {
      case "Top Performer":
        recommendations.push(
          "Consider for mentorship program to help other sales agents"
        );
        recommendations.push("Review for potential advancement opportunities");
        recommendations.push(
          "Provide additional resources to maximize growth potential"
        );
        break;
      case "Solid Performer":
        recommendations.push(
          "Provide additional product training to increase sales"
        );
        recommendations.push("Set stretch goals with appropriate incentives");
        recommendations.push("Focus on account expansion strategies");
        break;
      case "Average Performer":
        recommendations.push("Schedule regular coaching sessions");
        recommendations.push(
          "Review sales techniques and offer additional training"
        );
        recommendations.push("Implement structured prospecting plan");
        break;
      case "Needs Improvement":
        recommendations.push("Implement performance improvement plan");
        recommendations.push("Provide close supervision and weekly check-ins");
        recommendations.push("Offer focused training on key skills gaps");
        break;
    }

    // Generate growth opportunities
    const growthOpportunities = [];

    // Find customers with upsell potential
    const potentialCustomers = customerAssignments[agentId]
      .filter((customer) => {
        const customerInvoices = activeInvoices.filter(
          (inv) => inv.CardCode === customer.CardCode
        );
        return customerInvoices.length >= 3; // Has ordered at least 3 times
      })
      .slice(0, 3); // Top 3 customers

    if (potentialCustomers.length > 0) {
      growthOpportunities.push({
        type: "Account Expansion",
        description: `Focus on expanding ${potentialCustomers.length} key accounts`,
        potentialValue: Math.round(
          avgDealSize * potentialCustomers.length * 0.5
        ), // 50% of avg deal per account
      });
    }

    // Packaging it all together
    insights.push({
      agent: {
        id: agentId,
        name: agentName,
        email: agent.email,
      },
      metrics: {
        assignedCustomers: assignedCustomerCount,
        activeCustomers: customersWithOrders.size,
        conversionRate: parseFloat(conversionRate.toFixed(2)),
        recentSales,
        avgDealSize,
        salesVelocity,
        totalSales: activeInvoices.reduce((sum, inv) => sum + inv.DocTotal, 0),
        performanceCategory,
      },
      insights,
      recommendations,
      growthOpportunities,
    });
  }

  // Sort by recent sales (highest first)
  return insights.sort((a, b) => b.metrics.recentSales - a.metrics.recentSales);
}
