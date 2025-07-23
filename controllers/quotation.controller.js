// controllers/quotation.controller.js
const Quotation = require("../models/Quotation");
const SalesOrder = require("../models/SalesOrder");
const Task = require("../models/Task");
const User = require("../models/User");
const Item = require("../models/item");
const customerTargetController = require("./customerTarget.controller");
const {
  formatOrderForSAP,
  createSalesOrderInSAP,
  checkBusinessPartnerExists,
} = require("../utils/sapB1Integration");
const Customer = require("../models/Customer");

// Add these functions to quotation.controller.js

const nodemailer = require("nodemailer");
const axios = require("axios");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    email: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

// Generate payment link for quotation
exports.generatePaymentLinkForQuotation = async (req, res) => {
  try {
    const { docNum } = req.params;
    const { email } = req.body;

    const quotation = await Quotation.findOne({ DocNum: docNum });
    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: "Quotation not found",
      });
    }

    const customer_account_info = [
      {
        unique_account_identifier: quotation.CardCode,
      },
    ];

    const customer_account_info_2 =
      '{"payment_history_simple":' +
      JSON.stringify(customer_account_info) +
      "}";

    // Find the customer for PDF generation
    const customer = await Customer.findOne({
      CardCode: quotation.CardCode,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: `Customer with CardCode ${quotation.CardCode} not found`,
      });
    }

    const customerForTemplate = {
      CardName: customer.CardName || "Customer",
      street: customer.address?.street || customer.Address || "",
      city: customer.address?.city || customer.City || "",
      zipCode: customer.address?.zipCode || customer.ZipCode || "",
      Country: customer.Country || "",
      Phone: customer.Phone || customer.Telephone || "",
    };

    // Generate PDF
    let pdfBuffer;
    try {
      const pdfGenerator = require("../utils/pdfGenerator");
      pdfBuffer = await pdfGenerator.generateQuotationPDF(
        quotation,
        customerForTemplate
      );
      console.log(`PDF generated successfully: ${pdfBuffer.length} bytes`);
    } catch (pdfError) {
      console.error("Error generating PDF:", pdfError);
      return res.status(500).json({
        success: false,
        error: `Error generating PDF: ${pdfError.message}`,
      });
    }

    const account_info = Buffer.from(customer_account_info_2).toString(
      "base64"
    );

    const paymentLinkRequest = {
      reference: `QT-${quotation.DocNum}`,
      amount: {
        value: Math.round(quotation.DocTotal * 100),
        currency: quotation.DocCurrency || "EUR",
      },
      description: `Payment for Quotation #${quotation.DocNum}`,
      countryCode: "FR",
      merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
      shopperReference: quotation.CardCode,
      additionalData: {
        "openinvoicedata.merchantData": account_info,
      },

      company: {
        name: quotation.CardName,
      },
      shopperEmail: email,
      lineItems: quotation.DocumentLines.map((line) => ({
        id: line.LineNum || line._id,
        quantity: line.Quantity,
        amountIncludingTax: Math.round(
          (line.PriceAfterVAT || line.Price * 1.2) * 100
        ),
        amountExcludingTax: Math.round(line.Price * 100),
        taxAmount: Math.round(
          ((line.PriceAfterVAT || line.Price * 1.2) - line.Price) * 100
        ),
        taxPercentage: Math.round(
          ((line.PriceAfterVAT || line.Price * 1.2) / line.Price - 1) * 10000
        ),
        description: line.ItemDescription,
      })),
      allowedPaymentMethods: ["klarna_b2b"],
    };

    const response = await axios.post(
      `${process.env.ADYEN_API_BASE_URL}/paymentLinks`,
      paymentLinkRequest,
      {
        headers: {
          "X-API-KEY": process.env.ADYEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const paymentLink = response.data.url;
    const paymentId = response.data.id;
    const expiryDate = new Date(response.data.expiresAt).toISOString();

    quotation.Payment_id = paymentId;
    quotation.Link_sent = true;

    // Comprehensive email template matching the sales order format
    const emailHtml = `
    <h2>Demande de Paiement pour le Devis n°${quotation.DocNum}</h2>
    <p>Chère ${quotation.CardName},</p>
    <p>Veuillez trouver ci-dessous le lien de paiement pour votre devis :</p>
    <p><a href="${paymentLink}">Cliquez ici pour effectuer votre paiement</a></p>
    <p style="font-weight: bold;">Si vous souhaitez effectuer le paiement après 30 jours, veuillez choisir l'option « Payer par facture pour les entreprises » et remplir les informations requises.</p>
    <p>Le lien de paiement expirera le ${expiryDate.split("T")[0]}.</p>
    <h3>Détails du devis :</h3>
    <table style="border-collapse: collapse; width: 100%;">
   <thead>
<tr style="background-color: #f3f4f6;">
<th style="padding: 8px; border: 1px solid #ddd;">Article</th>
<th style="padding: 8px; border: 1px solid #ddd;">Quantité</th>
<th style="padding: 8px; border: 1px solid #ddd;">Prix HT</th>
<th style="padding: 8px; border: 1px solid #ddd;">TVA</th>
<th style="padding: 8px; border: 1px solid #ddd;">Prix TTC</th>
<th style="padding: 8px; border: 1px solid #ddd;">Total TTC</th>
</tr>
</thead>
<tbody>
${quotation.DocumentLines.map(
  (line) => `
  <tr>
  <td style="padding: 8px; border: 1px solid #ddd;">${line.ItemDescription}</td>
  <td style="padding: 8px; border: 1px solid #ddd;">${line.Quantity}</td>
  <td style="padding: 8px; border: 1px solid #ddd;">${new Intl.NumberFormat(
    "fr-FR",
    {
      style: "currency",
      currency: "EUR",
    }
  ).format(line.Price)}</td>
  <td style="padding: 8px; border: 1px solid #ddd;">${
    line.VatGroup || "C4"
  }</td>
  <td style="padding: 8px; border: 1px solid #ddd;">${new Intl.NumberFormat(
    "fr-FR",
    {
      style: "currency",
      currency: "EUR",
    }
  ).format(line.PriceAfterVAT || line.Price * 1.2)}</td>
  <td style="padding: 8px; border: 1px solid #ddd;">${new Intl.NumberFormat(
    "fr-FR",
    {
      style: "currency",
      currency: "EUR",
    }
  ).format(line.LineTotalWithVAT || line.LineTotal * 1.2)}</td>
  </tr>
  `
).join("")}
</tbody>
<tfoot>
<tr style="background-color: #f3f4f6;">
<td colspan="4" style="padding: 8px; border: 1px solid #ddd;"><strong>Total HT</strong></td>
<td style="padding: 8px; border: 1px solid #ddd;"><strong>${new Intl.NumberFormat(
      "fr-FR",
      {
        style: "currency",
        currency: "EUR",
      }
    ).format(quotation.DocTotal)}</strong></td>
<td></td>
</tr>
<tr style="background-color: #f3f4f6;">
<td colspan="4" style="padding: 8px; border: 1px solid #ddd;"><strong>TVA</strong></td>
<td style="padding: 8px; border: 1px solid #ddd;"><strong>${new Intl.NumberFormat(
      "fr-FR",
      {
        style: "currency",
        currency: "EUR",
      }
    ).format(quotation.VatSum || 0)}</strong></td>
<td></td>
</tr>
<tr style="background-color: #f3f4f6;">
<td colspan="4" style="padding: 8px; border: 1px solid #ddd;"><strong>Total TTC</strong></td>
<td style="padding: 8px; border: 1px solid #ddd;"><strong>${new Intl.NumberFormat(
      "fr-FR",
      {
        style: "currency",
        currency: "EUR",
      }
    ).format(quotation.DocTotalWithVAT || quotation.DocTotal)}</strong></td>
<td></td>
</tr>
</tfoot>
    </table>
    <p>If you have any questions, please don't hesitate to contact us.</p>
    <p>Thank you for your business!</p>
`;

    await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: email,
      subject: `Payment Link for Quotation #${quotation.DocNum}`,
      html: emailHtml,
      attachments: [
        {
          filename: `Devis_HFS_${quotation.DocNum}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
          encoding: "binary",
        },
      ],
    });

    await quotation.save();

    res.status(200).json({
      success: true,
      message: "Payment link generated and sent successfully",
      paymentLink,
    });
  } catch (error) {
    console.error("Error in generatePaymentLinkForQuotation:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate payment link",
      details: error.message,
    });
  }
};

// Get payment update for quotation
exports.getUpdateOnPaymentLinkForQuotation = async (req, res) => {
  try {
    const { docNum } = req.params;
    console.log(`Checking payment link status for quotation: ${docNum}`);
    const quotation = await Quotation.findOne({ DocNum: docNum });
    console.log(`Found quotation:`, quotation);

    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: "Quotation not found",
      });
    }

    const response = await axios.get(
      `${process.env.ADYEN_API_BASE_URL}/paymentLinks/${quotation.Payment_id}`,
      {
        headers: {
          "X-API-KEY": process.env.ADYEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`Payment link status for ${docNum}:`, response.data);

    const paymentStatus = response.data.status;
    quotation.payment_status = paymentStatus;
    await quotation.save();

    res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      paymentStatus,
    });
  } catch (error) {
    console.error("Error in getUpdateOnPaymentLinkForQuotation:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update payment status",
      details: error.message,
    });
  }
};

// Helper function to update sales agent stats
async function updateSalesAgentAchievement(salesAgentId, order) {
  const agent = await User.findById(salesAgentId);
  if (!agent) return;

  // Increment a counter of successfully synced orders
  agent.syncedOrderCount = (agent.syncedOrderCount || 0) + 1;
  await agent.save();
}

// Helper function to push converted order to SAP
async function pushOrderToSAPInternal(order) {
  try {
    // Format the order for SAP B1
    const sapOrder = await formatOrderForSAP(order);

    try {
      // First check if business partner exists in SAP
      const businessPartnerExists = await checkBusinessPartnerExists(
        order.CardCode
      );

      if (!businessPartnerExists) {
        // Update order to reflect BP doesn't exist in SAP
        order.SyncErrors = `Business partner ${order.CardCode} does not exist in SAP B1`;
        order.LastSyncAttempt = new Date();
        order.LocalStatus = "SyncFailed";
        order.SAPSyncDisabled = true;
        await order.save();

        return {
          success: false,
          error: order.SyncErrors,
          code: "BP_NOT_FOUND",
        };
      }
    } catch (bpError) {
      console.warn(
        `Could not verify business partner in SAP: ${bpError.message}`
      );
    }

    // Push to SAP B1
    const sapResponse = await createSalesOrderInSAP(sapOrder);

    // Update local order with SAP DocEntry if successful
    if (sapResponse && sapResponse.DocEntry) {
      order.SAPDocEntry = sapResponse.DocEntry;
      order.DocumentStatus = "bost_Closed";
      order.UpdateDate = new Date();
      order.SyncedWithSAP = true;
      order.LocalStatus = "Synced";

      await order.save();

      // Update sales agent stats for synced order
      if (order.salesAgent) {
        await updateSalesAgentAchievement(order.salesAgent, order);
      }

      return {
        success: true,
        SAPDocEntry: sapResponse.DocEntry,
        sapData: sapResponse,
      };
    } else {
      throw new Error("Invalid response from SAP B1");
    }
  } catch (error) {
    // Check for specific error types
    let errorCode = "GENERAL_ERROR";

    if (
      error.message &&
      error.message.includes("Business partner") &&
      error.message.includes("does not exist")
    ) {
      errorCode = "BP_NOT_FOUND";
    } else if (error.message && error.message.includes("Invalid BP code")) {
      errorCode = "INVALID_BP_CODE";
    }

    // Update local order to mark sync failure
    order.SyncErrors = error.message;
    order.LastSyncAttempt = new Date();
    order.LocalStatus = "SyncFailed";

    // If BP doesn't exist, mark order to not attempt sync again
    if (errorCode === "BP_NOT_FOUND" || errorCode === "INVALID_BP_CODE") {
      order.SAPSyncDisabled = true;
    }

    await order.save();

    console.error("Error pushing order to SAP:", error);
    return {
      success: false,
      error: error.message || "Unknown error",
      code: errorCode,
    };
  }
}

// Get quotation data for editing
exports.getQuotationForEdit = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({
      DocEntry: req.params.docEntry,
    }).populate("salesAgent", "firstName lastName email");

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Quotation with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Check permissions for sales agents
    if (
      req.user.role === "sales_agent" &&
      quotation.salesAgent &&
      quotation.salesAgent._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to edit this quotation",
      });
    }

    // Check permissions for sales managers
    if (req.user.role === "sales_manager" && quotation.salesAgent) {
      const agent = await User.findById(quotation.salesAgent._id);
      if (!agent || agent.manager.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to edit this quotation",
        });
      }
    }

    res.status(200).json({
      success: true,
      data: quotation,
      mode: "edit",
    });
  } catch (error) {
    console.error("Error fetching quotation for edit:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching quotation for edit",
      error: error.message,
    });
  }
};

// Prepare quotation data for duplication
exports.prepareQuotationForDuplicate = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({
      DocEntry: req.params.docEntry,
    }).populate("salesAgent", "firstName lastName email");

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Quotation with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Create a copy of the quotation data for duplication
    const quotationData = quotation.toObject();

    // Remove fields that shouldn't be duplicated
    delete quotationData._id;
    delete quotationData.DocEntry;
    delete quotationData.DocNum;
    delete quotationData.CreationDate;
    delete quotationData.UpdateDate;
    delete quotationData.ConvertedToOrderDocEntry;
    delete quotationData.ConvertedDate;
    delete quotationData.approvalTask;
    delete quotationData.approvalStatus;
    delete quotationData.approvedBy;
    delete quotationData.approvedDate;
    delete quotationData.approvalComments;
    delete quotationData.Payment_id;
    delete quotationData.Link_sent;
    delete quotationData.payment_status;
    delete quotationData.emailSentTo;

    // Set new dates
    const today = new Date();
    quotationData.DocDate = today;
    quotationData.DocDueDate = new Date(today.setDate(today.getDate() + 30));

    res.status(200).json({
      success: true,
      data: quotationData,
      mode: "duplicate",
    });
  } catch (error) {
    console.error("Error preparing quotation for duplication:", error);
    res.status(500).json({
      success: false,
      message: "Error preparing quotation for duplication",
      error: error.message,
    });
  }
};

// Get quotation statistics
exports.getQuotationStats = async (req, res) => {
  try {
    const { fromDate, toDate, salesAgent } = req.query;

    // Build filter query with role-based restrictions
    let query = { IsActive: true };

    // Role-based filtering
    if (req.user.role === "sales_agent") {
      // Sales agents can only see their own stats
      query.salesAgent = req.user._id;
    } else if (req.user.role === "sales_manager") {
      // Sales managers can see stats from their team members
      const teamMembers = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      const allAgentIds = [...teamMembers, req.user._id];
      query.salesAgent = { $in: allAgentIds };

      // If specific sales agent requested, verify they're in the team
      if (salesAgent) {
        if (allAgentIds.map((id) => id.toString()).includes(salesAgent)) {
          query.salesAgent = salesAgent;
        } else {
          query.salesAgent = "invalid_agent_id"; // Will return 0 results
        }
      }
    } else if (req.user.role === "admin") {
      // Admins can see all stats, optionally filtered by sales agent
      if (salesAgent) {
        query.salesAgent = salesAgent;
      }
    }

    if (fromDate && toDate) {
      query.DocDate = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    // Get total quotations
    const totalQuotations = await Quotation.countDocuments(query);

    // Get total value
    const totalValueResult = await Quotation.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$DocTotal" } } },
    ]);
    const totalValue = totalValueResult[0]?.total || 0;

    // Get pending approval count
    const pendingApproval = await Quotation.countDocuments({
      ...query,
      approvalStatus: "pending",
    });

    // Calculate conversion rate
    const convertedQuotations = await Quotation.countDocuments({
      ...query,
      ConvertedToOrderDocEntry: { $exists: true },
      IsActive: false,
    });

    const conversionRate =
      totalQuotations > 0
        ? `${Math.round((convertedQuotations / totalQuotations) * 100)}%`
        : "0%";

    res.status(200).json({
      success: true,
      data: {
        totalQuotations,
        totalValue,
        pendingApproval,
        conversionRate,
      },
    });
  } catch (error) {
    console.error("Error getting quotation stats:", error);
    res.status(500).json({
      success: false,
      message: "Error getting quotation statistics",
      error: error.message,
    });
  }
};

// Export quotations
exports.exportQuotations = async (req, res) => {
  try {
    const { fromDate, toDate, salesAgent, status, cardCode } = req.query;

    // Build filter query
    let query = { IsActive: true };

    if (fromDate && toDate) {
      query.DocDate = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    if (salesAgent) query.salesAgent = salesAgent;
    if (status) query.DocumentStatus = status;
    if (cardCode) query.CardCode = cardCode;

    const quotations = await Quotation.find(query)
      .populate("salesAgent", "firstName lastName")
      .sort({ DocDate: -1 });

    // Convert to CSV format
    const csvData = quotations.map((q) => ({
      DocNum: q.DocNum,
      CardCode: q.CardCode,
      CardName: q.CardName,
      SalesAgent: q.salesAgent
        ? `${q.salesAgent.firstName} ${q.salesAgent.lastName}`
        : "Unknown",
      DocTotal: q.DocTotal,
      DocDate: q.DocDate ? q.DocDate.toISOString().split("T")[0] : "",
      Status: q.approvalStatus || q.DocumentStatus,
    }));

    // Create CSV string
    const headers = Object.keys(csvData[0] || {}).join(",");
    const rows = csvData.map((row) => Object.values(row).join(","));
    const csv = [headers, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=quotations.csv");
    res.status(200).send(csv);
  } catch (error) {
    console.error("Error exporting quotations:", error);
    res.status(500).json({
      success: false,
      message: "Error exporting quotations",
      error: error.message,
    });
  }
};

// Approve quotation
// Approve quotation
exports.approveQuotation = async (req, res) => {
  try {
    const { docEntry } = req.params;
    const { comments } = req.body;

    const quotation = await Quotation.findOne({
      DocEntry: docEntry,
      IsActive: true,
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Quotation with DocEntry ${docEntry} not found`,
      });
    }

    quotation.approvalStatus = "approved";
    quotation.approvedBy = req.user._id;
    quotation.approvedDate = new Date();
    if (comments) quotation.approvalComments = comments;
    quotation.UpdateDate = new Date();

    await quotation.save();

    // CRITICAL FIX: Update related task to completed when quotation is approved
    if (quotation.approvalTask) {
      const approvalTask = await Task.findById(quotation.approvalTask);
      if (approvalTask) {
        approvalTask.status = "completed";
        approvalTask.completedDate = new Date();

        // Add approval comment to task
        const taskComment = `Quotation approved by ${req.user.firstName} ${
          req.user.lastName
        }${comments ? ": " + comments : ""}`;
        approvalTask.comments = approvalTask.comments
          ? `${approvalTask.comments}\n\n${taskComment}`
          : taskComment;

        await approvalTask.save();
      }
    }

    res.status(200).json({
      success: true,
      data: quotation,
      message: "Quotation approved successfully",
    });
  } catch (error) {
    console.error("Error approving quotation:", error);
    res.status(500).json({
      success: false,
      message: "Error approving quotation",
      error: error.message,
    });
  }
};

