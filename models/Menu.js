// models/PrestaShopMenu.js
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Schema for PrestaShop Menu Items
const MenuItemSchema = new Schema(
  {
    id_category: {
      type: Number,
      required: true,
      unique: true,
    },
    id_parent: {
      type: Number,
      required: true,
    },
    position: {
      type: Number,
      default: 0,
    },
    level_depth: {
      type: Number,
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
    name: {
      type: String,
      required: true,
    },
    link_rewrite: {
      type: String,
    },
    url: {
      type: String,
    },
    description: {
      type: String,
    },
    meta_title: {
      type: String,
    },
    meta_description: {
      type: String,
    },
    meta_keywords: {
      type: String,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "PrestaShopMenus",
  }
);

// Create indexes for performance
MenuItemSchema.index({ id_category: 1 });
MenuItemSchema.index({ id_parent: 1 });
MenuItemSchema.index({ active: 1 });

const PrestaShopMenu = mongoose.model("PrestaShopMenu", MenuItemSchema);

module.exports = PrestaShopMenu;
