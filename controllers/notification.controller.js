// controllers/notification.controller.js
const NotificationService = require("../utils/notificationService");

exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notifications = await NotificationService.getUserNotifications(
      req.user._id,
      parseInt(limit),
      skip
    );

    const unreadCount = await NotificationService.getUnreadCount(req.user._id);

    res.json({
      success: true,
      data: notifications,
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message,
    });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    await NotificationService.markAsRead(id, req.user._id);

    res.json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Error marking notification as read",
      error: error.message,
    });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    await NotificationService.markAllAsRead(req.user._id);

    res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({
      success: false,
      message: "Error marking all notifications as read",
      error: error.message,
    });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user._id);

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Error getting unread count:", error);
    res.status(500).json({
      success: false,
      message: "Error getting unread count",
      error: error.message,
    });
  }
};
