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
 * @route   POST /api/prestashop/sync/menu
 * @desc    Manually trigger menu sync
 * @access  Admin only
 */
router.post(
  "/sync/menu",
  [auth, checkRole(["admin"]), updateLastLogin],
  prestashopController.syncMenuData
);

/**
 * @route   GET /api/prestashop/products
 * @desc    Get products with pagination and filtering
 * @access  Public
 */
router.get("/products", prestashopController.getProducts);

/**
 * @route   GET /api/prestashop/products/:id
 * @desc    Get a single product by ID
 * @access  Public
 */
router.get("/products/:id", prestashopController.getProductById);

/**
 * @route   GET /api/prestashop/products/category/:categoryId
 * @desc    Get products by category
 * @access  Public
 */
router.get(
  "/products/category/:categoryId",
  prestashopController.getProductsByCategory
);

/**
 * @route   POST /api/prestashop/sync/products
 * @desc    Manually trigger product sync
 * @access  Admin only
 */
router.post(
  "/sync/products",
  [auth, checkRole(["admin"]), updateLastLogin],
  prestashopController.syncProductData
);

/**
 * @route   POST /api/prestashop/sync/products/:id
 * @desc    Manually sync a specific product
 * @access  Admin only
 */
router.post(
  "/sync/products/:id",
  [auth, checkRole(["admin"]), updateLastLogin],
  prestashopController.syncSingleProduct
);

/**
 * @route   POST /api/prestashop/webhook
 * @desc    Webhook endpoint for PrestaShop to trigger sync
 * @access  Public (with optional webhook validation)
 */
router.post("/webhook", prestashopController.processWebhook);

/**
 * @route   GET /api/prestashop/status
 * @desc    Get sync status for menus and products
 * @access  Public
 */
router.get("/status", prestashopController.getSyncStatus);

/**
 * @route   GET /api/prestashop/test-api
 * @desc    Test PrestaShop API connection
 * @access  Admin only
 */
router.get(
  "/test-api",
  [auth, checkRole(["admin"]), updateLastLogin],
  prestashopController.testApiConnection
);

module.exports = router;
