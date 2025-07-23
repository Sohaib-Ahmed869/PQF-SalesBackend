// controllers/menu.controller.js
const menuIngredientService = require("../services/openaiService");

/**
 * Extract ingredients from an array of menu items
 * @route POST /api/menu/extract-ingredients
 */
exports.extractMenuIngredients = async (req, res) => {
  try {
    const { menuItems, batchSize } = req.body;

    if (!menuItems || !Array.isArray(menuItems) || menuItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of menu items",
      });
    }

    // Validate menu items format
    for (const item of menuItems) {
      if (!item.name) {
        return res.status(400).json({
          success: false,
          message: "Each menu item must have at least a name property",
        });
      }
    }

    // Process the menu items
    const results = await menuIngredientService.extractIngredientsFromMenuItems(
      menuItems,
      batchSize || 10
    );

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("Extract menu ingredients error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to extract ingredients",
      error: error.message,
    });
  }
};

/**
 * Extract ingredients from a single menu item
 * @route POST /api/menu/extract-ingredient
 */
exports.extractSingleMenuItemIngredients = async (req, res) => {
  try {
    const menuItem = req.body;

    if (!menuItem || !menuItem.name) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a valid menu item with at least a name property",
      });
    }

    // Process the menu item
    const ingredients =
      await menuIngredientService.extractIngredientsFromSingleItem(menuItem);

    return res.status(200).json({
      success: true,
      data: {
        name: menuItem.name,
        ingredients,
      },
    });
  } catch (error) {
    console.error("Extract single menu item ingredients error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to extract ingredients",
      error: error.message,
    });
  }
};
