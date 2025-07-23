// services/menuIngredientService.js
const axios = require("axios");
require("dotenv").config();

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const Item = require("../models/item");

/**
 * Extract ingredients from an array of menu items
 * @param {Array} menuItems - Array of menu items with name, description, and price
 * @param {Number} batchSize - Number of items to process in each API call
 * @returns {Array} - Array of menu items with ingredients added
 */
exports.extractIngredientsFromMenuItems = async (menuItems, batchSize = 10) => {
  if (!menuItems || menuItems.length === 0) {
    throw new Error("No menu items provided");
  }

  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key is not configured");
  }

  // Divide items into batches to optimize API calls
  const batches = [];
  for (let i = 0; i < menuItems.length; i += batchSize) {
    batches.push(menuItems.slice(i, i + batchSize));
  }

  const results = [];

  // Process each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    try {
      console.log(
        `Processing batch ${i + 1} of ${batches.length} (${batch.length} items)`
      );

      // Construct prompt for this batch
      let prompt =
        "Extract all ingredients from each of these menu items. For each item, return a JSON object with the original 'name' and an 'ingredients' array. Return ONLY a JSON array of these objects:";

      batch.forEach((item, index) => {
        prompt += `\n\nItem ${index + 1}:`;
        prompt += `\nName: ${item.name}`;
        if (item.description) {
          prompt += `\nDescription: ${item.description}`;
        }
        prompt += `\nPrice: ${item.price}`;
      });

      // Call OpenAI API
      const response = await axios.post(
        OPENAI_API_URL,
        {
          model: "gpt-4", // Or use "gpt-3.5-turbo" for faster, cheaper results
          messages: [
            {
              role: "system",
              content:
                "You are a specialized food ingredient extraction system. Your job is to identify and list all ingredients mentioned in food menu items. When an item has no description, infer possible ingredients from the name. Return your response as a clean JSON array with no additional text.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.3, // Lower temperature for more consistent results
          max_tokens: 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      // Extract and parse the response
      const content = response.data.choices[0].message.content.trim();
      let batchResults;

      try {
        // Try to parse the direct response first
        if (content.startsWith("[") && content.endsWith("]")) {
          batchResults = JSON.parse(content);
        } else {
          // Try to extract JSON from the response if there's additional text
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            batchResults = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("Could not extract JSON from response");
          }
        }

        results.push(...batchResults);
      } catch (parseError) {
        console.error("Error parsing API response:", parseError);

        // Add failed items with error message
        batch.forEach((item) => {
          results.push({
            name: item.name,
            ingredients: ["Error: Could not parse ingredients"],
            error: true,
          });
        });
      }

      // Add a delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`Error processing batch ${i + 1}:`, error.message);

      // Add all items in the failed batch with error message
      batch.forEach((item) => {
        results.push({
          name: item.name,
          ingredients: ["Error: API request failed"],
          error: true,
        });
      });
    }
  }

  return results;
};

/**
 * Extract ingredients from a single menu item
 * @param {Object} menuItem - Menu item with name, description, and price
 * @returns {Array} - Array of ingredients
 */
exports.extractIngredientsFromSingleItem = async (menuItem) => {
  if (!menuItem) {
    throw new Error("No menu item provided");
  }

  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key is not configured");
  }

  try {
    // Construct prompt for this item
    let prompt =
      "Extract all ingredients from this menu item. Return ONLY a JSON array of ingredients with no additional text:";
    prompt += `\nName: ${menuItem.name}`;
    if (menuItem.description) {
      prompt += `\nDescription: ${menuItem.description}`;
    }
    prompt += `\nPrice: ${menuItem.price}`;

    // Call OpenAI API
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "You are a specialized food ingredient extraction system. Your job is to identify and list all ingredients mentioned in a food menu item. If there's no description, infer possible ingredients from the name. Return your response as a clean JSON array with no additional text.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Extract and parse the response
    const content = response.data.choices[0].message.content.trim();

    try {
      // Try to parse the direct response first
      if (content.startsWith("[") && content.endsWith("]")) {
        return JSON.parse(content);
      } else {
        // Try to extract JSON from the response if there's additional text
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not extract JSON from response");
        }
      }
    } catch (parseError) {
      console.error("Error parsing API response:", parseError);
      return ["Error: Could not parse ingredients"];
    }
  } catch (error) {
    console.error("Error calling OpenAI API:", error.message);
    return ["Error: API request failed"];
  }
};