// Reject quotation
// Reject quotation
exports.rejectQuotation = async (req, res) => {
  try {
    const { docEntry } = req.params;
    const { reason } = req.body;

    const quotation = await Quotation.findOne({
      DocEntry: docEntry,
      IsActive: true,
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Quotation with DocEntry ${docEntry} not found`,
      });
    }

    quotation.approvalStatus = "rejected";
    quotation.rejectedBy = req.user._id;
    quotation.rejectedDate = new Date();
    if (reason) quotation.rejectionReason = reason;
    quotation.UpdateDate = new Date();

    await quotation.save();

    // CRITICAL FIX: Update related task to rejected when quotation is rejected
    if (quotation.approvalTask) {
      const approvalTask = await Task.findById(quotation.approvalTask);
      if (approvalTask) {
        approvalTask.status = "rejected";

        // Add rejection comment to task
        const taskComment = `Quotation rejected by ${req.user.firstName} ${
          req.user.lastName
        }${reason ? ": " + reason : ""}`;
        approvalTask.comments = approvalTask.comments
          ? `${approvalTask.comments}\n\n${taskComment}`
          : taskComment;

        await approvalTask.save();
      }
    }

    res.status(200).json({
      success: true,
      data: quotation,
      message: "Quotation rejected successfully",
    });
  } catch (error) {
    console.error("Error rejecting quotation:", error);
    res.status(500).json({
      success: false,
      message: "Error rejecting quotation",
      error: error.message,
    });
  }
};

// Bulk update status
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { docEntries, status } = req.body;

    if (!docEntries || !Array.isArray(docEntries) || docEntries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "DocEntries array is required",
      });
    }

    const updateData = {
      approvalStatus: status,
      UpdateDate: new Date(),
    };

    if (status === "approved") {
      updateData.approvedBy = req.user._id;
      updateData.approvedDate = new Date();
    } else if (status === "rejected") {
      updateData.rejectedBy = req.user._id;
      updateData.rejectedDate = new Date();
    }

    const result = await Quotation.updateMany(
      { DocEntry: { $in: docEntries }, IsActive: true },
      updateData
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} quotations updated successfully`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error bulk updating quotations:", error);
    res.status(500).json({
      success: false,
      message: "Error bulk updating quotations",
      error: error.message,
    });
  }
};

// Create a new quotation (saved to local DB only)
exports.createQuotation = async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.CardCode) {
      return res.status(400).json({
        success: false,
        message: "Customer (CardCode) is required",
      });
    }

    const salesAgentId = req.user._id;

    // Validate that at least one document line exists
    if (!req.body.DocumentLines || req.body.DocumentLines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Quotation must contain at least one item",
      });
    }

    // Validate items without checking stock availability
    const itemCodes = req.body.DocumentLines.map((line) => line.ItemCode);
    const items = await Item.find({ ItemCode: { $in: itemCodes } });
    const adminUsers = await User.find({ role: "admin" }).select("_id");

    // Create a map for quick lookups
    const itemMap = {};
    items.forEach((item) => {
      itemMap[item.ItemCode] = item;
    });

    // Check if all items exist
    const invalidItems = [];
    for (const line of req.body.DocumentLines) {
      const item = itemMap[line.ItemCode];

      if (!item) {
        invalidItems.push({
          ItemCode: line.ItemCode,
          error: "Item not found",
        });
        continue;
      }

      // Add item description if not provided
      if (!line.ItemDescription && item.ItemName) {
        line.ItemDescription = item.ItemName;
      }
    }

    if (invalidItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Quotation contains invalid items",
        invalidItems,
      });
    }

    // Generate DocEntry
    const lastQuotation = await Quotation.findOne().sort({ DocEntry: -1 });
    const newDocEntry = lastQuotation ? lastQuotation.DocEntry + 1 : 1;

    // Calculate today's date
    const today = new Date();

    // CRITICAL FIX: Process document lines to ensure price list consistency

    const priceList = req.body.PriceList || "2"; // Default to Prix Livraison
    const processedDocumentLines = req.body.DocumentLines.map((line) => ({
      ...line,
      // CRITICAL FIX: Ensure each line has the price list info
      PriceList: priceList,
      // Ensure line total is calculated correctly
      LineTotal: (line.Quantity || 0) * (line.Price || 0),
      // ADD VAT FIELDS
      PriceAfterVAT: line.PriceAfterVAT || 0,
      VatGroup: line.VatGroup || "C4", // Default VAT group
      LineTotalWithVAT: line.LineTotalWithVAT || 0,
    }));

    // Create the new quotation
    const newQuotation = new Quotation({
      ...req.body,
      DocEntry: newDocEntry,
      DocNum: newDocEntry,
      DocType: req.body.DocType || "dDocument_Items",
      DocumentStatus: "bost_Open",
      CreationDate: today,
      DocDate: req.body.DocDate || today,
      DocDueDate: req.body.DocDueDate || today,
      UpdateDate: today,
      SyncedWithSAP: false,
      LocalStatus: "Created",
      salesAgent: salesAgentId,
      IsActive: true,

      // CRITICAL FIX: Ensure price list is set at quotation level
      PriceList: priceList,

      // CRITICAL FIX: Use processed document lines
      DocumentLines: processedDocumentLines,
    });

    // Calculate totals if not provided - INCLUDE VAT TOTALS
    if (!newQuotation.DocTotal) {
      let totalExVAT = 0;
      let totalIncVAT = 0;

      for (const line of newQuotation.DocumentLines) {
        totalExVAT += line.LineTotal || 0;
        totalIncVAT += line.LineTotalWithVAT || 0;
      }

      newQuotation.DocTotal = totalExVAT; // Base total (ex VAT)
      newQuotation.DocTotalWithVAT = totalIncVAT; // Total with VAT
      newQuotation.VatSum = totalIncVAT - totalExVAT; // VAT amount
    }

    if (adminUsers.length > 0) {
      // Assign to the first admin (or you could implement round-robin assignment)
      const adminId = adminUsers[0]._id;

      // Create new task for quotation approval
      const task = new Task({
        title: `Approve Quotation #${newQuotation.DocNum}`,
        description: `Review and approve quotation #${
          newQuotation.DocNum
        } for ${newQuotation.CardName} (${
          newQuotation.CardCode
        }) - Total: $${newQuotation.DocTotal.toFixed(2)}`,
        dueDate: new Date(new Date().setDate(new Date().getDate() + 1)), // Due tomorrow
        priority: "medium",
        type: "approval",
        status: "pending_approval",
        assignedTo: adminId,
        createdBy: salesAgentId,
        relatedQuotation: newQuotation.DocEntry,
      });

      await task.save();

      // Link the task to the quotation
      newQuotation.approvalTask = task._id;
      newQuotation.approvalStatus = "pending";
    }

    await newQuotation.save();

    res.status(201).json({
      success: true,
      data: newQuotation,
      message: "Quotation created successfully",
    });
  } catch (error) {
    console.error("Error creating quotation:", error);
    res.status(500).json({
      success: false,
      message: "Error creating quotation",
      error: error.message,
    });
  }
};

