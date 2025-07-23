// utils/pdfGenerator.js
const puppeteer = require("puppeteer");
const handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");

// Load the HTML template for quotations
const templateSource = fs.readFileSync(
  path.join(__dirname, "../templates/quotation-pdf-template.html"),
  "utf8"
);
const template = handlebars.compile(templateSource);

/**
 * Generate a PDF for a quotation
 * @param {Object} quotation - Quotation data
 * @param {Object} customer - Customer data
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateQuotationPDF(quotation, customer) {
  let browser = null;

  try {
    console.log("Starting PDF generation process...");

    // Format data for the template
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return `${date.getDate().toString().padStart(2, "0")}-${(
        date.getMonth() + 1
      )
        .toString()
        .padStart(2, "0")}-${date.getFullYear()}`;
    };

    // Calculate totals
    const subtotal = quotation.DocTotal || 0;
    const vat = subtotal * 0.055; // 5.5% VAT
    const totalTTC = subtotal + vat;

    console.log("Customer data structure:", {
      hasCustomer: !!customer,
      customerType: typeof customer,
      hasCardName: customer && !!customer.CardName,
      hasAddress: customer && !!customer.address,
      addressType:
        customer && customer.address ? typeof customer.address : "N/A",
      properties: customer ? Object.keys(customer).join(", ") : "none",
    });

    

    // Prepare the data for the template
    const data = {
      quotation: {
        ...(quotation.toObject ? quotation.toObject() : quotation), // Convert Mongoose object to plain JS object
        formattedDocDate: formatDate(quotation.DocDate),
        formattedDocDueDate: formatDate(quotation.DocDueDate),
        subtotal: subtotal.toFixed(2),
        vat: vat.toFixed(2),
        totalTTC: totalTTC.toFixed(2),
        // Make sure DocumentLines is explicitly passed and is an array
        DocumentLines: Array.isArray(quotation.DocumentLines)
          ? quotation.DocumentLines.map((line) => ({
              ...(line.toObject ? line.toObject() : line),
              Price: line.Price ? line.Price.toFixed(2) : "0.00",
              LineTotal: line.LineTotal ? line.LineTotal.toFixed(2) : "0.00",
            }))
          : [],
      },
      customer,
      companyInfo: {
        name: "HALAL FOOD SERVICE",
        address: "32, Rue Raspail",
        city: "La Courneuve",
        zipCode: "93120",
        country: "France",
        phone: "+33 1 79 64 84 05",
        email: "commande@halalfs.com",
        website: "www.HalalFS.com",
        siren: "798545448",
        vatNumber: "FR02798545448",
        bankName: "BRED BANQUE POPULAIRE",
        iban: "FR7610107006090001804792320",
        swift: "BREDFRPPXXX",
      },
      // We will handle the logo differently
      logoUrl:
        "https://imageshfs.s3.ap-southeast-2.amazonaws.com/image-removebg-preview+(1).png",
    };

    // Generate HTML from template (inject the logo as base64 directly in the HTML)
    let html = template(data);

    // For debugging - save the generated HTML to a file
    const debugHtmlPath = path.join(__dirname, "../temp-quotation.html");
    fs.writeFileSync(debugHtmlPath, html);
    console.log(`Generated HTML saved to ${debugHtmlPath}`);

    // Launch Puppeteer
    browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
      headless: true,
    });

    const page = await browser.newPage();
    console.log("Browser launched successfully");

    // Set content with better error handling
    try {
      await page.setContent(html, {
        waitUntil: ["load", "domcontentloaded", "networkidle0"],
        timeout: 30000,
      });
      console.log("Content set successfully");
    } catch (contentError) {
      console.error("Error setting page content:", contentError);
      throw new Error(`Failed to set page content: ${contentError.message}`);
    }

    // Use setTimeout instead of waitForTimeout for older Puppeteer versions
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log("Waited for 1 second to ensure rendering");

    // Generate PDF with explicit settings
    console.log("Generating PDF...");
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "1cm",
        right: "1cm",
        bottom: "1cm",
        left: "1cm",
      },
      timeout: 30000,
    });

    console.log(`PDF generated successfully, size: ${pdfBuffer.length} bytes`);

    // Validate the PDF buffer
    if (!pdfBuffer || pdfBuffer.length < 1000) {
      throw new Error("Generated PDF is too small or empty");
    }

    // Validate that it starts with PDF header
    const pdfHeader = pdfBuffer.slice(0, 4).toString();
    if (pdfHeader !== "%PDF") {
      console.warn("Warning: Generated buffer doesn't start with %PDF header!");
    }

    // Save a copy of the PDF for debugging
    const debugPdfPath = path.join(__dirname, "../temp-quotation.pdf");
    fs.writeFileSync(debugPdfPath, pdfBuffer);
    console.log(`PDF saved to ${debugPdfPath} for debugging`);

    if (browser) {
      await browser.close();
      console.log("Browser closed successfully");
    }

    return pdfBuffer;
  } catch (error) {
    console.error("Error during PDF generation:", error);

    // Ensure browser is closed even if an error occurs
    if (browser) {
      try {
        await browser.close();
        console.log("Browser closed after error");
      } catch (closeError) {
        console.error("Error closing browser:", closeError);
      }
    }

    throw new Error(`Failed to generate quotation PDF: ${error.message}`);
  }
}

module.exports = {
  generateQuotationPDF,
};
