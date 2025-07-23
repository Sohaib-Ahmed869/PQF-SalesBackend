const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    name: String,
    price: Number,
    quantity: Number,
    totalPrice: Number,
    imageUrl: String,
  },
  { _id: false }
);

const ContactInfoSchema = new mongoose.Schema(
  {
    phone: String,
    mobilePhone: String,
    email: String,
  },
  { _id: false }
);

const CartSchema = new mongoose.Schema(
  {
    cartId: {
      type: String,
      required: true,
      unique: true,
    },
    clientId: {
      type: String,
      required: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
      required: true,
    },
    products: [ProductSchema],
    totalExcludingTaxes: {
      type: Number,
      default: 0,
    },
    estimatedTaxAmount: {
      type: Number,
      default: 0,
    },
    totalIncludingTaxes: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "EUR",
    },
    createDate: {
      type: Date,
      required: true,
    },
    lastModifiedDate: {
      type: Date,
      default: Date.now,
    },
    isAbandoned: {
      type: Boolean,
      default: true,
    },
    contactInfo: ContactInfoSchema,
    source: {
      type: String,
      default: "Website",
    },
    status: {
      type: String,
      enum: ["active", "abandoned", "converted"],
      default: "abandoned",
    },
    // Fields for potential future use
    abandonedCartUrl: String,
    recoveryEmailSent: {
      type: Boolean,
      default: false,
    },
    recoveryEmailSentDate: Date,
    convertedDate: Date,
    conversionSource: String,
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
CartSchema.index({ customerEmail: 1 });
CartSchema.index({ clientId: 1 });
CartSchema.index({ cartId: 1 });
CartSchema.index({ status: 1 });
CartSchema.index({ createDate: -1 });
CartSchema.index({ isAbandoned: 1, status: 1 });

// Virtual for backward compatibility with Deal model
CartSchema.virtual("amount").get(function () {
  return this.totalIncludingTaxes;
});

// Ensure virtual fields are serialized
CartSchema.set("toJSON", {
  virtuals: true,
});

module.exports = mongoose.model("Cart", CartSchema);
