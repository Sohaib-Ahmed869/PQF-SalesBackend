const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// Import routes
const authRoutes = require("./routes/auth.routes");
const customerRoutes = require("./routes/customer.routes");
const prestashopRoutes = require("./routes/prestashop.routes");
const productRoutes = require("./routes/product.routes");
const itemRoutes = require("./routes/item.routes");
const salesOrderRoutes = require("./routes/salesOrders.routes");
const invoiceRoutes = require("./routes/invoice.routes");
const desktimeRoutes = require("./routes/desktime.routes");
const callDataRoutes = require("./routes/callData.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const customerJourneyRoutes = require("./routes/journey.routes");
const recommendationRoutes = require("./routes/recommendations.routes");
const prestashopSyncService = require("./services/prestashopSyncService");
const customerTargetRoutes = require("./routes/customerTarget.routes");
const salesManagerRoutes = require("./routes/salesManager.routes");
const scraperRoutes = require("./routes/scraper.routes");
const dealsRoutes = require("./routes/deals.routes");
const menuRoutes = require("./routes/menu.routes");
const leadRoutes = require("./routes/lead.routes");
const taskRoutes = require("./routes/task.routes");
const QuotationRoutes = require("./routes/quotation.routes");
const salesAgentJourneyRoutes = require("./routes/salesAgentJourney.routes");
const applicationUsageRoutes = require("./routes/applicationUsage.routes");
const CartRoutes = require("./routes/carts.routes");
const SalesManagerDashboardRoutes = require("./routes/salesManagerDashboardRoutes");
const notificationRoutes = require("./routes/notification.routes");
const CustomerProductSalesRoutes = require("./routes/CustomerProductSales.routes");
const config = require("./services/config");
const desktimeJob = require("./jobs/desktimeJob");
const { linkDocumentsToAgents } = require("./migrateAgentReferences");
const { syncFromFeb21 } = require("./jobs/hubspotJob");
const { fetchCallsFromMay2UntilToday } = require("./jobs/mayScript");
// Initialize express app
const app = express();

// Schedule jobs/
//syncFromFeb21();
async function someFunction() {
  const result = await fetchCallsFromMay2UntilToday();
  console.log(`Found ${result.totalCalls} calls`);
}

// someFunction();
// Environment variables
const PORT = process.env.PORT || 5002;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/salesHalal";
const NODE_ENV = process.env.NODE_ENV || "development";

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://halalfoodsales.s3-website.eu-north-1.amazonaws.com",
    ],
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(helmet());

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`Created uploads directory at: ${uploadsDir}`);
} else {
  console.log(`Uploads directory exists at: ${uploadsDir}`);
}

// Logging
if (NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// Connect to MongoDB
mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    // // Initial sync on startup if enabled
    // if (config.prestashop.syncOnStartup) {
    //   prestashopSyncService.syncMenusFromAPI();
    // }

    // // Schedule periodic syncs if enabled
    // if (config.prestashop.enableScheduledSync) {
    //   prestashopSyncService.scheduleSync(config.prestashop.syncInterval);
    // }
    console.log("✅ Connected to MongoDB");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/prestashop", prestashopRoutes);
app.use("/api/products", productRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/sales-orders", salesOrderRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/desktime", desktimeRoutes);
app.use("/api/call-data", callDataRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/customer-journey", customerJourneyRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/customer-targets", customerTargetRoutes);
app.use("/api/sales-manager", salesManagerRoutes);
app.use("/api/scraper", scraperRoutes);
app.use("/api/deals", dealsRoutes);
app.use("/api/menu", menuRoutes); // Menu routes
app.use("/api/quotations", QuotationRoutes); // Quotation routes
app.use("/api/leads", leadRoutes); // Lead routes
app.use("/api/tasks", taskRoutes); // Task routes
app.use("/api/sales-agent-journey", salesAgentJourneyRoutes); // Sales agent journey routes
app.use("/api/application-usage", applicationUsageRoutes); // Application usage routes
app.use("/api/carts", CartRoutes); // Cart routes
app.use("/api/sales-manager-dashboard", SalesManagerDashboardRoutes); // Sales manager dashboard routes
app.use("/api/notifications", notificationRoutes);
app.use("/api/customer-product-sales", CustomerProductSalesRoutes);

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Internal Server Error",
    error: NODE_ENV === "development" ? err.message : "Something went wrong",
  });
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
  // Don't crash the server in production
  if (NODE_ENV === "development") {
    process.exit(1);
  }
});
