const Restaurant = require("../routes/restaurant");

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    // Get basic stats
    const totalRestaurants = await Restaurant.countDocuments();
    const locationCount = await Restaurant.distinct("location").then(
      (locations) => locations.length
    );

    // Get recently scraped restaurants
    const recentRestaurants = await Restaurant.find()
      .sort({ scrapedAt: -1 })
      .limit(5)
      .select("name rating location scrapedAt");

    // Get top rated restaurants
    const topRatedRestaurants = await Restaurant.find({
      rating: { $exists: true },
    })
      .sort({ rating: -1 })
      .limit(5)
      .select("name rating location");

    // Get restaurants with most menu items
    const restaurantsWithLargestMenus = await Restaurant.aggregate([
      {
        $project: {
          name: 1,
          location: 1,
          rating: 1,
          menuItemCount: {
            $reduce: {
              input: "$menu",
              initialValue: 0,
              in: { $add: ["$value", { $size: "$this.items" }] },
            },
          },
        },
      },
      { $sort: { menuItemCount: -1 } },
      { $limit: 5 },
    ]);

    // Get restaurant count by location
    const restaurantsByLocation = await Restaurant.aggregate([
      { $group: { _id: "$location", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRestaurants,
        locationCount,
        recentRestaurants,
        topRatedRestaurants,
        restaurantsWithLargestMenus,
        restaurantsByLocation,
      },
    });
  } catch (error) {
    console.error("Error generating dashboard stats:", error);
    res.status(500).json({
      success: false,
      message: "Error generating dashboard statistics",
      error: error.message,
    });
  }
};

