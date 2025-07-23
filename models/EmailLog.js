// models/EmailLog.js
const mongoose = require("mongoose");

const EmailLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  quotationDocEntry: {
    type: Number,
    required: true,
  },
  recipient: {
    type: String,
    required: true,
  },
  cc: {
    type: String,
  },
  subject: {
    type: String,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  type: {
    type: String,
    enum: ["quotation_email", "order_email", "invoice_email", "other"],
    default: "other",
  },
  messageId: {
    type: String,
  },
  status: {
    type: String,
    enum: ["sent", "delivered", "opened", "failed"],
    default: "sent",
  },
  errorMessage: {
    type: String,
  },
});

// Add an index for faster queries
EmailLogSchema.index({ quotationDocEntry: 1, timestamp: -1 });
EmailLogSchema.index({ user: 1, timestamp: -1 });
EmailLogSchema.index({ recipient: 1, timestamp: -1 });

module.exports = mongoose.model("EmailLog", EmailLogSchema);
