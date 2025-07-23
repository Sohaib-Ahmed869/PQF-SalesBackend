const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  role: {
    type: String,
    enum: ["admin", "sales_agent", "sales_manager", "data-tech_sales_agent", "data-tech_admin"],
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    trim: true,
    lowercase: true,
    unique: true,
    index: true,
  },
  firstName: {
    type: String,
    required: [true, "First name is required"],
    trim: true,
  },
  lastName: {
    type: String,
    required: [true, "Last name is required"],
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    required: [true, "Created date is required"],
  },
  deactivated: {
    type: Boolean,
    default: false,
  },
  // hubspot id only for sales agent
  hubspotId: {
    type: String,
    trim: true,
    sparse: true,
  },
  // target only for sales agent
  target: {
    type: Number,
    default: 0,
  },
  targetAchieved: {
    type: Number,
    default: 0,
  },
  salesHistory: [
    {
      month: {
        type: String,
        required: true,
      },
      year: {
        type: Number,
        required: true,
      },
      orderCount: {
        type: Number,
        default: 0,
      },
      totalValue: {
        type: Number,
        default: 0,
      },
      // Store individual order references
      orders: [
        {
          type: Schema.Types.ObjectId,
          ref: "SalesOrder",
        },
      ],
    },
  ],
  targetHistory: [
    {
      month: {
        type: String,
        required: true,
      },
      year: {
        type: Number,
        required: true,
      },
      target: {
        type: Number,
        default: 0,
      },
      achieved: {
        type: Number,
        default: 0,
      },
      // Percentage of target achieved
      achievementRate: {
        type: Number,
        default: 0,
      },
    },
  ],
  callsMade: {
    type: Number,
    default: 0,
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
  // Reference to the user who created this user (admin or sales manager)
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  // For sales agents, reference to their manager
  manager: {
    type: Schema.Types.ObjectId,
    ref: "User",
    // Required only for sales agents
    validate: {
      validator: function (v) {
        return this.role !== "sales_agent" || v !== undefined;
      },
      message: "Sales agents must have a manager assigned",
    },
  },
});

module.exports = mongoose.model("User", UserSchema);

