const mongoose = require("mongoose");
const customerLedgerSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    date: { type: Date, required: true, index: true },
    transactionNumber: { type: String, required: true },
    transactionType: {
      type: String,
      enum: ["SJ", "CRJ", "Balance Fwd"],
      required: true,
    },
    debitAmount: { type: Number, default: 0 },
    creditAmount: { type: Number, default: 0 },
    runningBalance: { type: Number, required: true },
    description: String,
    isBalanceForward: { type: Boolean, default: false },
    relatedInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    relatedPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    dateStored: { type: Date, default: Date.now },
    verified: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);
// Create indexes for better performance
customerLedgerSchema.index({ customerId: 1, date: 1 });
customerLedgerSchema.index({ transactionType: 1, date: 1 });
const CustomerLedger = mongoose.model("CustomerLedger", customerLedgerSchema);

module.exports = CustomerLedger;
