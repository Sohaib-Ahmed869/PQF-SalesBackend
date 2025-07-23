#!/usr/bin/env node

/**
 * Simple script to import cart data from CSV to MongoDB
 *
 * Usage:
 * 1. Update the MONGODB_URL and CSV_FILE_PATH below
 * 2. Run: node import-carts.js
 */

const MONGODB_URL =
  "mongodb+srv://sohaibsipra869:nvidia940MX@cluster0.q1so4va.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; // UPDATE THIS
const EXCEL_FILE_PATH = "./carts3.csv"; // UPDATE THIS PATH

// ============ DEPENDENCIES ============
const mongoose = require("mongoose");
const fs = require("fs");
const XLSX = require("xlsx");

// ============ SCHEMA DEFINITIONS ============
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
    cartId: { type: String, required: true, unique: true },
    clientId: { type: String, required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    products: [ProductSchema],
    totalExcludingTaxes: { type: Number, default: 0 },
    estimatedTaxAmount: { type: Number, default: 0 },
    totalIncludingTaxes: { type: Number, default: 0 },
    currency: { type: String, default: "EUR" },
    createDate: { type: Date, required: true },
    lastModifiedDate: { type: Date, default: Date.now },
    isAbandoned: { type: Boolean, default: true },
    contactInfo: ContactInfoSchema,
    source: { type: String, default: "Website" },
    status: {
      type: String,
      enum: ["active", "abandoned", "converted"],
      default: "abandoned",
    },
  },
  { timestamps: true }
);

const Cart = mongoose.model("Cart", CartSchema);

