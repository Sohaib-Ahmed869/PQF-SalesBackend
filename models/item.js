// itemModel.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Define schema for ItemPrice
const ItemPriceSchema = new Schema({
  PriceList: { type: Number, required: true },
  Price: { type: Number, default: 0 },
  Currency: { type: String, default: "EUR" },
  AdditionalPrice1: { type: Number, default: 0 },
  AdditionalCurrency1: { type: String },
  AdditionalPrice2: { type: Number, default: 0 },
  AdditionalCurrency2: { type: String },
  BasePriceList: { type: Number },
  Factor: { type: Number, default: 1.0 },
  UoMPrices: { type: Array, default: [] },
});

// Define schema for ItemWarehouseInfo
const ItemWarehouseInfoSchema = new Schema({
  WarehouseCode: { type: String, required: true },
  InStock: { type: Number, default: 0 },
  Committed: { type: Number, default: 0 },
  Ordered: { type: Number, default: 0 },
  MinimalStock: { type: Number, default: 0 },
  MaximalStock: { type: Number, default: 0 },
  MinimalOrder: { type: Number, default: 0 },
  StandardAveragePrice: { type: Number, default: 0 },
  Locked: { type: String, enum: ["tYES", "tNO"], default: "tNO" },
  DefaultBin: { type: String },
  DefaultBinEnforced: { type: String, enum: ["tYES", "tNO"], default: "tNO" },
});