// Get all quotations with pagination
exports.getAllQuotations = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log("Query parameters for fetching quotations:", req.query);
    console.log("User role:", req.user.role);
    console.log("User ID:", req.user._id);

    // Base query - only show active quotations by default
    let query = { IsActive: true };

    // Add option to show inactive quotations if requested
    if (req.query.showInactive === "true") {
      query = {};
    }

    // Role-based filtering
    if (req.user.role === "sales_agent") {
      // Sales agents can only see their own quotations
      query.salesAgent = req.user._id;
    } else if (req.user.role === "sales_manager") {
      // Sales managers can see quotations from their team members
      const teamMembers = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      // Include the manager's own quotations if they have any
      const allAgentIds = [...teamMembers, req.user._id];
      query.salesAgent = { $in: allAgentIds };
    }
    // Admin users can see all quotations (no additional filtering)

    // Add filters if provided
    if (req.query.cardCode) {
      query.CardCode = { $regex: req.query.cardCode, $options: "i" };
    }

    if (req.query.search) {
      const searchRegex = { $regex: req.query.search, $options: "i" };
      query.$or = [
        { CardName: searchRegex },
        { CardCode: searchRegex },
        { DocNum: req.query.search },
      ];
    }

    if (req.query.status) {
      if (req.query.status === "converted") {
        query.ConvertedToOrderDocEntry = { $exists: true };
        query.IsActive = false;
      } else if (req.query.status === "cancelled") {
        query.IsActive = false;
        query.ConvertedToOrderDocEntry = { $exists: false };
      } else {
        query.approvalStatus = req.query.status;
      }
    }

    if (req.query.fromDate && req.query.toDate) {
      query.DocDate = {
        $gte: new Date(req.query.fromDate),
        $lte: new Date(req.query.toDate),
      };
    }

    if (req.query.fromDate && !req.query.toDate) {
      query.DocDate = {
        $gte: new Date(req.query.fromDate),
      };
    }

    if (!req.query.fromDate && req.query.toDate) {
      query.DocDate = {
        $lte: new Date(req.query.toDate),
      };
    }

    // Additional sales agent filter for sales managers
    if (req.query.salesAgent && req.user.role === "sales_manager") {
      // Verify the requested agent is in their team
      const teamMembers = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      const requestedAgentId = req.query.salesAgent;

      if (
        teamMembers.map((id) => id.toString()).includes(requestedAgentId) ||
        requestedAgentId === req.user._id.toString()
      ) {
        query.salesAgent = requestedAgentId;
      } else {
        // If requesting an agent not in their team, return empty results
        query.salesAgent = "invalid_agent_id";
      }
    }

    // Sorting
    const sortBy = req.query.sortBy || "DocDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder;

    console.log("Final query:", JSON.stringify(query, null, 2));

    const quotations = await Quotation.find(query)
      .populate("salesAgent", "firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort(sortOptions);

    const total = await Quotation.countDocuments(query);

    res.status(200).json({
      success: true,
      count: quotations.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: quotations,
    });
  } catch (error) {
    console.error("Error fetching quotations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching quotations",
      error: error.message,
    });
  }
};

