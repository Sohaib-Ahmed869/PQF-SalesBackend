const mongoose = require("mongoose");

const customerProductSalesSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    itemId: { type: String, required: true },
    itemDescription: { type: String, required: true },
    totalQuantity: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    totalCostOfSales: { type: Number, required: true },
    grossProfit: { type: Number, required: true },
    grossMargin: { type: Number, required: true },
    year: { type: Number, required: true, index: true },
    dateStored: { type: Date, default: Date.now },
    verified: { type: Boolean, default: false },
    Historical: { type: Boolean, default: false },
    mergedFrom: { type: String }, // Original customerId before merge
    mergeDate: { type: Date },
  },
  {
    timestamps: true,
  }
);

customerProductSalesSchema.index({ customerId: 1, itemId: 1, year: 1 });

const CustomerProductSales = mongoose.model(
  "CustomerProductSales",
  customerProductSalesSchema
);
module.exports = CustomerProductSales;
