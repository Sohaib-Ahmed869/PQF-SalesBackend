// models/Deal.js
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

const AddressSchema = new mongoose.Schema(
  {
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
    phone: String,
    mobilePhone: String,
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

const DealSchema = new mongoose.Schema(
  {
    recordId: {
      type: String
    },
    abandonedCartUrl: String,
    billingAddress: AddressSchema,
    shippingAddress: AddressSchema,
    amount: {
      type: Number,
      default: 0,
    },
    amountInCompanyCurrency: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "EUR",
    },
    createDate: Date,
    closeDate: Date,
    dealName: String,
    dealOwner: String,
    dealProbability: Number,
    dealStage: String,
    dealType: String,
    orderNumber: String,
    products: [ProductSchema],
    isPaid: {
      type: Boolean,
      default: false,
    },
    isClosedWon: {
      type: Boolean,
      default: false,
    },
    isClosedLost: {
      type: Boolean,
      default: false,
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
    pipeline: {
      type: String,
      default: "Ecommerce Pipeline",
    },
    totalProductsWithTaxes: Number,
    totalExcludingTaxes: Number,
    totalIncludingTaxes: Number,
    taxPrice: Number,
    paymentMethod: String,
    customerName: String,
    customerEmail: String,
    lastModifiedDate: Date,
    contactInfo: ContactInfoSchema,
    source: String,
    sourceDetail: String,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Deal", DealSchema);