// Get quotations for a specific customer
exports.getQuotationsByCustomer = async (req, res) => {
  try {
    const { cardCode } = req.params;
    console.log("Fetching quotations for customer:", cardCode);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Base query - only show active quotations by default
    const query = { CardCode: cardCode };

    // Add option to show inactive quotations if requested
    if (req.query.showInactive === "true") {
      delete query.IsActive;
    }

    // If sales manager, get all quotations from their agents
    if (req.user.role === "sales_manager") {
      const agentIds = await User.find({ manager: req.user._id }).distinct(
        "_id"
      );
      query.salesAgent = { $in: agentIds };
    }

    const quotations = await Quotation.find(query)
      .populate("salesAgent", "firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort({ DocDate: -1 });

    const total = await Quotation.countDocuments(query);

    res.status(200).json({
      success: true,
      count: quotations.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      customerCode: cardCode,
      data: quotations,
    });
  } catch (error) {
    console.log("Error fetching customer quotations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer quotations",
      error: error.message,
    });
  }
};

// Get a single quotation by DocEntry
exports.getQuotationByDocEntry = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({
      DocEntry: req.params.docEntry,
    }).populate("salesAgent", "firstName lastName email");

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Quotation with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Check permissions for sales agents
    if (
      req.user.role === "sales_agent" &&
      quotation.salesAgent &&
      quotation.salesAgent._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this quotation",
      });
    }

    // Check permissions for sales managers
    if (req.user.role === "sales_manager" && quotation.salesAgent) {
      const agent = await User.findById(quotation.salesAgent._id);
      if (!agent || agent.manager.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to view this quotation",
        });
      }
    }

    res.status(200).json({
      success: true,
      data: quotation,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching quotation",
      error: error.message,
    });
  }
};

