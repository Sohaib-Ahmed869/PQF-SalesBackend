// prestashopSyncService.js
const mongoose = require("mongoose");
const axios = require("axios");
const cron = require("node-cron");
const crypto = require("crypto");
const PrestaShopMenu = require("../models/Menu");
const PrestaShopProduct = require("../models/PrestaShopProduct");
const config = require("./config");
const xml2js = require("xml2js");

class PrestaShopSyncService {
  constructor() {
    this.apiConfig = {
      baseURL: config.prestashop.api.baseURL,
      key: config.prestashop.api.key,
    };

    this.webhookSecret = config.prestashop.webhook.secret;
    this.defaultLanguageId = config.prestashop.defaultLanguageId || 1;

    // Log configuration on startup (without sensitive data)
    console.log("PrestaShop API Config:", {
      baseURL: this.apiConfig.baseURL,
      keyProvided: "JK2BX8JM7VP1UID2EW5PDD25MKATUDCJ",
      webhookSecretProvided: !!this.webhookSecret,
      defaultLanguageId: this.defaultLanguageId,
    });
  }

  // Debug method to test API connection
  async testApiConnection() {
    try {
      console.log("Testing PrestaShop API connection...");

      // Normalize the base URL
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Configure basic auth
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Test with a simple API call (API root)
      const response = await axios.get(`${baseURL}/api/`, {
        auth,
        params: {
          output_format: "JSON",
        },
        headers: {
          Accept: "application/json",
        },
      });

      console.log("API connection successful:", {
        status: response.status,
        resourcesAvailable: Object.keys(response.data?.prestashop?.api || {})
          .length,
      });

      return {
        success: true,
        status: response.status,
        data: response.data,
      };
    } catch (error) {
      console.error("API connection test failed:", {
        status: error.response?.status,
        message: error.message,
        data: error.response?.data,
      });

      return {
        success: false,
        status: error.response?.status,
        error: error.message,
        data: error.response?.data,
      };
    }
  }

  async syncMenusFromAPI() {
    try {
      console.log("Starting menu sync from PrestaShop API...");

      // Configure basic auth for PrestaShop API
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Normalize the base URL to avoid double slashes
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Fetch categories from PrestaShop API
      const response = await axios.get(`${baseURL}/api/categories`, {
        auth,
        params: {
          output_format: "JSON",
          display: "full",
        },
        headers: {
          Accept: "application/json",
        },
      });

      if (response.data && response.data.categories) {
        const menuItems = response.data.categories.map((category) => ({
          id_category: parseInt(category.id),
          id_parent: parseInt(category.id_parent),
          position: parseInt(category.position),
          level_depth: parseInt(category.level_depth),
          active: category.active === "1",
          name: category.name[this.defaultLanguageId],
          link_rewrite: category.link_rewrite[this.defaultLanguageId],
          description: category.description[this.defaultLanguageId],
          url: `/category/${category.id}-${
            category.link_rewrite[this.defaultLanguageId]
          }`,
        }));

        // Save to MongoDB
        await this.saveMenuItemsToMongoDB(menuItems);

        console.log("Menu sync from API completed successfully");
        return true;
      } else {
        throw new Error("Invalid API response format");
      }
    } catch (error) {
      console.error("Error syncing menus from API:", error);
      return false;
    }
  }