/**
 * Extract ingredients from restaurant menu items
 * @param {Array} menuItems - Array of menu items with name, description, and price
 * @returns {Array} - Array of menu items with ingredients added
 */
exports.extractIngredientsFromMenu = async (menuItems) => {
  if (!menuItems || menuItems.length === 0) {
    throw new Error("No menu items provided");
  }

  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key is not configured");
  }

  try {
    // Construct prompt with menu items
    let prompt =
      "Extract all ingredients from these menu items. Return a JSON array where each item has the original 'name' and an 'ingredients' array:";

    menuItems.forEach((item, index) => {
      prompt += `\n\nItem ${index + 1}:`;
      prompt += `\nName: ${item.name}`;
      if (item.description) {
        prompt += `\nDescription: ${item.description}`;
      }
      if (item.price) {
        prompt += `\nPrice: ${item.price}`;
      }
    });

    // Call OpenAI API
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: "gpt-3.5-turbo", // Or use "gpt-4" for better results
        messages: [
          {
            role: "system",
            content:
              "You are a specialized food ingredient extraction system. Your job is to identify and list all ingredients mentioned in food menu items. When an item has no description, infer possible ingredients from the name. Return your response as a clean JSON array.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Extract and parse the response
    const content = response.data.choices[0].message.content.trim();
    let results;

    try {
      // Parse the JSON from the response
      if (content.startsWith("[") && content.endsWith("]")) {
        results = JSON.parse(content);
      } else {
        // Try to extract JSON if there's additional text
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          results = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not extract JSON from response");
        }
      }

      return results;
    } catch (parseError) {
      console.error("Error parsing API response:", parseError);
      throw new Error("Failed to parse ingredients response");
    }
  } catch (error) {
    console.error("Error extracting ingredients:", error);
    throw error;
  }
};

/**
 * Extract ingredients from restaurant menu items
 * @param {Array} menuItems - Array of menu items with name, description, and price
 * @returns {Array} - Array of menu items with ingredients added
 */
exports.extractIngredientsFromMenu = async (menuItems) => {
  if (!menuItems || menuItems.length === 0) {
    throw new Error("No menu items provided");
  }

  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key is not configured");
  }

  try {
    // Construct prompt with menu items
    let prompt =
      "Extract all ingredients from these menu items. Return a JSON array where each item has the original 'name' and an 'ingredients' array:";

    menuItems.forEach((item, index) => {
      prompt += `\n\nItem ${index + 1}:`;
      prompt += `\nName: ${item.name}`;
      if (item.description) {
        prompt += `\nDescription: ${item.description}`;
      }
      if (item.price) {
        prompt += `\nPrice: ${item.price}`;
      }
    });

    // Call OpenAI API
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: "gpt-3.5-turbo", // Or use "gpt-4" for better results
        messages: [
          {
            role: "system",
            content:
              "You are a specialized food ingredient extraction system. Your job is to identify and list all ingredients mentioned in food menu items. When an item has no description, infer possible ingredients from the name. Return your response as a clean JSON array.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Extract and parse the response
    const content = response.data.choices[0].message.content.trim();
    let results;

    try {
      // Parse the JSON from the response
      if (content.startsWith("[") && content.endsWith("]")) {
        results = JSON.parse(content);
      } else {
        // Try to extract JSON if there's additional text
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          results = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not extract JSON from response");
        }
      }

      return results;
    } catch (parseError) {
      console.error("Error parsing API response:", parseError);
      throw new Error("Failed to parse ingredients response");
    }
  } catch (error) {
    console.error("Error extracting ingredients:", error);
    throw error;
  }
};

/**
 * Match extracted ingredients with your product catalog in Item model
 * @param {Array} extractedItems - Array of menu items with extracted ingredients
 * @returns {Object} - Matching results and sales opportunities
 */
