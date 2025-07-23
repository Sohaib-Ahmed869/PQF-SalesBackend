// models/desktime.model.js - MongoDB schema and model for DeskTime data
const mongoose = require("mongoose");
const timeParser = require("../utils/time-parser");

// Define MongoDB Schema for DeskTime data
const desktimeSchema = new mongoose.Schema(
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
    absence: {
      type: String,
      trim: true,
    },
    productiveTime: {
      type: String,
      trim: true,
    },
    unproductiveTime: {
      type: String,
      trim: true,
    },
    neutralTime: {
      type: String,
      trim: true,
    },
    totalDeskTime: {
      type: String,
      trim: true,
    },
    offlineTime: {
      type: String,
      trim: true,
    },
    privateTime: {
      type: String,
      trim: true,
    },
    arrived: {
      type: String,
      trim: true,
    },
    left: {
      type: String,
      trim: true,
    },
    late: {
      type: String,
      trim: true,
    },
    totalTimeAtWork: {
      type: String,
      trim: true,
    },
    idleTime: {
      type: String,
      trim: true,
    },
    extraHoursBeforeWork: {
      type: String,
      trim: true,
    },
    extraHoursAfterWork: {
      type: String,
      trim: true,
    },
    hourlyRate: {
      type: Number,
      default: 0,
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
    timestamps: true, // Adds createdAt and updatedAt fields
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes for common queries
desktimeSchema.index({ userId: 1, date: 1 });
desktimeSchema.index({ group: 1, date: 1 });
desktimeSchema.index({ "metadata.batchId": 1 });

// Virtual properties
desktimeSchema.virtual("productiveTimeHours").get(function () {
  return timeParser.parseTimeToHours(this.productiveTime);
});

desktimeSchema.virtual("unproductiveTimeHours").get(function () {
  return timeParser.parseTimeToHours(this.unproductiveTime);
});

desktimeSchema.virtual("totalDeskTimeHours").get(function () {
  return timeParser.parseTimeToHours(this.totalDeskTime);
});

desktimeSchema.virtual("productivityRatio").get(function () {
  const productive = timeParser.parseTimeToHours(this.productiveTime);
  const total = timeParser.parseTimeToHours(this.totalDeskTime);
  return total > 0 ? (productive / total) * 100 : 0;
});

// Instance methods
desktimeSchema.methods.getDailyEarnings = function () {
  const hoursWorked = timeParser.parseTimeToHours(this.totalTimeAtWork);
  return hoursWorked * this.hourlyRate;
};

// Static methods
desktimeSchema.statics.findByDateRange = function (
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

  return this.find(query).sort({ date: 1 });
};

desktimeSchema.statics.findByUser = function (userId, limit = 30) {
  return this.find({ userId }).sort({ date: -1 }).limit(limit);
};

desktimeSchema.statics.findByGroup = function (group, limit = 50) {
  return this.find({ group }).sort({ date: -1 }).limit(limit);
};

desktimeSchema.statics.findByBatchId = function (batchId) {
  return this.find({ "metadata.batchId": batchId });
};

// Model middleware (hooks)
desktimeSchema.pre("save", function (next) {
  // Additional validation or data transformation can be done here
  next();
});

// Create and export the model
const DeskTime = mongoose.model("DeskTime", desktimeSchema);

module.exports = DeskTime;
