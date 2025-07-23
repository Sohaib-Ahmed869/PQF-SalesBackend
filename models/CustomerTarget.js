// models/CustomerTarget.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CustomerTargetSchema = new Schema(
  {
    cardCode: {
      type: String,
      required: [true, "Customer code is required"],
      trim: true,
    },
    cardName: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
    },
    targetAmount: {
      type: Number,
      required: [true, "Target amount is required"],
      min: 0,
    },
    // Instead of a deadline, we'll use a recurring monthly target model
    isRecurring: {
      type: Boolean,
      default: true,
    },
    // Period - monthly, quarterly, yearly
    period: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly",
    },
    // First day of the current period
    currentPeriodStart: {
      type: Date,
      default: function () {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
      },
    },
    // Last day of the current period
    currentPeriodEnd: {
      type: Date,
      default: function () {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
      },
    },
    // Keep the original deadline field for compatibility but it's not primary anymore
    deadline: {
      type: Date,
      default: function () {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
      },
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    achievedAmount: {
      type: Number,
      default: 0,
    },
    achievementRate: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "completed", "expired", "paused"],
      default: "active",
    },
    salesAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sales agent is required"],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    clientExistingAverage: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
    },
    transactions: [
      {
        transactionId: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: "transactions.transactionType",
        },
        transactionType: {
          type: String,
          enum: ["SalesOrder", "Invoice"],
          default: "Invoice",
        },
        docEntry: Number,
        docTotal: Number,
        docDate: Date,
        docType: {
          type: String,
          enum: ["order", "invoice"],
          default: "invoice",
        },
      },
    ],

    // Add field to track calculation method
    achievementSource: {
      type: String,
      enum: ["orders", "invoices"],
      default: "invoices",
    },

    // Add field to track last recalculation
    lastRecalculated: {
      type: Date,
      default: Date.now,
    },
    orders: [
      {
        orderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "SalesOrder",
        },
        docEntry: Number,
        docTotal: Number,
        docDate: Date,
      },
    ],
    // New field to store historical performance data
    historicalPerformance: [
      {
        period: String, // e.g., "2023-01" for January 2023
        targetAmount: Number,
        achievedAmount: Number,
        achievementRate: Number,
      },
    ],
  },
  { timestamps: true }
);

// Helper method to get the current ongoing target amount
CustomerTargetSchema.methods.getCurrentTargetAmount = function () {
  return this.targetAmount;
};

// Helper method to reset target for a new period
CustomerTargetSchema.methods.startNewPeriod = function () {
  // Store the current period's performance in history
  this.historicalPerformance.push({
    period: `${this.currentPeriodStart.getFullYear()}-${String(
      this.currentPeriodStart.getMonth() + 1
    ).padStart(2, "0")}`,
    targetAmount: this.targetAmount,
    achievedAmount: this.achievedAmount,
    achievementRate: this.achievementRate,
  });

  // Calculate the new period dates
  const now = new Date();

  if (this.period === "monthly") {
    this.currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    this.currentPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (this.period === "quarterly") {
    const quarter = Math.floor(now.getMonth() / 3);
    this.currentPeriodStart = new Date(now.getFullYear(), quarter * 3, 1);
    this.currentPeriodEnd = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
  } else if (this.period === "yearly") {
    this.currentPeriodStart = new Date(now.getFullYear(), 0, 1);
    this.currentPeriodEnd = new Date(now.getFullYear(), 11, 31);
  }

  // Reset the current period's achievements
  this.achievedAmount = 0;
  this.achievementRate = 0;

  // Update the deadline for compatibility with existing code
  this.deadline = this.currentPeriodEnd;

  return this;
};

// Pre-save middleware to calculate achievement rate
CustomerTargetSchema.pre("save", function (next) {
  if (this.targetAmount > 0) {
    this.achievementRate = (this.achievedAmount / this.targetAmount) * 100;
  }
  next();
});

module.exports = mongoose.model("CustomerTarget", CustomerTargetSchema);
