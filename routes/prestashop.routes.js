// routes/prestashopRoutes.js
const express = require("express");
const router = express.Router();
const prestashopController = require("../controllers/prestashop.controller");
const { auth, checkRole, updateLastLogin } = require("../middleware/auth");

/**
 * @route   GET /api/prestashop/menu
 * @desc    Get hierarchical menu tree
 * @access  Public
 */
router.get("/menu", prestashopController.getMenuTree);

/**
 * @route   GET /api/prestashop/menu-items
 * @desc    Get flat list of all menu items
 * @access  Public
 */
router.get("/menu-items", prestashopController.getMenuItems);

/**
 * @route   GET /api/prestashop/menu-items/:id
 * @desc    Get a single menu item by ID
 * @access  Public
 */
router.get("/menu-items/:id", prestashopController.getMenuItemById);

/**
 * @route   GET /api/prestashop/menu-items/:parentId/children
 * @desc    Get children of a menu item
 * @access  Public
 */
router.get(
  "/menu-items/:parentId/children",
  prestashopController.getMenuItemChildren
);

/**
 * @route   POST /api/prestashop/sync
 * @desc    Manually trigger menu sync
 * @access  Admin only
 */
router.post(
  "/sync",
  [auth, checkRole(["admin"]), updateLastLogin],
  prestashopController.syncMenuData
);

/**
 * @route   POST /api/prestashop/webhook
 * @desc    Webhook endpoint for PrestaShop to trigger sync
 * @access  Public (with optional webhook validation)
 */
router.post("/webhook", prestashopController.processWebhook);

module.exports = router;