// Convert quotation to sales order
exports.convertToOrder = async (req, res) => {
  try {
    // Find the quotation
    const quotation = await Quotation.findOne({
      DocEntry: req.params.docEntry,
      IsActive: true,
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Active quotation with DocEntry ${req.params.docEntry} not found`,
      });
    }

    if (quotation.approvalStatus !== "approved") {
      return res.status(403).json({
        success: false,
        message:
          "Quotation must be approved by an admin before conversion to order",
      });
    }

    // Check permissions for sales agents
    if (
      req.user.role === "sales_agent" &&
      quotation.salesAgent &&
      quotation.salesAgent.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to convert this quotation",
      });
    }

    const userId = req.user._id;
    const userName = req.user.firstName + " " + req.user.lastName;

    // Generate DocEntry for the new order
    const lastOrder = await SalesOrder.findOne().sort({ DocEntry: -1 });
    const newDocEntry = lastOrder ? lastOrder.DocEntry + 1 : 1;

    const paymentStatus = quotation.payment_status || "not paid";
    const paymentId = quotation.Payment_id || "no payment link";

    const salesAgentName =
      "This order was created from a quotation by " +
      userName +
      " (Quotation ID: " +
      quotation.DocEntry +
      "). With the payment status " +
      paymentStatus +
      " (" +
      paymentId +
      "). ";

    // FIXED: Ensure price list is properly transferred
    const quotationData = quotation.toObject();

    // Process document lines to ensure price list consistency
    // Process document lines to ensure price list consistency AND VAT
    const processedDocumentLines = quotationData.DocumentLines.map((line) => ({
      ...line,
      // CRITICAL FIX: Ensure each line has the correct price list
      PriceList: quotationData.PriceList || "2", // Default to Prix Livraison if not set
      // Ensure line total is recalculated
      LineTotal: (line.Quantity || 0) * (line.Price || 0),
      // CRITICAL FIX: Preserve VAT information
      PriceAfterVAT: line.PriceAfterVAT || 0,
      VatGroup: line.VatGroup || "C4",
      LineTotalWithVAT: line.LineTotalWithVAT || 0,
    }));

    // Create the sales order from the quotation data
    const newOrder = new SalesOrder({
      // Copy all fields from quotation except specific fields that need to be fresh
      ...quotationData,
      DocEntry: newDocEntry,
      DocNum: newDocEntry,
      CreationDate: new Date(),
      UpdateDate: new Date(),
      DocDate: req.body.DocDate || new Date(),
      DocDueDate: req.body.DocDueDate || new Date(),
      SyncedWithSAP: false,
      LocalStatus: "Created",

      // CRITICAL FIX: Ensure price list is set at order level
      PriceList: quotationData.PriceList || "2",

      // CRITICAL FIX: Use processed document lines with price list info
      DocumentLines: processedDocumentLines,

      // Override with any additional data from the request body
      ...req.body,

      // Ensure we keep the original references
      salesAgent: quotation.salesAgent,

      // Reference to original quotation
      OriginatingQuotation: quotation.DocEntry,
      U_Notes: salesAgentName,
    });

    // Save the new order
    await newOrder.save();

    // Mark quotation as inactive (converted)
    quotation.IsActive = false;
    quotation.ConvertedToOrderDocEntry = newOrder.DocEntry;
    quotation.ConvertedDate = new Date();
    await quotation.save();

    // Push to SAP
    console.log("Pushing converted order to SAP...");
    const sapResult = await pushOrderToSAPInternal(newOrder);

    // Return response
    if (sapResult.success) {
      res.status(201).json({
        success: true,
        data: newOrder,
        originalQuotation: {
          DocEntry: quotation.DocEntry,
          status: "Converted",
        },
        message:
          "Quotation successfully converted to order and synced with SAP",
        sapSync: {
          success: true,
          SAPDocEntry: sapResult.SAPDocEntry,
        },
      });
    } else {
      // Customize message based on error code
      let sapErrorMessage = "Failed to sync with SAP";

      if (
        sapResult.code === "BP_NOT_FOUND" ||
        sapResult.code === "INVALID_BP_CODE"
      ) {
        sapErrorMessage = `Business partner ${newOrder.CardCode} does not exist in SAP B1`;
      }

      res.status(201).json({
        success: true,
        data: newOrder,
        originalQuotation: {
          DocEntry: quotation.DocEntry,
          status: "Converted",
        },
        message: "Quotation converted to order but failed to sync with SAP",
        sapSync: {
          success: false,
          error: sapResult.error,
          message: sapErrorMessage,
          code: sapResult.code,
        },
      });
    }
  } catch (error) {
    console.error("Error converting quotation to order:", error);
    res.status(500).json({
      success: false,
      message: "Error converting quotation to order",
      error: error.message,
    });
  }
};

// Update quotation
exports.updateQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({
      DocEntry: req.params.docEntry,
      IsActive: true,
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Active quotation with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Check permissions for sales agents
    if (
      req.user.role === "sales_agent" &&
      quotation.salesAgent &&
      quotation.salesAgent.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this quotation",
      });
    }

    // Fields that cannot be updated
    const protectedFields = [
      "DocEntry",
      "DocNum",
      "CreationDate",
      "salesAgent",
      "IsActive",
      "ConvertedToOrderDocEntry",
      "ConvertedDate",
      "SyncedWithSAP",
      "SAPDocEntry",
    ];

    // Remove protected fields from the update
    protectedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        delete req.body[field];
      }
    });

    // Update allowed fields
    Object.keys(req.body).forEach((key) => {
      quotation[key] = req.body[key];
    });

    // Update the UpdateDate
    quotation.UpdateDate = new Date();

    // Recalculate totals if DocumentLines are updated
    if (req.body.DocumentLines) {
      let totalExVAT = 0;
      let totalIncVAT = 0;

      for (const line of quotation.DocumentLines) {
        const lineTotal = (line.Quantity || 0) * (line.Price || 0);
        const lineTotalWithVAT = line.LineTotalWithVAT || lineTotal * 1.2;

        line.LineTotal = lineTotal;
        line.LineTotalWithVAT = lineTotalWithVAT;

        totalExVAT += lineTotal;
        totalIncVAT += lineTotalWithVAT;
      }

      quotation.DocTotal = totalExVAT;
      quotation.DocTotalWithVAT = totalIncVAT;
      quotation.VatSum = totalIncVAT - totalExVAT;
    }

    // **CRITICAL FIX: Reset approval status for ANY update**
    // Only reset if currently approved or rejected (don't reset if already pending)
    if (
      quotation.approvalStatus === "approved" ||
      quotation.approvalStatus === "rejected"
    ) {
      quotation.approvalStatus = "pending";

      // Clear previous approval/rejection data
      quotation.approvedBy = undefined;
      quotation.approvedDate = undefined;
      quotation.rejectedBy = undefined;
      quotation.rejectedDate = undefined;
      quotation.rejectionReason = undefined;
      quotation.approvalComments = undefined;

      // Create new approval task
      const adminUsers = await User.find({ role: "admin" }).select("_id");
      if (adminUsers.length > 0) {
        const adminId = adminUsers[0]._id;

        const Task = require("../models/Task");

        // Cancel/complete old approval task first
        if (quotation.approvalTask) {
          await Task.findByIdAndUpdate(quotation.approvalTask, {
            status: "cancelled",
            comments: `Task cancelled due to quotation update by ${req.user.firstName} ${req.user.lastName}`,
          });
        }

        const task = new Task({
          title: `Approve Updated Quotation #${quotation.DocNum}`,
          description: `Review and approve updated quotation #${
            quotation.DocNum
          } for ${quotation.CardName} (${
            quotation.CardCode
          }) - Total: €${quotation.DocTotal.toFixed(2)}`,
          dueDate: new Date(new Date().setDate(new Date().getDate() + 1)),
          priority: "medium",
          type: "approval",
          status: "pending",
          assignedTo: adminId,
          createdBy: req.user._id,
          relatedQuotation: quotation.DocEntry,
        });

        await task.save();
        quotation.approvalTask = task._id;
      }
    }

    await quotation.save();

    const responseMessage =
      quotation.approvalStatus === "pending"
        ? "Quotation updated successfully and sent for re-approval"
        : "Quotation updated successfully";

    res.status(200).json({
      success: true,
      data: quotation,
      message: responseMessage,
    });
  } catch (error) {
    console.error("Error updating quotation:", error);
    res.status(500).json({
      success: false,
      message: "Error updating quotation",
      error: error.message,
    });
  }
};
// Cancel/deactivate quotation
exports.cancelQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({
      DocEntry: req.params.docEntry,
      IsActive: true,
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Active quotation with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Deactivate the quotation
    quotation.IsActive = false;
    quotation.CancelReason = req.body.reason || "Cancelled by user";
    quotation.CancelDate = new Date();
    quotation.DocumentStatus = "bost_Close"; // Or another appropriate status

    await quotation.save();

    res.status(200).json({
      success: true,
      data: {
        DocEntry: quotation.DocEntry,
        status: "Cancelled",
        reason: quotation.CancelReason,
      },
      message: "Quotation cancelled successfully",
    });
  } catch (error) {
    console.error("Error cancelling quotation:", error);
    res.status(500).json({
      success: false,
      message: "Error cancelling quotation",
      error: error.message,
    });
  }
};

