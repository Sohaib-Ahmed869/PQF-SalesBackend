// routes/itemRoutes.js
const express = require("express");
const router = express.Router();
const itemController = require("../controllers/item.controller");

// @route   GET /api/items
// @desc    Get all items with pagination
// @access  Public
router.get("/", itemController.getAllItems);

// @route   GET /api/items/available
// @desc    Get all available items (with stock > 0)
// @access  Public
router.get("/available", itemController.getAvailableItems);

// @route   GET /api/items/search
// @desc    Search items by name or code
// @access  Public
router.get("/search", itemController.searchItems);

// @route   GET /api/items/price
// @desc    Get items by price range
// @access  Public
router.get("/price", itemController.getItemsByPriceRange);

// @route   GET /api/items/warehouse/:warehouseCode
// @desc    Get items by warehouse
// @access  Public
router.get("/warehouse/:warehouseCode", itemController.getItemsByWarehouse);

// @route   GET /api/items/:id
// @desc    Get single item by ID
// @access  Public
router.get("/:id", itemController.getItemById);

// @route   POST /api/items
// @desc    Create a new item
// @access  Private (typically would have auth middleware)
router.post("/", itemController.createItem);

// @route   PUT /api/items/:id
// @desc    Update an item
// @access  Private
router.put("/:id", itemController.updateItem);

// @route   PATCH /api/items/stock
// @desc    Update stock levels
// @access  Private
router.patch("/stock", itemController.updateStock);

module.exports = router;