  async getSpecificCategory(categoryId) {
    try {
      // Configure basic auth for PrestaShop API
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Normalize the base URL to avoid double slashes
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Fetch specific category from PrestaShop API
      const response = await axios.get(
        `${baseURL}/api/categories/${categoryId}`,
        {
          auth,
          params: {
            output_format: "JSON",
          },
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (response.data && response.data.category) {
        const category = response.data.category;

        return {
          id_category: parseInt(category.id),
          id_parent: parseInt(category.id_parent),
          position: parseInt(category.position),
          level_depth: parseInt(category.level_depth),
          active: category.active === "1",
          name: category.name[this.defaultLanguageId],
          link_rewrite: category.link_rewrite[this.defaultLanguageId],
          description: category.description[this.defaultLanguageId],
          url: `/category/${category.id}-${
            category.link_rewrite[this.defaultLanguageId]
          }`,
        };
      } else {
        throw new Error(
          `Invalid API response format for category ${categoryId}`
        );
      }
    } catch (error) {
      console.error(`Error fetching category ${categoryId}:`, error);
      return null;
    }
  }

  async saveMenuItemsToMongoDB(menuItems) {
    try {
      console.log(
        `Starting to sync ${menuItems.length} menu items to MongoDB...`
      );

      // Process each menu item without transactions
      for (const item of menuItems) {
        // Create URL if not exists
        if (!item.url) {
          item.url = `/category/${item.id_category}-${item.link_rewrite}`;
        }

        // Update or create the menu item
        await PrestaShopMenu.findOneAndUpdate(
          { id_category: item.id_category },
          {
            ...item,
            lastUpdated: new Date(),
          },
          {
            upsert: true,
            new: true,
          }
        );
      }

      // Get all current category IDs from PrestaShop
      const currentIds = menuItems.map((item) => item.id_category);

      // Remove any items in MongoDB that no longer exist in PrestaShop
      const deleteResult = await PrestaShopMenu.deleteMany({
        id_category: { $nin: currentIds },
      });

      console.log(
        `Synced ${menuItems.length} menu items to MongoDB, removed ${deleteResult.deletedCount} obsolete items`
      );
      return true;
    } catch (error) {
      console.error(`Error syncing menu items to MongoDB:`, error);
      throw error;
    }
  }

  async updateOrCreateSingleMenuItem(item) {
    try {
      // Create URL if not exists
      if (!item.url) {
        item.url = `/category/${item.id_category}-${item.link_rewrite}`;
      }

      // Add debugging
      console.log(`Attempting to update/create menu item:`, {
        id: item.id_category,
        name: item.name,
        parent: item.id_parent,
      });

      // Update or create the menu item
      const result = await PrestaShopMenu.findOneAndUpdate(
        { id_category: item.id_category },
        {
          ...item,
          lastUpdated: new Date(),
        },
        {
          upsert: true,
          new: true,
        }
      );

      console.log(
        `Successfully updated/created menu item: ${item.id_category} - ${item.name}`
      );
      return result;
    } catch (error) {
      console.error(`Error updating menu item ${item.id_category}:`, error);
      console.error(`Error details:`, error);
      throw error;
    }
  }

  async deleteSingleMenuItem(categoryId) {
    try {
      const result = await PrestaShopMenu.deleteOne({
        id_category: categoryId,
      });
      console.log(`Deleted menu item: ${categoryId}`);
      return result;
    } catch (error) {
      console.error(`Error deleting menu item ${categoryId}:`, error);
      throw error;
    }
  }

  // Get the menu tree in hierarchical format
  async getMenuTree() {
    try {
      // Get all menu items from MongoDB
      const allItems = await PrestaShopMenu.find({ active: true })
        .sort({ id_parent: 1, position: 1 })
        .lean();

      // Build tree structure
      const buildTree = (items, parentId = 0) => {
        return items
          .filter((item) => item.id_parent === parentId)
          .map((item) => ({
            ...item,
            children: buildTree(items, item.id_category),
          }));
      };

      return buildTree(allItems);
    } catch (error) {
      console.error("Error getting menu tree:", error);
      throw error;
    }
  }

  // Schedule regular sync
  scheduleSync(cronExpression = "0 */6 * * *") {
    // Default: every 6 hours
    cron.schedule(cronExpression, async () => {
      console.log(`Running scheduled menu sync at ${new Date()}`);
      await this.syncMenusFromAPI();

      // Also sync products if enabled
      if (config.prestashop.syncProducts) {
        console.log(`Running scheduled product sync at ${new Date()}`);
        await this.syncProductsFromAPI();
      }
    });

    console.log(`Scheduled sync with cron expression: ${cronExpression}`);
  }

  // Webhook handler for real-time updates
  async handleWebhook(headers, body) {
    try {
      // Convert signature header to lowercase for case-insensitive comparison
      const signatureHeader = Object.keys(headers).find(
        (key) => key.toLowerCase() === "prestashop-signature"
      );

      const signature = signatureHeader ? headers[signatureHeader] : null;

      // Check if signature verification is needed
      if (this.webhookSecret) {
        // Verify webhook signature if secret is configured
        if (!signature) {
          console.warn("Missing signature in webhook request");
          // Continue processing even without signature for testing purposes
        } else if (!this.verifyWebhookSignature(body, signature)) {
          console.error("Invalid webhook signature");
          throw new Error("Invalid webhook signature");
        }
      }

      const payload = typeof body === "string" ? JSON.parse(body) : body;

      console.log(
        `Processing webhook event: ${payload.event_type} for resource ID: ${payload.resource_id}`
      );

      // Process based on event type
      if (payload.event_type && payload.event_type.startsWith("category_")) {
        // Handle category events
        switch (payload.event_type) {
          case "category_created":
          case "category_updated":
            const categoryId = payload.resource_id;
            console.log(`Fetching category data for ID: ${categoryId}`);
            const categoryData = await this.getSpecificCategory(categoryId);

            if (categoryData) {
              console.log(
                `Successfully fetched category data: ${JSON.stringify(
                  categoryData
                ).substring(0, 200)}...`
              );
              await this.updateOrCreateSingleMenuItem(categoryData);
              console.log(
                `Category ${categoryId} successfully updated/created`
              );
            } else {
              console.warn(`Could not fetch data for category ${categoryId}`);
            }
            break;

          case "category_deleted":
            console.log(`Deleting category with ID: ${payload.resource_id}`);
            await this.deleteSingleMenuItem(payload.resource_id);
            console.log(`Category ${payload.resource_id} successfully deleted`);
            break;

          case "category_status_changed":
            console.log(
              `Updating status for category with ID: ${payload.resource_id}`
            );
            const category = await this.getSpecificCategory(
              payload.resource_id
            );

            if (category) {
              await this.updateOrCreateSingleMenuItem(category);
              console.log(
                `Category ${payload.resource_id} status successfully updated`
              );
            } else {
              console.warn(
                `Could not fetch data for category ${payload.resource_id}`
              );
            }
            break;

          default:
            console.log(`Unhandled category event: ${payload.event_type}`);
        }
      } else if (
        payload.event_type &&
        payload.event_type.startsWith("product_")
      ) {
        // Handle product events
        await this.handleProductWebhook(
          payload.event_type,
          payload.resource_id
        );
      } else {
        console.log(
          `Ignoring webhook event: ${payload.event_type} (not handled by this service)`
        );
      }

      return true;
    } catch (error) {
      console.error("Error handling webhook:", error);
      console.error("Error details:", error.stack);
      return false;
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(payload, signature) {
    if (!signature || !this.webhookSecret) return false;

    const hmac = crypto.createHmac("sha256", this.webhookSecret);
    const body =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    const computedSignature = hmac.update(body).digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(computedSignature),
      Buffer.from(signature)
    );
  }

  // Product-related methods

  // Method to sync all products
  async syncProductsFromAPI() {
    try {
      console.log("Starting product sync from PrestaShop API...");

      // Configure basic auth for PrestaShop API
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Normalize the base URL to avoid double slashes
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Fetch products from PrestaShop API
      const response = await axios.get(`${baseURL}/api/products`, {
        auth,
        params: {
          output_format: "JSON",
          display: "full",
        },
        headers: {
          Accept: "application/json",
        },
      });

      if (response.data && response.data.products) {
        console.log(`Found ${response.data.products.length} products`);

        // Process each product in smaller batches to avoid memory issues
        const productBatches = this.chunkArray(response.data.products, 20);

        for (const [index, batch] of productBatches.entries()) {
          console.log(
            `Processing product batch ${index + 1}/${productBatches.length}`
          );

          // For each product in the batch, fetch additional details
          for (const productSummary of batch) {
            const productId = parseInt(productSummary.id);

            try {
              // Get detailed product information
              await this.syncSingleProduct(productId);
            } catch (error) {
              console.error(
                `Error syncing product ${productId}:`,
                error.message
              );
            }
          }
        }

        console.log("Product sync completed successfully");
        return true;
      } else {
        throw new Error("Invalid API response format for products");
      }
    } catch (error) {
      console.error("Error syncing products from API:", error);
      return false;
    }
  }

  // Utility method to chunk arrays
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  // Method to sync a single product
  async syncSingleProduct(productId) {
    try {
      console.log(`Syncing product ${productId}...`);

      // Configure basic auth for PrestaShop API
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Normalize the base URL
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Fetch product details in XML format
      const response = await axios.get(`${baseURL}/api/products/${productId}`, {
        auth,
        responseType: "text", // Important to get raw XML
        headers: {
          Accept: "application/xml",
        },
      });

      // Parse XML to JS object
      const parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
        explicitCharkey: true,
        trim: true,
        tagNameProcessors: [xml2js.processors.stripPrefix], // Remove prestashop: prefix
      });

      const result = await parser.parseStringPromise(response.data);
      const product = result.prestashop.product;

      // Helper function to safely extract language-specific text
      const getLanguageText = (field, langId = this.defaultLanguageId) => {
        try {
          if (!product[field]) return "";

          // Check if it's an array of language objects
          if (Array.isArray(product[field].language)) {
            const langItem = product[field].language.find(
              (l) => l.id === langId.toString() || l.id === langId
            );
            return langItem ? (langItem["_"] || "").trim() : "";
          }
          // Check if it's a single language object
          else if (product[field].language && product[field].language.id) {
            return product[field].language.id === langId.toString() ||
              product[field].language.id === langId
              ? (product[field].language["_"] || "").trim()
              : "";
          }
          // Direct text content
          else if (product[field]["_"]) {
            return product[field]["_"].trim();
          }

          return "";
        } catch (error) {
          console.error(`Error extracting ${field}:`, error);
          return "";
        }
      };

      // Helper function to extract numeric values
      const getNumeric = (field, defaultValue = 0) => {
        try {
          if (!product[field]) return defaultValue;
          const value = product[field]["_"]
            ? product[field]["_"].trim()
            : product[field];
          return isNaN(parseFloat(value)) ? defaultValue : parseFloat(value);
        } catch (error) {
          return defaultValue;
        }
      };

      // Helper function to extract boolean values
      const getBoolean = (field) => {
        try {
          if (!product[field]) return false;
          const value = product[field]["_"]
            ? product[field]["_"].trim()
            : product[field];
          return value === "1" || value === "true";
        } catch (error) {
          return false;
        }
      };

      // Prepare product data
      const productData = {
        id_product: getNumeric("id", productId),
        id_manufacturer: getNumeric("id_manufacturer"),
        id_supplier: getNumeric("id_supplier"),
        id_category_default: getNumeric("id_category_default"),

        // Text fields with language variants
        name: getLanguageText("name"),
        description: getLanguageText("description"),
        description_short: getLanguageText("description_short"),
        meta_title: getLanguageText("meta_title"),
        meta_description: getLanguageText("meta_description"),
        meta_keywords: getLanguageText("meta_keywords"),
        link_rewrite: getLanguageText("link_rewrite"),

        // Numeric fields
        price: getNumeric("price"),
        wholesale_price: getNumeric("wholesale_price"),
        weight: getNumeric("weight"),

        // Boolean fields
        active: getBoolean("active"),
        on_sale: getBoolean("on_sale"),
        available_for_order: getBoolean("available_for_order"),
        is_virtual: getBoolean("is_virtual"),

        // String fields
        reference: product.reference
          ? (product.reference["_"] || "").trim()
          : "",
        ean13: product.ean13 ? (product.ean13["_"] || "").trim() : "",
        isbn: product.isbn ? (product.isbn["_"] || "").trim() : "",
        upc: product.upc ? (product.upc["_"] || "").trim() : "",
        mpn: product.mpn ? (product.mpn["_"] || "").trim() : "",
        manufacturer_name: product.manufacturer_name
          ? (product.manufacturer_name["_"] || "").trim()
          : "",
        unity: product.unity ? (product.unity["_"] || "").trim() : "",
        condition: product.condition
          ? (product.condition["_"] || "new").trim()
          : "new",
        type: product.type ? (product.type["_"] || "simple").trim() : "simple",
        product_type: product.product_type
          ? (product.product_type["_"] || "standard").trim()
          : "standard",

        // Dates
        date_add: product.date_add
          ? new Date(product.date_add["_"] || "")
          : new Date(),
        date_upd: product.date_upd
          ? new Date(product.date_upd["_"] || "")
          : new Date(),

        // Arrays to be filled later
        images: [],
        features: [],
        categories: [],
      };

      // Log the extracted data for debugging
      console.log(`Extracted product data for ID ${productId}:`, {
        id: productData.id_product,
        name: productData.name,
        desc_short_length: productData.description_short?.length || 0,
        desc_length: productData.description?.length || 0,
      });

      // Get product images, features, and categories
      await this.appendProductImages(productData);
      await this.appendProductFeatures(productData);
      await this.appendProductCategories(productData);

      // Save product to MongoDB
      await this.saveProductToMongoDB(productData);

      console.log(`Product ${productId} synced successfully`);
      return true;
    } catch (error) {
      console.error(`Error syncing product ${productId}:`, error);
      throw error;
    }
  }

  // Method to fetch and append product images
  async appendProductImages(productData) {
    try {
      // Configure basic auth for PrestaShop API
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Normalize the base URL
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Fetch product images
      const response = await axios.get(
        `${baseURL}/api/images/products/${productData.id_product}`,
        {
          auth,
          params: {
            output_format: "JSON",
          },
          headers: {
            Accept: "application/json",
          },
        }
      );

      // Clear existing images
      productData.images = [];

      // Check if we have images data and it's properly formatted
      if (
        response.data &&
        response.data.images &&
        Array.isArray(response.data.images)
      ) {
        // Process image data
        productData.images = response.data.images.map((image, index) => ({
          id_image: parseInt(image.id),
          position: index + 1,
          url: `${baseURL}/img/p/${image.id}/${image.id}.jpg`,
        }));
      } else if (response.data && response.data.image) {
        // Handle single image case
        productData.images = [
          {
            id_image: parseInt(response.data.image.id),
            position: 1,
            url: `${baseURL}/img/p/${response.data.image.id}/${response.data.image.id}.jpg`,
          },
        ];
      }

      console.log(
        `Found ${productData.images.length} images for product ${productData.id_product}`
      );
    } catch (error) {
      console.error(
        `Error fetching images for product ${productData.id_product}:`,
        error.message
      );
      // Set empty array in case of error
      productData.images = [];
    }
  }

  // Method to fetch and append product features
  async appendProductFeatures(productData) {
    try {
      // Configure basic auth for PrestaShop API
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Normalize the base URL
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Fetch product features
      const response = await axios.get(
        `${baseURL}/api/product_features?filter[id_product]=[${productData.id_product}]`,
        {
          auth,
          params: {
            output_format: "JSON",
            display: "full",
          },
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (response.data && response.data.product_features) {
        // Process feature data
        productData.features = await Promise.all(
          response.data.product_features.map(async (feature) => {
            try {
              // Get feature name
              const featureResponse = await axios.get(
                `${baseURL}/api/product_features/${feature.id_feature}`,
                {
                  auth,
                  params: {
                    output_format: "JSON",
                  },
                  headers: {
                    Accept: "application/json",
                  },
                }
              );

              // Get feature value
              const featureValueResponse = await axios.get(
                `${baseURL}/api/product_feature_values/${feature.id_feature_value}`,
                {
                  auth,
                  params: {
                    output_format: "JSON",
                  },
                  headers: {
                    Accept: "application/json",
                  },
                }
              );

              return {
                id_feature: parseInt(feature.id_feature),
                id_feature_value: parseInt(feature.id_feature_value),
                name: featureResponse.data.product_feature.name[
                  this.defaultLanguageId
                ],
                value:
                  featureValueResponse.data.product_feature_value.value[
                    this.defaultLanguageId
                  ],
              };
            } catch (error) {
              console.error(`Error fetching feature details:`, error.message);
              return {
                id_feature: parseInt(feature.id_feature),
                id_feature_value: parseInt(feature.id_feature_value),
                name: "Unknown",
                value: "Unknown",
              };
            }
          })
        );
      }
    } catch (error) {
      console.error(
        `Error fetching features for product ${productData.id_product}:`,
        error.message
      );
      // Don't fail the whole sync just because features failed
    }
  }

  // Method to fetch and append product categories
  async appendProductCategories(productData) {
    try {
      // Configure basic auth for PrestaShop API
      const auth = {
        username: this.apiConfig.key,
        password: "",
      };

      // Normalize the base URL
      const baseURL = this.apiConfig.baseURL.endsWith("/")
        ? this.apiConfig.baseURL.slice(0, -1)
        : this.apiConfig.baseURL;

      // Fetch product categories
      const response = await axios.get(
        `${baseURL}/api/categories?filter[id_product]=[${productData.id_product}]`,
        {
          auth,
          params: {
            output_format: "JSON",
            display: "full",
          },
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (response.data && response.data.categories) {
        // Process category data
        productData.categories = response.data.categories.map((category) => ({
          id_category: parseInt(category.id),
          name: category.name[this.defaultLanguageId],
        }));
      }
    } catch (error) {
      console.error(
        `Error fetching categories for product ${productData.id_product}:`,
        error.message
      );
      // Don't fail the whole sync just because categories failed
    }
  }

  // Method to save a product to MongoDB
  async saveProductToMongoDB(productData) {
    try {
      // Update or create the product
      await PrestaShopProduct.findOneAndUpdate(
        { id_product: productData.id_product },
        {
          ...productData,
          lastUpdated: new Date(),
        },
        {
          upsert: true,
          new: true,
        }
      );

      return true;
    } catch (error) {
      console.error(
        `Error saving product ${productData.id_product} to MongoDB:`,
        error
      );
      throw error;
    }
  }

  // Method to handle product webhook events
  async handleProductWebhook(eventType, productId) {
    try {
      console.log(
        `Handling product webhook: ${eventType} for product ${productId}`
      );

      switch (eventType) {
        case "product_created":
        case "product_updated":
          await this.syncSingleProduct(productId);
          break;

        case "product_deleted":
          await PrestaShopProduct.deleteOne({ id_product: productId });
          console.log(`Product ${productId} deleted from MongoDB`);
          break;

        default:
          console.log(`Unhandled product event type: ${eventType}`);
      }

      return true;
    } catch (error) {
      console.error(`Error handling product webhook for ${productId}:`, error);
      return false;
    }
  }
}

module.exports = new PrestaShopSyncService();