// Duplicate quotation
exports.duplicateQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findOne({
      DocEntry: req.params.docEntry,
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Quotation with DocEntry ${req.params.docEntry} not found`,
      });
    }

    // Generate new DocEntry
    const lastQuotation = await Quotation.findOne().sort({ DocEntry: -1 });
    const newDocEntry = lastQuotation ? lastQuotation.DocEntry + 1 : 1;

    const quotationObject = quotation.toObject();
    delete quotationObject._id;

    // Create new quotation based on the original
    const duplicatedQuotation = new Quotation({
      ...quotationObject,
      DocEntry: newDocEntry,
      DocNum: newDocEntry,
      CreationDate: new Date(),
      UpdateDate: new Date(),
      DocDate: new Date(),
      DocDueDate: new Date(),
      IsActive: true,
      // Keep the same sales agent
      salesAgent: quotation.salesAgent,
      // Reference to the original
      DuplicatedFrom: quotation.DocEntry,
    });

    // Remove any converted/cancelled statuses from the original
    delete duplicatedQuotation.ConvertedToOrderDocEntry;
    delete duplicatedQuotation.ConvertedDate;
    delete duplicatedQuotation.CancelReason;
    delete duplicatedQuotation.CancelDate;

    await duplicatedQuotation.save();

    res.status(201).json({
      success: true,
      data: duplicatedQuotation,
      originalQuotation: {
        DocEntry: quotation.DocEntry,
      },
      message: "Quotation duplicated successfully",
    });
  } catch (error) {
    console.error("Error duplicating quotation:", error);
    res.status(500).json({
      success: false,
      message: "Error duplicating quotation",
      error: error.message,
    });
  }
};

// Add to controllers/quotation.controller.js

exports.sendQuotationByEmail = async (req, res) => {
  try {
    console.log("Received request to send quotation by email", req.body);
    const quotationId = req.params.docEntry;
    const emailData = req.body;

    if (!emailData || !emailData.to) {
      return res.status(400).json({
        success: false,
        message: "Recipient email address is required",
      });
    }

    console.log(
      `Processing quotation ${quotationId} for email to ${emailData.to}`
    );

    // Find the quotation
    const quotation = await Quotation.findOne({
      DocEntry: quotationId,
    }).populate("salesAgent", "firstName lastName email");

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: `Quotation with ID ${quotationId} not found`,
      });
    }

    // Find the customer
    const customer = await Customer.findOne({
      CardCode: quotation.CardCode,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: `Customer with CardCode ${quotation.CardCode} not found`,
      });
    }
    const customerForTemplate = {
      CardName: customer.CardName || "Customer",
      // Directly flatten address fields to avoid nested property access issues
      street: customer.address?.street || customer.Address || "",
      city: customer.address?.city || customer.City || "",
      zipCode: customer.address?.zipCode || customer.ZipCode || "",
      Country: customer.Country || "",
      Phone: customer.Phone || customer.Telephone || "",
    };

    console.log("Prepared customer template data:", customerForTemplate);
    console.log("Here is the customer", customer);

    // Generate PDF
    console.log("Generating PDF...");
    let pdfBuffer;
    try {
      const pdfGenerator = require("../utils/pdfGenerator");
      pdfBuffer = await pdfGenerator.generateQuotationPDF(
        quotation,
        customerForTemplate
      );
      // Log PDF details
      console.log(`PDF generated successfully: ${pdfBuffer.length} bytes`);
    } catch (pdfError) {
      console.error("Error generating PDF:", pdfError);
      return res.status(500).json({
        success: false,
        message: `Error generating PDF: ${pdfError.message}`,
      });
    }

    // Send email with attachment
    console.log("Sending email with PDF attachment...");
    try {
      const emailService = require("../utils/emailService");

      // Format the email for better deliverability
      const emailText =
        emailData.message ||
        `Cher client,\n\nVeuillez trouver ci-joint votre devis #${quotation.DocNum}.\n\nCordialement,\nL'équipe Halal Food Service`;

      const emailHtml = emailText.replace(/\n/g, "<br>");

      const info = await emailService.sendEmail({
        to: emailData.to,
        cc: emailData.cc || "",
        subject: emailData.subject || `Devis HFS #${quotation.DocNum}`,
        text: emailText,
        html: emailHtml,
        attachments: [
          {
            filename: `Devis_HFS_${quotation.DocNum}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
            encoding: "binary",
          },
        ],
      });

      // Record email sent
      quotation.emailSentTo = quotation.emailSentTo || [];
      quotation.emailSentTo.push({
        email: emailData.to,
        sentBy: req.user._id,
        sentDate: new Date(),
        messageId: info.messageId,
      });

      await quotation.save();

      return res.status(200).json({
        success: true,
        message: "Email sent successfully",
        messageId: info.messageId,
      });
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      return res.status(500).json({
        success: false,
        message: `Error sending email: ${emailError.message}`,
      });
    }
  } catch (error) {
    console.error("Error in sendQuotationByEmail:", error);
    return res.status(500).json({
      success: false,
      message: `An unexpected error occurred: ${error.message}`,
    });
  }
};
// Helper functions

// Generate PDF from quotation data (implementation depends on your PDF library)
async function generateQuotationPDF(quotation) {
  try {
    // This is a placeholder - you would use a PDF library like PDFKit, Puppeteer, or html-pdf
    // To convert your quotation HTML template to PDF

    // Example with puppeteer (you would need to install it):
    // const puppeteer = require('puppeteer');
    // const browser = await puppeteer.launch();
    // const page = await browser.newPage();
    // await page.setContent(quotationHTMLTemplate(quotation));
    // const pdfBuffer = await page.pdf({ format: 'A4' });
    // await browser.close();
    // return pdfBuffer;

    // Placeholder implementation
    const pdfBuffer = Buffer.from("PDF content would be here");
    return pdfBuffer;
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw new Error("Failed to generate quotation PDF");
  }
}

// Updated sendEmailWithAttachment function with full implementation
async function sendEmailWithAttachment({ to, cc, subject, text, attachments }) {
  try {
    const nodemailer = require("nodemailer");
    const config = require("../config/config");

    // Create reusable transporter using SMTP configuration
    const transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465, // true for 465, false for other ports
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
      // Optional: Configure for SSL verification if needed
      tls: {
        rejectUnauthorized: false, // Only set to false if required for self-signed certificates
      },
    });

    // Prepare email options
    const mailOptions = {
      from: `"${config.email.senderName}" <${config.email.user}>`,
      to: to,
      subject: subject,
      text: text,
    };

    // Add CC if provided
    if (cc && cc.trim() !== "") {
      mailOptions.cc = cc;
    }

    // Add HTML version of the message for better formatting
    if (text) {
      // Convert plain text to HTML
      mailOptions.html = text.replace(/\n/g, "<br>");
    }

    // Add attachments if provided
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    // Log that we're about to send an email (for debugging)
    console.log(`Sending email to ${to}${cc ? " with CC to " + cc : ""}`);

    // Verify connection configuration before sending
    transporter.verify(function (error, success) {
      if (error) {
        console.error("SMTP verification error:", error);
      } else {
        console.log("SMTP server is ready to take our messages");
      }
    });

    // Send mail with defined transport object
    const info = await transporter.sendMail(mailOptions);

    // Log success
    console.log(
      `Email sent successfully to ${to}. Message ID: ${info.messageId}`
    );

    // If SMTP server provides delivery status, log it
    if (info.accepted && info.accepted.length > 0) {
      console.log(
        `Email accepted by SMTP server for: ${info.accepted.join(", ")}`
      );
    }

    if (info.rejected && info.rejected.length > 0) {
      console.warn(
        `Email rejected by SMTP server for: ${info.rejected.join(", ")}`
      );
    }

    return info;
  } catch (error) {
    console.error("Error sending email:", error);

    // Provide more detailed error information
    let errorMessage = "Failed to send email";

    if (error.code === "ECONNREFUSED") {
      errorMessage =
        "Could not connect to email server. Please check SMTP configuration.";
    } else if (error.code === "EAUTH") {
      errorMessage =
        "Email authentication failed. Please check username and password.";
    } else if (error.responseCode) {
      errorMessage = `SMTP Error: ${error.responseCode} - ${
        error.response || error.message
      }`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new Error(errorMessage);
  }
}

async function logEmailActivity(userId, quotationDocEntry, recipient) {
  try {
    // If you have an EmailLog model, you can use it here
    const EmailLog = require("../models/EmailLog");

    await EmailLog.create({
      user: userId,
      quotationDocEntry,
      recipient,
      timestamp: new Date(),
      type: "quotation_email",
    });

    console.log(
      `Email log created for quotation ${quotationDocEntry} sent to ${recipient}`
    );
  } catch (error) {
    console.error("Error logging email activity:", error);
    // Don't throw here as this is a non-critical operation
  }
}
module.exports = exports;
