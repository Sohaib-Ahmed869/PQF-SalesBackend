const express = require("express");
const router = express.Router();
const {
  auth,
  checkRole,
  updateLastLogin,
  canManageUser,
} = require("../middleware/auth");
const authController = require("../controllers/auth.controller");

// Login route
router.post("/login", authController.login);

// Register user route (Admin can register sales manager and sales agent, Sales manager can register sales agent)
router.post("/register", auth, authController.register);

// Register Admin route
router.post("/register-admin", authController.registerAdmin);

// Get current user profile
router.get("/profile", auth, updateLastLogin, authController.getProfile);

// Update current user profile (limited fields)
router.put("/profile", auth, updateLastLogin, authController.updateProfile);

// Change password
router.put("/change-password", auth, authController.changePassword);

// Get users by role (admin and sales manager only)
router.get(
  "/users",
  auth,
  authController.getUsers
);

// Get specific user (admin or sales manager for their agents)
router.get("/users/:id", auth, authController.getUserById);

// Update user (admin for any user, sales manager for their agents)
router.put("/users/:id", auth, authController.updateUser);

// Reset user password (admin for any user, sales manager for their agents)
router.put("/reset-password/:id", auth, authController.resetPassword);

router.post("/importSalesAgents", auth, authController.importSalesAgents);

router.put("/setTarget/:id", auth, authController.setTarget);

// Routes
router.get("/users/:id/salesperformance",auth, authController.getSalesPerformance);
router.get("/users/:id/targethistory",auth, authController.getTargetHistory);
router.post("/users/:id/settarget", auth,authController.setMonthlyTarget);
router.get("/dashboard/sales",auth, authController.getSalesDashboard);
router.get(
  "/users/:id/salesperformance",
  auth,
  authController.getSalesPerformance
);
router.get("/users/:id/targethistory", auth, authController.getTargetHistory);
router.post(
  "/users/:id/settarget",
  auth,
  checkRole(["admin", "sales_manager"]),
  authController.setMonthlyTarget
);
router.get("/orders/agent/:id", auth, authController.getAgentOrdersByMonth);
router.get(
  "/dashboard/sales",
  auth,
  checkRole(["admin", "sales_manager"]),
  authController.getSalesDashboard
);
module.exports = router;
