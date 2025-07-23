// routes/task.routes.js
const express = require("express");
const router = express.Router();
const { auth, checkRole } = require("../middleware/auth");
const { handleTaskAttachment } = require("../utils/taskUploadMiddleware");

const taskController = require("../controllers/task.controller");

// Get all tasks (filtered by role permissions)
router.get("/", auth, taskController.getTasks);

// Add this route in your task routes file
router.post("/cart/:cartId", auth, taskController.createTaskFromCart);

router.post('/approve-quotation/:id', auth, taskController.approveQuotation);

router.get("/agent/:agentId", auth, taskController.getAgentTasks);

// Get tasks assigned to current user
router.get("/assigned", auth, taskController.getMyTasks);

// Get tasks created by current user
router.get("/created", auth, taskController.getCreatedTasks);

// Get task by ID
router.get("/:id", auth, taskController.getTaskById);

// Create a new task
router.post("/", auth, handleTaskAttachment, taskController.createTask);
// Update a task
router.put("/:id", auth, taskController.updateTask);

// Request approval for a task
router.post("/:id/request-approval", auth, taskController.requestApproval);

// Approve or reject a task
router.post("/:id/approve-reject", auth, taskController.approveOrRejectTask);

// Delete a task
router.delete("/:id", auth, taskController.deleteTask);

// Add these new routes
router.post("/:id/attachment", auth, taskController.uploadAttachment);
router.get("/:id/attachment", auth, taskController.getAttachmentUrl);
router.delete("/:id/attachment", auth, taskController.deleteAttachment);

module.exports = router;
