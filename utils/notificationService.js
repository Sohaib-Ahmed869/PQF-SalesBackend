// utils/notificationService.js
const Notification = require("../models/Notification");

class NotificationService {
  static async createNotification({
    recipient,
    sender,
    type,
    title,
    message,
    relatedTask = null,
    relatedLead = null,
  }) {
    try {
      // Don't create notification if sender and recipient are the same
      if (sender.toString() === recipient.toString()) {
        return null;
      }

      const notification = new Notification({
        recipient,
        sender,
        type,
        title,
        message,
        relatedTask,
        relatedLead,
      });

      await notification.save();
      return notification;
    } catch (error) {
      console.error("Error creating notification:", error);
      throw error;
    }
  }

  static async createTaskAssignedNotification(task, assignedBy) {
    const title = "New Task Assigned";
    const message = `You have been assigned a new task: "${task.title}"`;

    return this.createNotification({
      recipient: task.assignedTo,
      sender: assignedBy,
      type: "task_assigned",
      title,
      message,
      relatedTask: task._id,
      relatedLead: task.leadId,
    });
  }

  static async createTaskUpdatedNotification(
    task,
    updatedBy,
    previousAssignee = null
  ) {
    // If task was reassigned, notify both old and new assignee
    const notifications = [];

    if (
      previousAssignee &&
      previousAssignee.toString() !== task.assignedTo.toString()
    ) {
      // Notify previous assignee
      notifications.push(
        this.createNotification({
          recipient: previousAssignee,
          sender: updatedBy,
          type: "task_updated",
          title: "Task Reassigned",
          message: `Task "${task.title}" has been reassigned to someone else`,
          relatedTask: task._id,
        })
      );

      // Notify new assignee
      notifications.push(
        this.createNotification({
          recipient: task.assignedTo,
          sender: updatedBy,
          type: "task_assigned",
          title: "New Task Assigned",
          message: `You have been assigned a task: "${task.title}"`,
          relatedTask: task._id,
        })
      );
    } else {
      // Regular update notification
      notifications.push(
        this.createNotification({
          recipient: task.assignedTo,
          sender: updatedBy,
          type: "task_updated",
          title: "Task Updated",
          message: `Task "${task.title}" has been updated`,
          relatedTask: task._id,
        })
      );
    }

    return Promise.all(notifications);
  }

  static async createTaskStatusNotification(task, updatedBy, newStatus) {
    let title, message, type;

    switch (newStatus) {
      case "completed":
        title = "Task Completed";
        message = `Task "${task.title}" has been completed`;
        type = "task_completed";
        break;
      case "pending_approval":
        title = "Task Awaiting Approval";
        message = `Task "${task.title}" is awaiting your approval`;
        type = "task_updated";
        break;
      case "approved":
        title = "Task Approved";
        message = `Your task "${task.title}" has been approved`;
        type = "task_approved";
        break;
      case "rejected":
        title = "Task Rejected";
        message = `Your task "${task.title}" has been rejected`;
        type = "task_rejected";
        break;
      default:
        title = "Task Status Changed";
        message = `Task "${task.title}" status changed to ${newStatus}`;
        type = "task_updated";
    }

    // Notify task creator if status changed by assignee
    if (newStatus === "pending_approval") {
      return this.createNotification({
        recipient: task.createdBy,
        sender: updatedBy,
        type,
        title,
        message,
        relatedTask: task._id,
      });
    }

    // Notify assignee for other status changes
    return this.createNotification({
      recipient: task.assignedTo,
      sender: updatedBy,
      type,
      title,
      message,
      relatedTask: task._id,
    });
  }

  static async markAsRead(notificationId, userId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isRead: true },
      { new: true }
    );
  }

  static async markAllAsRead(userId) {
    return Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );
  }

  static async getUserNotifications(userId, limit = 20, skip = 0) {
    return Notification.find({ recipient: userId })
      .populate("sender", "firstName lastName")
      .populate("relatedTask", "title")
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();
  }

  static async getUnreadCount(userId) {
    return Notification.countDocuments({ recipient: userId, isRead: false });
  }
}

module.exports = NotificationService;
