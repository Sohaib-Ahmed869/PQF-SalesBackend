// models/PrestaShopProduct.js
const mongoose = require("mongoose");

const PrestaShopProductSchema = new mongoose.Schema({
  id_product: { type: Number, required: true, unique: true },
  id_manufacturer: { type: Number, default: 0 },
  id_supplier: { type: Number, default: 0 },
  id_category_default: { type: Number, required: true },
  name: { type: String, required: true },
  description: { type: String, default: "" },
  description_short: { type: String, default: "" },
  price: { type: Number, required: true },
  wholesale_price: { type: Number, default: 0 },
  weight: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  reference: { type: String, default: "" },
  ean13: { type: String, default: "" },
  isbn: { type: String, default: "" },
  upc: { type: String, default: "" },
  mpn: { type: String, default: "" },
  link_rewrite: { type: String, default: "" },
  meta_title: { type: String, default: "" },
  meta_description: { type: String, default: "" },
  meta_keywords: { type: String, default: "" },
  quantity: { type: Number, default: 0 },
  on_sale: { type: Boolean, default: false },
  is_virtual: { type: Boolean, default: false },
  condition: {
    type: String,
    default: "new",
    enum: ["new", "used", "refurbished"],
  },
  available_for_order: { type: Boolean, default: true },
  manufacturer_name: { type: String, default: "" },
  unity: { type: String, default: "" },
  date_add: { type: Date },
  date_upd: { type: Date },
  type: { type: String, default: "simple" },
  product_type: { type: String, default: "standard" },

  images: [
    {
      id_image: { type: Number, required: true },
      position: { type: Number, default: 0 },
      url: { type: String, required: true },
    },
  ],

  features: [
    {
      id_feature: { type: Number, required: true },
      id_feature_value: { type: Number, required: true },
      name: { type: String, required: true },
      value: { type: String, required: true },
    },
  ],

  categories: [
    {
      id_category: { type: Number, required: true },
      name: { type: String, required: true },
    },
  ],

  lastUpdated: { type: Date, default: Date.now },
});

// Indexes for better performance
PrestaShopProductSchema.index({ id_product: 1 });
PrestaShopProductSchema.index({ id_category_default: 1 });
PrestaShopProductSchema.index({ reference: 1 });
PrestaShopProductSchema.index({ active: 1 });
PrestaShopProductSchema.index({ "categories.id_category": 1 });

module.exports = mongoose.model("PrestaShopProduct", PrestaShopProductSchema);