// ============ HELPER FUNCTIONS ============
function parseProductDetails(productString) {
  if (
    !productString ||
    productString === "NULL" ||
    productString.trim() === ""
  ) {
    return [];
  }

  const products = [];
  const productItems = productString.split(";");

  for (let item of productItems) {
    item = item.trim();
    if (!item) continue;

    try {
      const nameMatch = item.match(/^(.+?)\s*\(/);
      if (!nameMatch) continue;

      const name = nameMatch[1].trim();
      const qtyMatch = item.match(/Qty:\s*(\d+(?:\.\d+)?)/);
      const unitPriceMatch = item.match(/Unit Price:\s*(\d+(?:\.\d+)?)/);
      const totalPriceMatch = item.match(/Total Item Price:\s*(\d+(?:\.\d+)?)/);

      if (qtyMatch && unitPriceMatch && totalPriceMatch) {
        products.push({
          name: name,
          quantity: parseFloat(qtyMatch[1]),
          price: parseFloat(unitPriceMatch[1]),
          totalPrice: parseFloat(totalPriceMatch[1]),
          imageUrl: null,
        });
      }
    } catch (error) {
      console.warn(`Error parsing product: ${item.substring(0, 50)}...`);
    }
  }

  return products;
}

function parseCurrencyAmount(amountString) {
  if (!amountString || amountString === "NULL") return 0;
  const cleanAmount = amountString.replace(/[€,$]/g, "").replace(/,/g, "");
  return parseFloat(cleanAmount) || 0;
}

function parseDate(dateString) {
  if (!dateString || dateString === "NULL") return new Date();
  return new Date(dateString);
}

// ============ MAIN IMPORT FUNCTION ============
async function importCarts() {
  console.log("🚀 Starting cart import process...\n");

  try {
    // Connect to MongoDB
    console.log("📝 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URL);
    console.log("✅ Connected to MongoDB\n");

    // Read and validate Excel file
    console.log("📖 Reading Excel file...");
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`Excel file not found: ${EXCEL_FILE_PATH}`);
    }

    // Read Excel file
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const worksheetName = workbook.SheetNames[0]; // Use first sheet
    const worksheet = workbook.Sheets[worksheetName];

    console.log(`✅ Reading from sheet: "${worksheetName}"`);

    // Convert to JSON (this will use first row as headers)
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      raw: false, // Keep as strings to handle formatting
      defval: null, // Use null for empty cells
    });

    console.log(`✅ Found ${jsonData.length} data rows in Excel file\n`);

    // Show the column headers for verification
    if (jsonData.length > 0) {
      console.log("📋 Column headers found:");
      Object.keys(jsonData[0]).forEach((header, index) => {
        console.log(`   ${index + 1}. ${header}`);
      });
      console.log("");
    }

    // Process data
    console.log("⚙️  Processing cart data...");
    const carts = [];
    let processed = 0;
    let skipped = 0;

    // Process each row from Excel
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];

      // Map Excel columns - adjust these field names based on your actual Excel headers
      const cartId = row["cart_id"] || row["Cart ID"] || row["cartId"];
      const clientId = row["client_id"] || row["Client ID"] || row["clientId"];
      const clientName =
        row["client_name"] || row["Client Name"] || row["clientName"];
      const clientEmail =
        row["client_email"] || row["Client Email"] || row["clientEmail"];
      const productsDetails =
        row["products_details"] ||
        row["Products Details"] ||
        row["productsDetails"];
      const totalExclTax =
        row["cart_total_excl_tax"] ||
        row["Cart Total Excl Tax"] ||
        row["totalExclTax"];
      const taxAmount =
        row["estimated_tax_amount"] || row["Tax Amount"] || row["taxAmount"];
      const totalInclTax =
        row["cart_total_incl_tax"] ||
        row["Cart Total Incl Tax"] ||
        row["totalInclTax"];
      const createDate =
        row["create_date"] || row["Create Date"] || row["createDate"];

      if (!cartId || !clientId || !clientEmail) {
        console.warn(
          `⚠️  Row ${
            i + 1
          }: Missing essential data (cartId: ${cartId}, clientId: ${clientId}, email: ${clientEmail})`
        );
        skipped++;
        continue;
      }

      try {
        const cart = {
          cartId: String(cartId),
          clientId: String(clientId),
          customerName: clientName || "",
          customerEmail: clientEmail,
          products: parseProductDetails(productsDetails),
          totalExcludingTaxes: parseCurrencyAmount(totalExclTax),
          estimatedTaxAmount: parseCurrencyAmount(taxAmount),
          totalIncludingTaxes: parseCurrencyAmount(totalInclTax),
          createDate: parseDate(createDate),
          contactInfo: {
            email: clientEmail,
            phone: null,
            mobilePhone: null,
          },
          isAbandoned: true,
          status: "abandoned",
        };

        carts.push(cart);
        processed++;

        // Show progress every 10 records
        if (processed % 10 === 0) {
          console.log(`   📝 Processed ${processed} carts...`);
        }
      } catch (error) {
        console.warn(`⚠️  Error processing row ${i + 1}: ${error.message}`);
        skipped++;
      }
    }

    console.log(`✅ Processed ${processed} carts, skipped ${skipped}\n`);

    // Insert into database
    if (carts.length > 0) {
      console.log("💾 Inserting carts into database...");

      try {
        const result = await Cart.insertMany(carts, { ordered: false });
        console.log(`✅ Successfully inserted ${result.length} carts`);
      } catch (error) {
        if (error.name === "BulkWriteError") {
          const inserted = error.result.nInserted;
          const duplicates = error.writeErrors.filter(
            (err) => err.code === 11000
          ).length;
          console.log(`✅ Inserted ${inserted} new carts`);
          console.log(`⚠️  Skipped ${duplicates} duplicates`);
        } else {
          throw error;
        }
      }
    }

    // Show final statistics
    console.log("\n📊 FINAL RESULTS:");
    console.log("==================");

    const totalCarts = await Cart.countDocuments();
    const cartsWithProducts = await Cart.countDocuments({
      "products.0": { $exists: true },
    });
    const emptyCarts = await Cart.countDocuments({ products: { $size: 0 } });
    const totalValue = await Cart.aggregate([
      { $group: { _id: null, total: { $sum: "$totalIncludingTaxes" } } },
    ]);

    console.log(`📦 Total carts in database: ${totalCarts}`);
    console.log(`🛍️  Carts with products: ${cartsWithProducts}`);
    console.log(`🗂️  Empty carts: ${emptyCarts}`);
    console.log(
      `💰 Total cart value: €${totalValue[0]?.total?.toFixed(2) || 0}`
    );

    // Show sample
    const sampleCart = await Cart.findOne({ "products.0": { $exists: true } });
    if (sampleCart) {
      console.log("\n🔍 SAMPLE CART:");
      console.log("================");
      console.log(`ID: ${sampleCart.cartId}`);
      console.log(`Customer: ${sampleCart.customerName}`);
      console.log(`Email: ${sampleCart.customerEmail}`);
      console.log(`Products: ${sampleCart.products.length} items`);
      console.log(`Value: €${sampleCart.totalIncludingTaxes}`);
      console.log(`Date: ${sampleCart.createDate.toISOString().split("T")[0]}`);
    }

    console.log("\n🎉 Import completed successfully!");
  } catch (error) {
    console.error("\n❌ Import failed:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n👋 Disconnected from MongoDB");
  }
}

// Run the import
if (require.main === module) {
  importCarts()
    .then(() => {
      console.log("✨ All done!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Fatal error:", error);
      process.exit(1);
    });
}

module.exports = { Cart, importCarts };
