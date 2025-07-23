const mongoose = require("mongoose");

// Schema for menu items
const menuItemSchema = new mongoose.Schema({
  name: String,
  price: String,
  description: String,
  ingredients: String,
});

// Schema for menu sections
const menuSectionSchema = new mongoose.Schema({
  name: String,
  items: [menuItemSchema],
});

// Schema for popular items
const popularItemSchema = new mongoose.Schema({
  name: String,
  price: String,
});

// Schema for restaurant data
const restaurantSchema = new mongoose.Schema({
  name: String,
  url: String,
  id: String,
  rating: String,
  reviews: String,
  delivery_time: String,
  delivery_fee: String,
  cuisine: String,
  address: String,
  hours: String,
  menu: [menuSectionSchema],
  popular_items: [popularItemSchema],
  allergens_available: Boolean,
});

// Main schema for scraper jobs
const scraperJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
    },
    region: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "error"],
      default: "pending",
    },
    scrolls: {
      type: Number,
      default: 10,
    },
    getDetails: {
      type: Boolean,
      default: true,
    },
    detailLimit: Number,
    startTime: {
      type: Date,
      default: Date.now,
    },
    completionTime: Date,
    restaurantCount: Number,
    error: String,
    restaurants: [restaurantSchema],
    rawData: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// Add indexes for better query performance
scraperJobSchema.index({ status: 1 });
scraperJobSchema.index({ region: 1 });
scraperJobSchema.index({ createdAt: -1 });

// Create the model
const ScraperJob = mongoose.model("ScraperJob", scraperJobSchema);

module.exports = ScraperJob;