// Get menu analytics
exports.getMenuAnalytics = async (req, res) => {
  try {
    // Get most common menu items
    const mostCommonMenuItems = await Restaurant.aggregate([
      { $unwind: "$menu" },
      { $unwind: "$menu.items" },
      {
        $group: {
          _id: { name: "$menu.items.name" },
          count: { $sum: 1 },
          averagePrice: {
            $avg: {
              $toDouble: {
                $replaceAll: {
                  input: {
                    $replaceAll: {
                      input: "$menu.items.price",
                      find: "€",
                      replacement: "",
                    },
                  },
                  find: ",",
                  replacement: ".",
                },
              },
            },
          },
          restaurants: { $addToSet: "$name" },
        },
      },
      { $match: { count: { $gt: 1 } } }, // Only items that appear in multiple restaurants
      { $sort: { count: -1 } },
      { $limit: 20 },
      {
        $project: {
          itemName: "$_id.name",
          occurrenceCount: "$count",
          averagePrice: "$averagePrice",
          restaurantCount: { $size: "$restaurants" },
          _id: 0,
        },
      },
    ]);

    // Get most common menu sections
    const mostCommonMenuSections = await Restaurant.aggregate([
      { $unwind: "$menu" },
      {
        $group: {
          _id: { name: "$menu.name" },
          count: { $sum: 1 },
          restaurants: { $addToSet: "$name" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 15 },
      {
        $project: {
          sectionName: "$_id.name",
          occurrenceCount: "$count",
          restaurantCount: { $size: "$restaurants" },
          _id: 0,
        },
      },
    ]);

    // Get distribution of menu sizes
    const menuSizeDistribution = await Restaurant.aggregate([
      {
        $project: {
          menuSize: {
            $reduce: {
              input: "$menu",
              initialValue: 0,
              in: { $add: ["$value", { $size: "$this.items" }] },
            },
          },
        },
      },
      {
        $bucket: {
          groupBy: "$menuSize",
          boundaries: [0, 10, 25, 50, 100, 200, 500],
          default: "500+",
          output: {
            count: { $sum: 1 },
            restaurants: { $push: { name: "$name", menuSize: "$menuSize" } },
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        mostCommonMenuItems,
        mostCommonMenuSections,
        menuSizeDistribution,
      },
    });
  } catch (error) {
    console.error("Error generating menu analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error generating menu analytics",
      error: error.message,
    });
  }
};

// Get price analytics
exports.getPriceAnalytics = async (req, res) => {
  try {
    // Extract numeric prices from menu items
    const priceStats = await Restaurant.aggregate([
      // Unwind menu array
      { $unwind: "$menu" },
      // Unwind items array
      { $unwind: "$menu.items" },
      // Filter out items without prices
      { $match: { "menu.items.price": { $exists: true, $ne: null } } },
      // Extract price as a number (removing € symbol and converting comma to period)
      {
        $addFields: {
          numericPrice: {
            $toDouble: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: "$menu.items.price",
                    find: "€",
                    replacement: "",
                  },
                },
                find: ",",
                replacement: ".",
              },
            },
          },
        },
      },
      // Filter out invalid prices
      { $match: { numericPrice: { $gt: 0 } } },
      // Group by restaurant
      {
        $group: {
          _id: "$_id",
          restaurantName: { $first: "$name" },
          location: { $first: "$location" },
          averagePrice: { $avg: "$numericPrice" },
          minPrice: { $min: "$numericPrice" },
          maxPrice: { $max: "$numericPrice" },
          itemCount: { $sum: 1 },
        },
      },
      // Add global stats
      {
        $group: {
          _id: null,
          restaurants: {
            $push: {
              id: "$_id",
              name: "$restaurantName",
              location: "$location",
              averagePrice: "$averagePrice",
              minPrice: "$minPrice",
              maxPrice: "$maxPrice",
              itemCount: "$itemCount",
            },
          },
          globalAveragePrice: { $avg: "$averagePrice" },
          globalMinPrice: { $min: "$minPrice" },
          globalMaxPrice: { $max: "$maxPrice" },
          totalItems: { $sum: "$itemCount" },
          restaurantCount: { $sum: 1 },
        },
      },
      // Sort restaurants by average price
      {
        $addFields: {
          restaurants: {
            $sortArray: { input: "$restaurants", sortBy: { averagePrice: -1 } },
          },
        },
      },
    ]);

    // Get price distribution by location
    const locationPriceStats = await Restaurant.aggregate([
      // Unwind menu array
      { $unwind: "$menu" },
      // Unwind items array
      { $unwind: "$menu.items" },
      // Filter out items without prices
      { $match: { "menu.items.price": { $exists: true, $ne: null } } },
      // Extract price as a number
      {
        $addFields: {
          numericPrice: {
            $toDouble: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: "$menu.items.price",
                    find: "€",
                    replacement: "",
                  },
                },
                find: ",",
                replacement: ".",
              },
            },
          },
        },
      },
      // Filter out invalid prices
      { $match: { numericPrice: { $gt: 0 } } },
      // Group by location
      {
        $group: {
          _id: "$location",
          averagePrice: { $avg: "$numericPrice" },
          minPrice: { $min: "$numericPrice" },
          maxPrice: { $max: "$numericPrice" },
          itemCount: { $sum: 1 },
          restaurantCount: { $addToSet: "$_id" },
        },
      },
      // Format results
      {
        $project: {
          location: "$_id",
          averagePrice: 1,
          minPrice: 1,
          maxPrice: 1,
          itemCount: 1,
          restaurantCount: { $size: "$restaurantCount" },
          _id: 0,
        },
      },
      // Sort by average price
      { $sort: { averagePrice: -1 } },
    ]);

    // Get price distribution by menu section
    const menuSectionPriceStats = await Restaurant.aggregate([
      // Unwind menu array
      { $unwind: "$menu" },
      // Unwind items array
      { $unwind: "$menu.items" },
      // Filter out items without prices
      { $match: { "menu.items.price": { $exists: true, $ne: null } } },
      // Extract price as a number
      {
        $addFields: {
          numericPrice: {
            $toDouble: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: "$menu.items.price",
                    find: "€",
                    replacement: "",
                  },
                },
                find: ",",
                replacement: ".",
              },
            },
          },
        },
      },
      // Filter out invalid prices
      { $match: { numericPrice: { $gt: 0 } } },
      // Group by menu section
      {
        $group: {
          _id: "$menu.name",
          averagePrice: { $avg: "$numericPrice" },
          minPrice: { $min: "$numericPrice" },
          maxPrice: { $max: "$numericPrice" },
          itemCount: { $sum: 1 },
        },
      },
      // Format results
      {
        $project: {
          section: "$_id",
          averagePrice: 1,
          minPrice: 1,
          maxPrice: 1,
          itemCount: 1,
          _id: 0,
        },
      },
      // Sort by average price
      { $sort: { averagePrice: -1 } },
      // Limit to top sections
      { $limit: 20 },
    ]);

    res.status(200).json({
      success: true,
      data: {
        globalStats: priceStats[0] || {
          globalAveragePrice: 0,
          globalMinPrice: 0,
          globalMaxPrice: 0,
          totalItems: 0,
          restaurantCount: 0,
          restaurants: [],
        },
        locationStats: locationPriceStats,
        menuSectionStats: menuSectionPriceStats,
      },
    });
  } catch (error) {
    console.error("Error generating price analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error generating price analytics",
      error: error.message,
    });
  }
};