// Main Item Schema
const ItemSchema = new Schema(
  {
    // Basic identification
    ItemCode: { type: String, required: true, unique: true, index: true },
    ItemName: { type: String, required: true },
    ForeignName: { type: String },
    ItemsGroupCode: { type: Number },
    CustomsGroupCode: { type: Number },

    // Tax and sales info
    SalesVATGroup: { type: String },
    BarCode: { type: String },
    VatLiable: { type: String, enum: ["tYES", "tNO"], default: "tYES" },
    PurchaseItem: { type: String, enum: ["tYES", "tNO"], default: "tYES" },
    SalesItem: { type: String, enum: ["tYES", "tNO"], default: "tYES" },
    InventoryItem: { type: String, enum: ["tYES", "tNO"], default: "tYES" },

    // Supplier info
    Mainsupplier: { type: String },
    SupplierCatalogNo: { type: String },

    // Inventory management
    DesiredInventory: { type: Number, default: 0 },
    MinInventory: { type: Number, default: 0 },
    MaxInventory: { type: Number, default: 0 },

    // Additional properties
    Picture: { type: String },
    User_Text: { type: String },
    SerialNum: { type: String },

    // Commission info
    CommissionPercent: { type: Number, default: 0 },
    CommissionSum: { type: Number, default: 0 },
    CommissionGroup: { type: Number, default: 0 },

    // Classification
    TreeType: { type: String, default: "iNotATree" },
    AssetItem: { type: String, enum: ["tYES", "tNO"], default: "tNO" },

    // Identification codes
    DataExportCode: { type: String },
    Manufacturer: { type: Number },

    // Stock info
    QuantityOnStock: { type: Number, default: 0 },
    QuantityOrderedFromVendors: { type: Number, default: 0 },
    QuantityOrderedByCustomers: { type: Number, default: 0 },

    // Serial and batch management
    ManageSerialNumbers: {
      type: String,
      enum: ["tYES", "tNO"],
      default: "tNO",
    },
    ManageBatchNumbers: { type: String, enum: ["tYES", "tNO"], default: "tNO" },

    // Status flags
    Valid: { type: String, enum: ["tYES", "tNO"], default: "tYES" },
    ValidFrom: { type: Date },
    ValidTo: { type: Date },
    ValidRemarks: { type: String },
    Frozen: { type: String, enum: ["tYES", "tNO"], default: "tNO" },
    FrozenFrom: { type: Date },
    FrozenTo: { type: Date },
    FrozenRemarks: { type: String },

    // Units info
    SalesUnit: { type: String },
    SalesItemsPerUnit: { type: Number, default: 1 },
    SalesPackagingUnit: { type: String },
    SalesQtyPerPackUnit: { type: Number, default: 1 },

    // Measurements
    SalesUnitLength: { type: Number, default: 0 },
    SalesLengthUnit: { type: String },
    SalesUnitWidth: { type: Number, default: 0 },
    SalesWidthUnit: { type: String },
    SalesUnitHeight: { type: Number, default: 0 },
    SalesHeightUnit: { type: String },
    SalesUnitVolume: { type: Number, default: 0 },
    SalesVolumeUnit: { type: Number },
    SalesUnitWeight: { type: Number, default: 0 },
    SalesWeightUnit: { type: String },

    // Purchase units
    PurchaseUnit: { type: String },
    PurchaseItemsPerUnit: { type: Number, default: 1 },
    PurchasePackagingUnit: { type: String },
    PurchaseQtyPerPackUnit: { type: Number, default: 1 },

    // Purchase measurements
    PurchaseUnitLength: { type: Number, default: 0 },
    PurchaseLengthUnit: { type: String },
    PurchaseUnitWidth: { type: Number, default: 0 },
    PurchaseWidthUnit: { type: String },
    PurchaseUnitHeight: { type: Number, default: 0 },
    PurchaseHeightUnit: { type: String },
    PurchaseUnitVolume: { type: Number, default: 0 },
    PurchaseVolumeUnit: { type: Number },
    PurchaseUnitWeight: { type: Number, default: 0 },
    PurchaseWeightUnit: { type: String },
    PurchaseVATGroup: { type: String },

    // Factors
    SalesFactor1: { type: Number, default: 1 },
    SalesFactor2: { type: Number, default: 1 },
    SalesFactor3: { type: Number, default: 1 },
    SalesFactor4: { type: Number, default: 1 },
    PurchaseFactor1: { type: Number, default: 1 },
    PurchaseFactor2: { type: Number, default: 1 },
    PurchaseFactor3: { type: Number, default: 1 },
    PurchaseFactor4: { type: Number, default: 1 },

    // Pricing
    MovingAveragePrice: { type: Number, default: 0 },
    AvgStdPrice: { type: Number, default: 0 },

    // Warehouse
    DefaultWarehouse: { type: String },
    ShipType: { type: Number },
    GLMethod: { type: String, default: "glm_ItemClass" },
    TaxType: { type: String, default: "tt_Yes" },
    ManageStockByWarehouse: {
      type: String,
      enum: ["tYES", "tNO"],
      default: "tNO",
    },

    // Cost accounting
    CostAccountingMethod: { type: String, default: "bis_FIFO" },

    // Other properties
    IssueMethod: { type: String, default: "im_Backflush" },
    SRIAndBatchManageMethod: {
      type: String,
      default: "bomm_OnEveryTransaction",
    },
    IsPhantom: { type: String, enum: ["tYES", "tNO"], default: "tNO" },
    InventoryUOM: { type: String },
    PlanningSystem: { type: String, default: "bop_None" },
    ProcurementMethod: { type: String, default: "bom_Buy" },
    ComponentWarehouse: { type: String },
    ItemType: { type: String, default: "itItems" },
    ItemClass: { type: String, default: "itcMaterial" },

    // Material info
    MaterialType: { type: String, default: "mt_FinishedGoods" },
    MaterialGroup: { type: Number },
    ProductSource: { type: String },

    // Property flags (only include a few common ones)
    Properties1: { type: String, enum: ["tYES", "tNO"], default: "tNO" },
    Properties2: { type: String, enum: ["tYES", "tNO"], default: "tNO" },
    Properties3: { type: String, enum: ["tYES", "tNO"], default: "tNO" },

    // Timestamps
    UpdateDate: { type: Date },
    UpdateTime: { type: String },
    CreateDate: { type: Date },
    CreateTime: { type: String },

    // Custom fields
    U_CommodityCode: { type: String },
    U_BinLocation: { type: String },
    U_PromotionName: { type: String },
    U_PromtionExpiry: { type: Date },
    U_TargetMargin: { type: Number, default: 0 },
    U_SubCategory: { type: String },
    U_cat_lev_2: { type: String },

    // Collections
    ItemPrices: [ItemPriceSchema],
    ItemWarehouseInfoCollection: [ItemWarehouseInfoSchema],
  },
  { timestamps: true }
);

// Indexes for better query performance
ItemSchema.index({ ItemName: 1 });
ItemSchema.index({ ForeignName: 1 });
ItemSchema.index({ "ItemWarehouseInfoCollection.WarehouseCode": 1 });

// Virtual for checking if item is available (has stock)
ItemSchema.virtual("isAvailable").get(function () {
  return this.QuantityOnStock > 0;
});

// Method to get stock in a specific warehouse
ItemSchema.methods.getWarehouseStock = function (warehouseCode) {
  const warehouseInfo = this.ItemWarehouseInfoCollection.find(
    (wh) => wh.WarehouseCode === warehouseCode
  );
  return warehouseInfo ? warehouseInfo.InStock : 0;
};

// Method to get price from a specific price list
ItemSchema.methods.getPriceFromList = function (priceListId) {
  const priceInfo = this.ItemPrices.find(
    (price) => price.PriceList === priceListId
  );
  return priceInfo ? priceInfo.Price : 0;
};

// Static method to find available items
ItemSchema.statics.findAvailable = function () {
  return this.find({ QuantityOnStock: { $gt: 0 } });
};

// Create and export the model
const Item = mongoose.model("Item", ItemSchema);

module.exports = Item;
