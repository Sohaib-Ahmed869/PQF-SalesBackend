// controllers/itemController.js
const Item = require("../models/item");

// Get all items with pagination
exports.getAllItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    //only get the items where Valid = tYes

    const items = await Item.find({ Valid: "tYES" }).skip(skip).limit(limit);

    const total = await Item.countDocuments();

    res.status(200).json({
      success: true,
      count: items.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: items,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Get single item by ID
exports.getItemById = async (req, res) => {
  try {
    const item = await Item.findOne({ ItemCode: req.params.id });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: `Item with code ${req.params.id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Get all available items (with stock > 0)
exports.getAvailableItems = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const items = await Item.findAvailable().skip(skip).limit(limit);

    const total = await Item.countDocuments({ QuantityOnStock: { $gt: 0 } });

    res.status(200).json({
      success: true,
      count: items.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: items,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Get items by warehouse
exports.getItemsByWarehouse = async (req, res) => {
  try {
    const warehouseCode = req.params.warehouseCode;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const items = await Item.find({
      "ItemWarehouseInfoCollection.WarehouseCode": warehouseCode,
      "ItemWarehouseInfoCollection.InStock": { $gt: 0 },
    })
      .skip(skip)
      .limit(limit);

    const total = await Item.countDocuments({
      "ItemWarehouseInfoCollection.WarehouseCode": warehouseCode,
      "ItemWarehouseInfoCollection.InStock": { $gt: 0 },
    });

    res.status(200).json({
      success: true,
      count: items.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: items,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Search items by name or code
exports.searchItems = async (req, res) => {
  try {
    const searchTerm = req.query.q;

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        message: "Please provide a search term",
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    //only get the items where Valid = tYes

    const items = await Item.find({
      Valid: "tYES",
      $or: [
        { ItemCode: { $regex: searchTerm, $options: "i" } },
        { ItemName: { $regex: searchTerm, $options: "i" } },
        { ForeignName: { $regex: searchTerm, $options: "i" } },
      ],
    })
      .skip(skip)
      .limit(limit);

    const total = await Item.countDocuments({
      $or: [
        { ItemCode: { $regex: searchTerm, $options: "i" } },
        { ItemName: { $regex: searchTerm, $options: "i" } },
        { ForeignName: { $regex: searchTerm, $options: "i" } },
      ],
    });

    res.status(200).json({
      success: true,
      count: items.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: items,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Get items by price range
exports.getItemsByPriceRange = async (req, res) => {
  try {
    const minPrice = parseFloat(req.query.minPrice) || 0;
    const maxPrice = parseFloat(req.query.maxPrice) || Number.MAX_SAFE_INTEGER;
    const priceList = parseInt(req.query.priceList) || 1; // Default to price list 1

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const items = await Item.find({
      ItemPrices: {
        $elemMatch: {
          PriceList: priceList,
          Price: { $gte: minPrice, $lte: maxPrice },
        },
      },
    })
      .skip(skip)
      .limit(limit);

    const total = await Item.countDocuments({
      ItemPrices: {
        $elemMatch: {
          PriceList: priceList,
          Price: { $gte: minPrice, $lte: maxPrice },
        },
      },
    });

    res.status(200).json({
      success: true,
      count: items.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: items,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Create a new item (for synchronizing from SAP B1)
exports.createItem = async (req, res) => {
  try {
    const newItem = new Item(req.body);
    await newItem.save();

    res.status(201).json({
      success: true,
      data: newItem,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "This item already exists",
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Update an item
exports.updateItem = async (req, res) => {
  try {
    const item = await Item.findOneAndUpdate(
      { ItemCode: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: `Item with code ${req.params.id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Update stock levels
exports.updateStock = async (req, res) => {
  try {
    const { ItemCode, WarehouseCode, NewQuantity } = req.body;

    if (!ItemCode || !WarehouseCode || NewQuantity === undefined) {
      return res.status(400).json({
        success: false,
        message: "Please provide ItemCode, WarehouseCode and NewQuantity",
      });
    }

    const item = await Item.findOne({ ItemCode });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: `Item with code ${ItemCode} not found`,
      });
    }

    // Find the warehouse in the collection
    const warehouseIndex = item.ItemWarehouseInfoCollection.findIndex(
      (wh) => wh.WarehouseCode === WarehouseCode
    );

    if (warehouseIndex === -1) {
      // If warehouse not found, add it
      item.ItemWarehouseInfoCollection.push({
        WarehouseCode,
        InStock: NewQuantity,
      });
    } else {
      // Update existing warehouse stock
      item.ItemWarehouseInfoCollection[warehouseIndex].InStock = NewQuantity;
    }

    // Update the total stock
    item.QuantityOnStock = item.ItemWarehouseInfoCollection.reduce(
      (total, wh) => total + wh.InStock,
      0
    );

    await item.save();

    res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};
