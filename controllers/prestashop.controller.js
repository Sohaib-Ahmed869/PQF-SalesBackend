// controllers/prestashop.controller.js
const PrestaShopMenu = require("../models/Menu");
const PrestaShopProduct = require("../models/PrestaShopProduct");
const prestashopSyncService = require("../services/prestashopSyncService");
const config = require("../services/config");

/**
 * Controller for PrestaShop operations
 */
const prestashopController = {
  /**
   * Get hierarchical menu tree
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with menu tree
   */
  getMenuTree: async (req, res) => {
    try {
      const menuTree = await prestashopSyncService.getMenuTree();
      return res.status(200).json({
        success: true,
        data: menuTree,
      });
    } catch (error) {
      console.error("Error fetching menu tree:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch menu data",
        error: error.message,
      });
    }
  },

  /**
   * Get flat list of menu items
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with menu items
   */
  getMenuItems: async (req, res) => {
    try {
      const menuItems = await PrestaShopMenu.find({ active: true }).sort({
        id_parent: 1,
        position: 1,
      });
      return res.status(200).json({
        success: true,
        data: menuItems,
      });
    } catch (error) {
      console.error("Error fetching menu items:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch menu items",
        error: error.message,
      });
    }
  },

  /**
   * Manually sync menu data from PrestaShop
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with sync result
   */
  syncMenuData: async (req, res) => {
    try {
      // No need to check admin role here as it's handled by checkRole middleware
      const syncResult = await prestashopSyncService.syncMenusFromAPI();

      if (syncResult) {
        return res.status(200).json({
          success: true,
          message: "Menu synchronization completed successfully",
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Menu synchronization failed",
        });
      }
    } catch (error) {
      console.error("Error triggering menu sync:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to trigger menu sync",
        error: error.message,
      });
    }
  },

  /**
   * Process webhook from PrestaShop
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON acknowledgment response
   */
  processWebhook: async (req, res) => {
    try {
      console.log("Received PrestaShop webhook:", req.body.event_type);

      const result = await prestashopSyncService.handleWebhook(
        req.headers,
        req.body
      );

      if (result) {
        res
          .status(200)
          .json({ success: true, message: "Webhook processed successfully" });
      } else {
        res
          .status(500)
          .json({ success: false, message: "Error processing webhook" });
      }
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  /**
   * Get a single menu item by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with menu item
   */
  getMenuItemById: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Menu item ID is required",
        });
      }

      const menuItem = await PrestaShopMenu.findOne({ id_category: id });

      if (!menuItem) {
        return res.status(404).json({
          success: false,
          message: "Menu item not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: menuItem,
      });
    } catch (error) {
      console.error("Error fetching menu item:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch menu item",
        error: error.message,
      });
    }
  },

  /**
   * Get children of a menu item by parent ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with child menu items
   */
  getMenuItemChildren: async (req, res) => {
    try {
      const { parentId } = req.params;

      if (!parentId) {
        return res.status(400).json({
          success: false,
          message: "Parent ID is required",
        });
      }

      const childItems = await PrestaShopMenu.find({
        id_parent: parseInt(parentId),
        active: true,
      }).sort({ position: 1 });

      return res.status(200).json({
        success: true,
        data: childItems,
      });
    } catch (error) {
      console.error("Error fetching menu children:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch menu children",
        error: error.message,
      });
    }
  },

  /**
   * Get all products with pagination and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with products
   */
  getProducts: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      // Build query based on filters
      let query = { active: true };

      // Filter by category
      if (req.query.category) {
        query["categories.id_category"] = parseInt(req.query.category);
      }

      // Count total products
      const total = await PrestaShopProduct.countDocuments(query);

      // Get products
      const products = await PrestaShopProduct.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ id_product: 1 });

      return res.status(200).json({
        success: true,
        data: products,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error fetching products:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch products",
        error: error.message,
      });
    }
  },

  /**
   * Get single product by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with product
   */
  getProductById: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Product ID is required",
        });
      }

      const product = await PrestaShopProduct.findOne({
        id_product: parseInt(id),
      });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: product,
      });
    } catch (error) {
      console.error("Error fetching product:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch product",
        error: error.message,
      });
    }
  },

  /**
   * Get products by category ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with products
   */
  getProductsByCategory: async (req, res) => {
    try {
      const { categoryId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      if (!categoryId) {
        return res.status(400).json({
          success: false,
          message: "Category ID is required",
        });
      }

      // Query for products with the specified category
      const query = {
        active: true,
        "categories.id_category": parseInt(categoryId),
      };

      // Count total products
      const total = await PrestaShopProduct.countDocuments(query);

      // Get products
      const products = await PrestaShopProduct.find(query)
        .skip(skip)
        .limit(limit)
        .sort({ id_product: 1 });

      return res.status(200).json({
        success: true,
        data: products,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error(
        `Error fetching products for category ${req.params.categoryId}:`,
        error
      );
      return res.status(500).json({
        success: false,
        message: "Failed to fetch products by category",
        error: error.message,
      });
    }
  },

  /**
   * Manually sync product data from PrestaShop
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with sync result
   */
  syncProductData: async (req, res) => {
    try {
      // No need to check admin role here as it's handled by checkRole middleware
      console.log("Starting manual product sync");

      // Trigger the product sync in the background
      prestashopSyncService
        .syncProductsFromAPI()
        .then((result) => {
          console.log(`Product sync completed with result: ${result}`);
        })
        .catch((error) => {
          console.error("Error during product sync:", error);
        });

      // Immediately return a response
      return res.status(200).json({
        success: true,
        message: "Product sync started in the background",
      });
    } catch (error) {
      console.error("Error triggering product sync:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to trigger product sync",
        error: error.message,
      });
    }
  },

  /**
   * Manually sync a specific product by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with sync result
   */
  syncSingleProduct: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Product ID is required",
        });
      }

      const productId = parseInt(id);
      console.log(`Starting manual sync for product ${productId}`);

      const result = await prestashopSyncService.syncSingleProduct(productId);

      return res.status(200).json({
        success: true,
        message: `Product ${productId} sync ${
          result ? "completed successfully" : "failed"
        }`,
      });
    } catch (error) {
      console.error(`Error syncing product ${req.params.id}:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to sync product",
        error: error.message,
      });
    }
  },

  /**
   * Get sync status for both menus and products
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with sync status
   */
  getSyncStatus: async (req, res) => {
    try {
      // Get count of menus and products in the database
      const menuCount = await PrestaShopMenu.countDocuments();
      const productCount = await PrestaShopProduct.countDocuments();

      res.status(200).json({
        success: true,
        data: {
          config: {
            syncOnStartup: config.prestashop.syncOnStartup,
            enableScheduledSync: config.prestashop.enableScheduledSync,
            syncInterval: config.prestashop.syncInterval,
            syncProducts: config.prestashop.syncProducts,
          },
          stats: {
            menuCount,
            productCount,
            lastUpdate: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.error("Error fetching sync status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch sync status",
        error: error.message,
      });
    }
  },

  /**
   * Test PrestaShop API connection
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} JSON response with connection test result
   */
  testApiConnection: async (req, res) => {
    try {
      const result = await prestashopSyncService.testApiConnection();

      // Include configuration info (without sensitive values)
      const configInfo = {
        baseURL: config.prestashop.api.baseURL,
        apiKeyProvided: !!config.prestashop.api.key,
        defaultLanguageId: config.prestashop.defaultLanguageId,
        syncSettings: {
          syncOnStartup: config.prestashop.syncOnStartup,
          enableScheduledSync: config.prestashop.enableScheduledSync,
          syncInterval: config.prestashop.syncInterval,
          syncProducts: config.prestashop.syncProducts,
        },
      };

      if (result.success) {
        // Also test a product API call
        const productTestResult = await testProductAPIAccess();

        res.status(200).json({
          success: true,
          message: "PrestaShop API connection successful",
          config: configInfo,
          apiResult: result,
          productAPITest: productTestResult,
        });
      } else {
        res.status(500).json({
          success: false,
          message: "PrestaShop API connection failed",
          config: configInfo,
          apiResult: result,
        });
      }
    } catch (error) {
      console.error("API test error:", error);
      res.status(500).json({
        success: false,
        message: "Error testing API connection",
        error: error.message,
      });
    }
  },
};

// Helper function to test product API access
async function testProductAPIAccess() {
  try {
    // Check if we can access the products API
    const baseURL = config.prestashop.api.baseURL.endsWith("/")
      ? config.prestashop.api.baseURL.slice(0, -1)
      : config.prestashop.api.baseURL;

    const auth = {
      username: config.prestashop.api.key,
      password: "",
    };

    const axios = require("axios");
    const response = await axios.get(`${baseURL}/api/products`, {
      auth,
      params: {
        output_format: "JSON",
        limit: 1,
      },
      headers: {
        Accept: "application/json",
      },
      timeout: 5000, // 5 second timeout
    });

    return {
      success: true,
      status: response.status,
      productCount: response.data?.products?.length || 0,
    };
  } catch (error) {
    return {
      success: false,
      status: error.response?.status,
      error: error.message,
      data: error.response?.data,
    };
  }
}

module.exports = prestashopController;
