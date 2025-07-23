const mongoose = require("mongoose");
const Invoice = require("./models/Invoice");
const SalesOrder = require("./models/SalesOrder");
const Customer = require("./models/Customer");

/**
 * Updates all invoices and sales orders to link them to the sales agent
 * associated with their customer
 */
async function linkDocumentsToAgents() {
  try {
    // Find all customers that have an assigned sales agent
    const customers = await Customer.find({
      assignedTo: { $exists: true, $ne: null },
    })
      .select("CardCode assignedTo")
      .lean();

    console.log(`Found ${customers.length} customers with assigned agents`);

    // Process invoices
    for (const customer of customers) {
      // Update all invoices for this customer
      const invoiceResult = await Invoice.updateMany(
        { CardCode: customer.CardCode },
        { $set: { salesAgent: customer.assignedTo } }
      );

      // Update all sales orders for this customer
      const orderResult = await SalesOrder.updateMany(
        { CardCode: customer.CardCode },
        { $set: { salesAgent: customer.assignedTo } }
      );

      console.log(
        `Customer ${customer.CardCode}: Updated ${invoiceResult.modifiedCount} invoices and ${orderResult.modifiedCount} orders`
      );
    }

    console.log("Finished linking documents to sales agents");
  } catch (error) {
    console.error("Error linking documents to agents:", error);
    throw error;
  }
}

module.exports = { linkDocumentsToAgents };
