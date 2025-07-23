// models/applicationUsage.model.js
const mongoose = require("mongoose");

// Define MongoDB Schema for Application Usage data
const applicationUsageSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, "Date is required"],
      index: true,
    },
    userId: {
      type: String,
      required: [true, "User ID is required"],
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      index: true,
    },
    userRoles: {
      type: String,
      trim: true,
    },
    group: {
      type: String,
      trim: true,
      index: true,
    },
    application: {
      type: String,
      required: [true, "Application name is required"],
      trim: true,
      index: true,
    },
    productivity: {
      type: String,
      required: [true, "Productivity classification is required"],
      index: true,
    },
    timeSpent: {
      type: String,
      required: [true, "Time spent is required"],
      trim: true,
    },
    timeSpentHours: {
      type: Number,
      required: [true, "Time spent in hours is required"],
    },
    metadata: {
      batchId: {
        type: String,
        index: true,
      },
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
      uploadedBy: String,
      originalFilename: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes for common queries
applicationUsageSchema.index({ userId: 1, date: 1 });
applicationUsageSchema.index({ group: 1, date: 1 });
applicationUsageSchema.index({ application: 1, date: 1 });
applicationUsageSchema.index({ "metadata.batchId": 1 });

// Static methods
applicationUsageSchema.statics.findByDateRange = function (
  startDate,
  endDate,
  options = {}
) {
  const query = {
    date: {
      $gte: startDate,
      $lte: endDate,
    },
  };

  if (options.userId) query.userId = options.userId;
  if (options.group) query.group = options.group;
  if (options.application) query.application = options.application;
  if (options.productivity) query.productivity = options.productivity;

  return this.find(query).sort({ date: 1 });
};

applicationUsageSchema.statics.findByUser = function (userId, limit = 100) {
  return this.find({ userId }).sort({ date: -1 }).limit(limit);
};

applicationUsageSchema.statics.findByApplication = function (
  application,
  limit = 100
) {
  return this.find({ application }).sort({ date: -1 }).limit(limit);
};

applicationUsageSchema.statics.getUserTopApplications = function (
  userId,
  startDate,
  endDate,
  limit = 10
) {
  return this.aggregate([
    {
      $match: {
        userId,
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$application",
        totalTimeHours: { $sum: "$timeSpentHours" },
        count: { $sum: 1 },
        productivity: { $first: "$productivity" },
      },
    },
    { $sort: { totalTimeHours: -1 } },
    { $limit: limit },
  ]);
};

// Create and export the model
const ApplicationUsage = mongoose.model(
  "ApplicationUsage",
  applicationUsageSchema
);

module.exports = ApplicationUsage;
