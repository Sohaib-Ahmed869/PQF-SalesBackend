const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CustomerSchema = new Schema({
  // SAP Data
  CardName: {
    type: String,
    required: true,
  },
  CardCode: {
    type: String,
    index: true, // Still index for performance
  },
  Email: {
    type: String,
  },
  // Extended contact info
  firstName: {
    type: String,
    trim: true,
  },
  lastName: {
    type: String,
    trim: true,
  },
  phoneNumber: {
    type: String,
    trim: true,
  },
  additionalPhoneNumbers: {
    type: [String],
    default: [],
  },
  // External System IDs
  hubspotId: {
    type: String,
    trim: true,
  },
  prestashopAcc: {
    type: String,
    trim: true,
  },
  // Assigned sales agent
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  contactOwnerName: {
    type: String,
    trim: true,
  },
  // Customer Type
  customerType: {
    type: String,
    enum: ["sap", "non-sap", "lead"],
    default: "non-sap",
  },
  // Additional fields
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  // Track customer status
  status: {
    type: String,
    enum: ["active", "inactive", "lead", "prospect"],
    default: "active",
  },
  marketingStatus: {
    type: String,
    enum: ["marketing-contact", "non-marketing-contact", "unsubscribed"],
    default: "marketing-contact",
  },
  notes: {
    type: String,
  },
  // Additional contact information
  additionalEmails: [String],
  company: {
    type: String,
    trim: true,
  },
  companyId: {
    type: String,
    trim: true,
  },
  lastActivityDate: {
    type: Date,
  },
  address: {
    street: {
      type: String,
      trim: true,
    },
    zipCode: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
      default: "France", // Default value since your examples seem to be in France
    },
  },
  outstandingBalance: {
    type: Number,
    default: 0,
  },
  // NEW SAP SYNC FIELDS
  // SAP Integration Status
  SyncedWithSAP: {
    type: Boolean,
    default: false,
  },
  LocalStatus: {
    type: String,
    enum: ["Created", "Synced", "SyncFailed"],
    default: "Created",
  },
  SyncErrors: {
    type: String,
  },
  LastSyncAttempt: {
    type: Date,
  },
  SAPSyncDisabled: {
    type: Boolean,
    default: false,
  },
});

// Update timestamps on save
CustomerSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Add text index for searching
CustomerSchema.index({
  CardName: "text",
  firstName: "text",
  lastName: "text",
  Email: "text",
  phoneNumber: "text",
  CardCode: "text",
  company: "text",
});

const Customer = mongoose.model("Customer", CustomerSchema);
module.exports = Customer;
