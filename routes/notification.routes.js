// routes/notification.routes.js
const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const notificationController = require("../controllers/notification.controller");

// Get user notifications
router.get("/", auth, notificationController.getNotifications);

// Get unread count
router.get("/unread-count", auth, notificationController.getUnreadCount);

// Mark notification as read
router.put("/:id/read", auth, notificationController.markAsRead);

// Mark all notifications as read
router.put("/mark-all-read", auth, notificationController.markAllAsRead);

module.exports = router;