exports.matchIngredientsWithItems = async (extractedItems) => {
  try {
    // Get all items from your database
    const allItems = await Item.find({
      Valid: "tYES",
      SalesItem: "tYES",
      Frozen: "tNO",
    })
      .select(
        "ItemCode ItemName ForeignName ItemsGroupCode MaterialType ItemPrices U_SubCategory"
      )
      .lean();

    if (!allItems || allItems.length === 0) {
      throw new Error("No products found in database");
    }

    // Create a map of your products for matching
    const productMap = new Map();

    // Manually add ingredients for each product based on name and category
    // This is a placeholder - you would need to update this with actual ingredient data
    // or add an ingredients field to your Item model
    allItems.forEach((item) => {
      // Create a normalized set of potential ingredients based on name
      const name = item.ItemName ? item.ItemName.toLowerCase() : "";
      const foreignName = item.ForeignName
        ? item.ForeignName.toLowerCase()
        : "";
      const category = item.U_SubCategory
        ? item.U_SubCategory.toLowerCase()
        : "";

      // Extract potential ingredient keywords from the product name
      let keywords = [];

      // Add name parts as keywords
      if (name) {
        keywords = keywords.concat(name.split(/\s+/));
      }

      // Add foreign name parts as keywords
      if (foreignName) {
        keywords = keywords.concat(foreignName.split(/\s+/));
      }

      // Add category as a keyword
      if (category) {
        keywords.push(category);
      }

      // Filter out common words that aren't ingredients
      const commonWords = [
        "and",
        "with",
        "the",
        "or",
        "in",
        "of",
        "by",
        "for",
        "a",
        "an",
      ];
      keywords = keywords.filter(
        (word) => !commonWords.includes(word) && word.length > 2
      );

      // Get price from first price list (if available)
      let price = 0;
      if (item.ItemPrices && item.ItemPrices.length > 0) {
        price = item.ItemPrices[0].Price || 0;
      }

      // Store the product with its keywords
      productMap.set(item.ItemCode, {
        ...item,
        keywords: [...new Set(keywords)], // Remove duplicates
        price,
      });
    });

    // Process each extracted menu item
    const results = extractedItems.map((item) => {
      const matches = [];
      const matchedProducts = new Set();

      if (item.ingredients && Array.isArray(item.ingredients)) {
        // For each ingredient, find matching products
        item.ingredients.forEach((ingredient) => {
          const lowerIngredient = ingredient.toLowerCase().trim();

          // Check each product's keywords for matches
          productMap.forEach((product, itemCode) => {
            // Skip if already matched
            if (matchedProducts.has(itemCode)) return;

            let isMatch = false;
            let matchType = "";

            // Check for exact matches first
            if (product.keywords.includes(lowerIngredient)) {
              isMatch = true;
              matchType = "exact";
            }
            // Then check for partial matches
            else {
              for (const keyword of product.keywords) {
                if (
                  lowerIngredient.includes(keyword) ||
                  keyword.includes(lowerIngredient)
                ) {
                  isMatch = true;
                  matchType = "partial";
                  break;
                }
              }
            }

            if (isMatch) {
              matchedProducts.add(itemCode);
              matches.push({
                ingredient: ingredient,
                matchType: matchType,
                product: {
                  id: product.ItemCode,
                  name: product.ItemName,
                  foreignName: product.ForeignName,
                  category: product.U_SubCategory,
                  price: product.price,
                },
              });
            }
          });
        });
      }

      return {
        menuItem: item.name,
        ingredients: item.ingredients || [],
        matches,
        potentialSales: matches.length > 0,
      };
    });

    // Aggregate sales opportunities
    const productsMatchCount = {};

    results.forEach((result) => {
      result.matches.forEach((match) => {
        const productId = match.product.id;
        productsMatchCount[productId] =
          (productsMatchCount[productId] || 0) + 1;
      });
    });

    // Create top matches array
    const topMatches = [];

    Object.keys(productsMatchCount).forEach((productId) => {
      const count = productsMatchCount[productId];
      const matchInfo = results
        .flatMap((r) => r.matches)
        .find((m) => m.product.id === productId);

      if (matchInfo) {
        topMatches.push({
          product: matchInfo.product,
          matchCount: count,
          percentageOfMenu:
            ((count / extractedItems.length) * 100).toFixed(2) + "%",
        });
      }
    });

    // Sort by match count (highest first)
    topMatches.sort((a, b) => b.matchCount - a.matchCount);

    return {
      menuItems: results,
      salesOpportunities: topMatches.slice(0, 10), // Top 10 opportunities
      totalMenuItems: extractedItems.length,
      totalMatches: Object.keys(productsMatchCount).length,
    };
  } catch (error) {
    console.error("Error matching ingredients with items:", error);
    throw error;
  }
};
