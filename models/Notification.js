// models/Notification.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const NotificationSchema = new Schema({
  recipient: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: [
      "task_assigned",
      "task_updated",
      "task_completed",
      "task_approved",
      "task_rejected",
    ],
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  relatedTask: {
    type: Schema.Types.ObjectId,
    ref: "Task",
  },
  relatedLead: {
    type: Schema.Types.ObjectId,
    ref: "Lead",
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient queries
NotificationSchema.index({ recipient: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, isRead: 1 });

module.exports = mongoose.model("Notification", NotificationSchema);
