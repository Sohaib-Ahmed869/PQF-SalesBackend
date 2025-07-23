const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Deal = require("../models/Deal");
const cheerio = require("cheerio");

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI || "mongodb+srv://sohaibsipra869:nvidia940MX@cluster0.q1so4va.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
function parseDate(dateString) {
  if (!dateString) return null;

  // Handle format like "22/02/2025 03:33"
  const dateMatch = dateString.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/
  );
  if (dateMatch) {
    // Format: DD/MM/YYYY HH:MM
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1; // JS months are 0-indexed
    const year = parseInt(dateMatch[3]);
    const hour = parseInt(dateMatch[4]);
    const minute = parseInt(dateMatch[5]);

    return new Date(year, month, day, hour, minute);
  }

  // Try standard date parsing as fallback
  return new Date(dateString);
}
async function importDeals() {
  try {
    console.log("Starting import process...");

    // Read the CSV file
    const filePath = path.join(__dirname, "all-deals.csv");
    console.log(`Opening file: ${filePath}`);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    console.log("Reading CSV file...");

    // Use a simpler, more direct approach with a small chunk size
    const fileContent = fs.readFileSync(filePath, "utf8");
    console.log(`File read successfully, size: ${fileContent.length} bytes`);

    // Split into lines
    const lines = fileContent.split("\n");
    console.log(`Found ${lines.length} lines in the CSV file`);

    if (lines.length < 2) {
      throw new Error(
        "CSV file does not contain enough data (need at least headers and one row)"
      );
    }

    // Parse headers
    const headers = parseCSVLine(lines[0]);
    console.log(`Found ${headers.length} columns in CSV`);

    // Show some sample headers for debugging
    console.log("Sample headers:", headers.slice(0, 10));

    // Check for Record ID column
    const recordIdIndex = headers.indexOf("Record ID");
    if (recordIdIndex === -1) {
      console.warn("WARNING: Could not find 'Record ID' column in headers!");
      console.log("First few headers:", headers.slice(0, 20));
    } else {
      console.log(`Found 'Record ID' column at index ${recordIdIndex}`);
    }

    // Find the product HTML column index
    const productHTMLIndex = headers.indexOf("Productss");
    if (productHTMLIndex === -1) {
      console.warn(
        "WARNING: Could not find 'Panier abandonné Produits HTML' column!"
      );
    } else {
      console.log(
        `Found 'Panier abandonné Produits HTML' column at index ${productHTMLIndex}`
      );
    }

    // Parse data rows
    console.log("Parsing data rows...");
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "") continue; // Skip empty lines

      const values = parseCSVLine(lines[i]);
      if (values.length < headers.length / 2) {
        console.warn(`Skipping line ${i} due to insufficient values`);
        continue;
      }

      // Convert to object
      const row = {};
      for (let j = 0; j < Math.min(headers.length, values.length); j++) {
        row[headers[j]] = values[j];
      }
      rows.push(row);
    }

    console.log(`Successfully parsed ${rows.length} data rows`);

    // Sample the first row to check data
    if (rows.length > 0) {
      console.log("\nFirst row sample data:");
      const firstRow = rows[0];
      console.log(`Record ID: ${firstRow["Record ID"]}`);
      console.log(`Deal Name: ${firstRow["Deal Name"]}`);
      console.log(`Amount: ${firstRow["Amount"]}`);
      console.log(`Deal Stage: ${firstRow["Deal Stage"]}`);

      // Log product HTML for first row that has it
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        if (rows[i]["Productss"]) {
          console.log(`\nFound product HTML in row ${i + 1}. First 200 chars:`);
          console.log(rows[i]["Productss"].substring(0, 200) + "...");

          // Test parse the products
          const products = parseProductsHTML(rows[i]["Productss"]);
          console.log(`Parsed ${products.length} products:`);
          products.forEach((p) => {
            console.log(
              ` - ${p.name}: ${p.quantity}x at ${p.price}€ = ${p.totalPrice}€`
            );
          });
          break;
        }
      }
    }

    console.log("Processing records...");
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    const BATCH_SIZE = 20;

    // Process in batches
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      console.log(
        `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(
          rows.length / BATCH_SIZE
        )}`
      );

      for (const row of batch) {
        processedCount++;

        try {
          // Build the deal object directly from the row
          const dealObj = {
            recordId: row["Record ID"] || null,
            abandonedCartUrl: row["Abandoned cart URL"] || null,
            amount: parseFloat(row["Amount"]) || 0,
            amountInCompanyCurrency:
              parseFloat(row["Amount in company currency"]) || 0,
            currency: row["Currency"] || "EUR",
            createDate: parseDate(row["Create Date"]),

            closeDate: parseDate(row["Close Date"]),
            lastModifiedDate: parseDate(row["Last Modified Date"]),
            dealName: row["Deal Name"] || null,
            dealOwner: row["Deal owner"] || null,
            dealProbability: parseFloat(row["Deal probability"]) || 0,
            dealStage: row["Deal Stage"] || null,
            dealType: row["Deal Type"] || null,
            orderNumber:
              row["Order number"] || row["Numéro de commande"] || null,
            isPaid: parseBooleanField(row["Payé"]) || false,
            isClosedWon: parseBooleanField(row["Is Closed Won"]) || false,
            isClosedLost: parseBooleanField(row["Is closed lost"]) || false,
            isClosed: parseBooleanField(row["Is Deal Closed?"]) || false,
            pipeline: row["Pipeline"] || "Ecommerce Pipeline",
            totalProductsWithTaxes:
              parseFloat(row["Total des produits avec taxes"]) || null,
            totalExcludingTaxes: parseFloat(row["Total hors taxes"]) || null,
            totalIncludingTaxes:
              parseFloat(row["Total taxes incluses"]) || null,
            taxPrice: parseFloat(row["Tax price"]) || null,
            paymentMethod: row["Mode de paiement de la commande"] || null,
            customerName: row["Associated Contact"] || null,
            customerEmail: extractEmail(row["Associated Contact"]) || null,

            source: row["Original Traffic Source"] || null,
            sourceDetail: row["Original Traffic Source Drill-Down 1"] || null,
          };

          // Create billing address
          dealObj.billingAddress = {
            line1: row["Adresse de facturation ligne 1)"] || null,
            line2: row["Adresse de facturation, ligne 2)"] || null,
            city: row["Ville de facturation"] || null,
            state: row["État/province de facturation"] || null,
            postalCode: row["Code postal de facturation"] || null,
            country: row["Pays de facturation"] || null,
            phone: row["Téléphone de contact de facturation"] || null,
            mobilePhone: row["Contact facturation téléphone portable"] || null,
          };

          // Create shipping address
          dealObj.shippingAddress = {
            line1: row["Adresse de livraison (ligne 1)"] || null,
            line2: row["Adresse de livraison (ligne 2)"] || null,
            city: row["Ville d¨expédition"] || null,
            state: row["État/province d¨expédition"] || null,
            postalCode: row["Code postal d¨expédition"] || null,
            country: row["Pays de livraison"] || null,
            phone: row["Téléphone de contact d¨expédition"] || null,
            mobilePhone:
              row["Téléphone portable de contact d¨expédition"] || null,
          };

          // Create contact info
          dealObj.contactInfo = {
            phone: row["Téléphone de contact de facturation"] || null,
            mobilePhone: row["Contact facturation téléphone portable"] || null,
            email: dealObj.customerEmail || null,
          };

          // Parse products HTML - this is the critical part we're fixing
          const productsHTML = row["Productss"];
          if (productsHTML) {
            try {
              const products = parseProductsHTML(productsHTML);
              if (products.length > 0) {
                dealObj.products = products;
                console.log(
                  `Parsed ${products.length} products for deal ${dealObj.recordId}`
                );
              } else {
                console.log(
                  `No products parsed from HTML for deal ${dealObj.recordId}`
                );
              }
            } catch (productError) {
              console.error(
                `Error parsing products HTML for deal ${dealObj.recordId}:`,
                productError.message
              );
              dealObj.products = []; // Set empty array if parsing fails
            }
          } else {
            dealObj.products = []; // Set empty array if no HTML
          }

          // Check for first few records
          if (processedCount <= 5) {
            console.log(`Record ${processedCount}:`);
            console.log(`  recordId: ${dealObj.recordId}`);
            console.log(`  dealName: ${dealObj.dealName}`);
            console.log(
              `  products: ${
                dealObj.products ? dealObj.products.length : 0
              } items`
            );
            if (dealObj.products && dealObj.products.length > 0) {
              console.log(
                `  first product: ${dealObj.products[0].name}, ${dealObj.products[0].quantity}x, ${dealObj.products[0].price}€`
              );
            }
          }

          // Only process records with valid ID
          if (dealObj.recordId) {
            // Use updateOne with upsert option
            await Deal.updateOne(
              { recordId: dealObj.recordId },
              { $set: dealObj },
              { upsert: true, runValidators: true }
            );
            console.log(`Successfully saved deal: ${dealObj.recordId}`);
            successCount++;
          } else {
            console.log("Skipping row without recordId");
          }
        } catch (error) {
          console.error(
            `Error processing row ${processedCount}:`,
            error.message
          );
          errorCount++;
        }
      }

      console.log(
        `Batch complete. Progress: ${processedCount}/${
          rows.length
        } (${Math.round((processedCount / rows.length) * 100)}%)`
      );
    }

    console.log("\n--- Import Summary ---");
    console.log(`Total rows processed: ${processedCount}`);
    console.log(`Successful imports: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log("Import completed");
    process.exit(0);
  } catch (error) {
    console.error("Import error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Custom CSV line parser that handles quotes and commas properly
function parseCSVLine(line) {
  const values = [];
  let insideQuotes = false;
  let currentValue = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote inside quotes
        currentValue += '"';
        i++;
      } else {
        // Toggle quote status
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      // End of field
      values.push(currentValue);
      currentValue = "";
    } else {
      // Regular character
      currentValue += char;
    }
  }

  // Don't forget the last field
  values.push(currentValue);

  return values;
}

// Email extraction from contact field
function extractEmail(contactString) {
  if (!contactString) return null;

  // Try to extract email from format like "John Doe (john@example.com)"
  const emailMatch = contactString.match(/\(([^)]+@[^)]+)\)/);
  if (emailMatch && emailMatch[1]) {
    return emailMatch[1];
  }

  return null;
}

// Boolean field converter
function parseBooleanField(value) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  // Handle string values
  if (typeof value === "string") {
    const lowerValue = value.toLowerCase().trim();
    return lowerValue === "true" || lowerValue === "yes" || lowerValue === "1";
  }

  return false;
}

// IMPROVED PRODUCT HTML PARSER
function parseProductsHTML(html) {
  if (!html || typeof html !== "string") {
    return [];
  }

  const products = [];

  try {
    // Clean up the HTML first
    // Sometimes the HTML can have escaped characters
    const cleanHtml = html
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");

    // Load HTML into cheerio
    const $ = cheerio.load(cleanHtml);

    // Debug the HTML structure
    console.log("HTML Structure:");
    console.log(`- Found ${$("tr").length} table rows`);
    console.log(`- Found ${$("td").length} table cells`);

    // Find all product rows - each TR contains multiple products
    $("tr").each(function () {
      // First count the cells to understand the structure
      const cells = $(this).find("td");
      console.log(`Processing row with ${cells.length} cells`);

      // Calculate how many products are in this row
      // Each product typically takes 6 cells (image, name, price, details, quantity, total)
      const numProducts = Math.floor(cells.length / 6);
      console.log(`Detected ${numProducts} products in this row`);

      // Process each product in the row
      for (let i = 0; i < numProducts; i++) {
        const baseIndex = i * 6;

        // Make sure we have enough cells remaining
        if (baseIndex + 5 >= cells.length) continue;

        // Extract product data from the cells
        const imageCell = cells.eq(baseIndex);
        const nameCell = cells.eq(baseIndex + 1);
        const priceCell = cells.eq(baseIndex + 2);
        // Skip baseIndex + 3 which is usually details/options
        const quantityCell = cells.eq(baseIndex + 4);
        const totalCell = cells.eq(baseIndex + 5);

        // Parse product details
        let imageUrl = null;
        const img = imageCell.find("img");
        if (img.length > 0) {
          imageUrl = img.attr("src");
        }

        let name = "Unknown Product";
        const nameLink = nameCell.find("a");
        if (nameLink.length > 0) {
          name = nameLink.text().trim();
        }

        let price = 0;
        const priceText = priceCell.find(".price").text().trim();
        if (priceText) {
          // Extract just the numeric part, handle Euro format
          const priceMatch = priceText.match(/(\d+[,.]\d+|\d+)/);
          if (priceMatch) {
            price = parseFloat(priceMatch[0].replace(",", "."));
          }
        }

        let quantity = 1;
        const quantityText = quantityCell.find(".quantity").text().trim();
        if (quantityText) {
          const quantityMatch = quantityText.match(/\d+/);
          if (quantityMatch) {
            quantity = parseInt(quantityMatch[0]);
          }
        }

        let totalPrice = 0;
        const totalText = totalCell.find("strong").text().trim();
        if (totalText) {
          // Extract just the numeric part, handle Euro format
          const totalMatch = totalText.match(/(\d+[,.]\d+|\d+)/);
          if (totalMatch) {
            totalPrice = parseFloat(totalMatch[0].replace(",", "."));
          }
        } else {
          // Calculate if not found
          totalPrice = price * quantity;
        }

        // Only add product if we have at least a name
        if (name && name !== "Unknown Product") {
          products.push({
            name,
            price,
            quantity,
            totalPrice,
            imageUrl,
          });

          console.log(
            `Extracted product: ${name}, Qty: ${quantity}, Price: ${price}€, Total: ${totalPrice}€`
          );
        }
      }
    });

    // If parsing with TR approach failed, try a more general approach
    if (products.length === 0) {
      console.log("TR approach failed, trying alternate parsing method...");

      // Try to find product names
      $("a.label").each(function () {
        const name = $(this).text().trim();

        if (!name) return;

        // Find the closest cells for price, quantity, etc.
        const productRow = $(this).closest("tr");

        let price = 0;
        productRow.find(".price").each(function () {
          const priceText = $(this).text().trim();
          const priceMatch = priceText.match(/(\d+[,.]\d+|\d+)/);
          if (priceMatch && price === 0) {
            price = parseFloat(priceMatch[0].replace(",", "."));
          }
        });

        let quantity = 1;
        productRow.find(".quantity").each(function () {
          const quantityText = $(this).text().trim();
          const quantityMatch = quantityText.match(/\d+/);
          if (quantityMatch) {
            quantity = parseInt(quantityMatch[0]);
          }
        });

        let totalPrice = 0;
        productRow.find("strong").each(function () {
          const totalText = $(this).text().trim();
          const totalMatch = totalText.match(/(\d+[,.]\d+|\d+)/);
          if (totalMatch && totalPrice === 0) {
            totalPrice = parseFloat(totalMatch[0].replace(",", "."));
          }
        });

        // Find image URL
        let imageUrl = null;
        productRow.find("img").each(function () {
          if (!imageUrl) {
            imageUrl = $(this).attr("src");
          }
        });

        // If no total price, calculate it
        if (totalPrice === 0 && price > 0) {
          totalPrice = price * quantity;
        }

        products.push({
          name,
          price,
          quantity,
          totalPrice,
          imageUrl,
        });

        console.log(
          `Alternative method - Extracted product: ${name}, Qty: ${quantity}, Price: ${price}€, Total: ${totalPrice}€`
        );
      });
    }

    console.log(`Final product count: ${products.length}`);
    return products;
  } catch (error) {
    console.error("Error parsing products HTML:", error);
    console.error(
      "HTML that caused error (first 100 chars):",
      html.substring(0, 100)
    );
    // Return empty array rather than throwing error
    return [];
  }
}

// Run the import function
importDeals();
