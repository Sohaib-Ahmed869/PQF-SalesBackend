// routes/menu.routes.js
const express = require("express");
const router = express.Router();
const menuController = require("../controllers/menu.controller");

/**
 * @route POST /api/menu/extract-ingredients
 * @desc Extract ingredients from multiple menu items
 * @access Public or Protected (depending on your requirements)
 */
router.post("/extract-ingredients", menuController.extractMenuIngredients);

/**
 * @route POST /api/menu/extract-ingredient
 * @desc Extract ingredients from a single menu item
 * @access Public or Protected (depending on your requirements)
 */
router.post(
  "/extract-ingredient",
  menuController.extractSingleMenuItemIngredients
);

module.exports = router;
