const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const LeadSchema = new Schema({
  // Basic info
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
  },
  phoneNumber: {
    type: String,
    trim: true,
  },
  company: {
    type: String,
    trim: true,
  },

  // Lead categorization
  status: {
    type: String,
    enum: ["new", "contacted", "qualified", "converted", "lost"],
    default: "new",
  },
  tags: [
    {
      type: String,
      enum: ["hot", "cold", "warm", "priority", "partner"],
    },
  ],

  // Lead ownership
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },

  // Lead details
  notes: {
    type: String,
  },

  // Follow-up tasks reference
  tasks: [
    {
      type: Schema.Types.ObjectId,
      ref: "Task",
    },
  ],

  // Timeline tracking
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  nextFollowUp: {
    type: Date,
  },
});

// Update timestamps before saving
LeadSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Create a text index for searching leads
LeadSchema.index({
  fullName: "text",
  email: "text",
  phoneNumber: "text",
  company: "text",
  notes: "text",
});

const Lead = mongoose.model("Lead", LeadSchema);
module.exports = Lead;
