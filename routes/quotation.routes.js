// routes/quotationRoutes.js
const express = require("express");
const router = express.Router();
const quotationController = require("../controllers/quotation.controller");
const { auth } = require("../middleware/auth");

// Add these routes to your quotationRoutes.js file
router.post(
  "/:docNum/generate-payment-link",
  quotationController.generatePaymentLinkForQuotation
);
router.get(
  "/:docNum/payment-status",
  quotationController.getUpdateOnPaymentLinkForQuotation
);

// Add these new routes to your existing quotationRoutes.js file
// @route   GET /api/quotations/:docEntry/edit-data
// @desc    Get quotation data for editing
// @access  Private
router.get(
  "/:docEntry/edit-data",
  auth,
  quotationController.getQuotationForEdit
);

// @route   POST /api/quotations/:docEntry/prepare-duplicate
// @desc    Prepare quotation data for duplication
// @access  Private
router.post(
  "/:docEntry/prepare-duplicate",
  auth,
  quotationController.prepareQuotationForDuplicate
);
// @route   GET /api/quotations/stats
// @desc    Get quotation statistics
// @access  Private (Admin only)
router.get("/stats", auth, quotationController.getQuotationStats);

// @route   GET /api/quotations/export
// @desc    Export quotations to CSV
// @access  Private (Admin only)
router.get("/export", auth, quotationController.exportQuotations);

// @route   POST /api/quotations/:docEntry/approve
// @desc    Approve a quotation
// @access  Private (Admin only)
router.post("/:docEntry/approve", auth, quotationController.approveQuotation);

// @route   POST /api/quotations/:docEntry/reject
// @desc    Reject a quotation
// @access  Private (Admin only)
router.post("/:docEntry/reject", auth, quotationController.rejectQuotation);

// @route   PUT /api/quotations/bulk/status
// @desc    Bulk update quotation status
// @access  Private (Admin only)
router.put("/bulk/status", auth, quotationController.bulkUpdateStatus);
// @route   POST /api/quotations
// @desc    Create a new quotation in local DB
// @access  Private
router.post("/", auth, quotationController.createQuotation);

// @route   GET /api/quotations
// @desc    Get all quotations with pagination and filtering
// @access  Private
router.get(
  "/cardCode/:cardCode",
  auth,
  quotationController.getQuotationsByCustomer
);
router.get("/", auth, quotationController.getAllQuotations);

// @route   GET /api/quotations/cardCode/:cardCode
// @desc    Get quotations for a specific customer
// @access  Private

// @route   GET /api/quotations/:docEntry
// @desc    Get a single quotation by DocEntry
// @access  Private
router.get("/:docEntry", auth, quotationController.getQuotationByDocEntry);

// @route   PATCH /api/quotations/:docEntry
// @desc    Update a quotation
// @access  Private
router.patch("/:docEntry", auth, quotationController.updateQuotation);

// @route   POST /api/quotations/:docEntry/convert
// @desc    Convert a quotation to a sales order
// @access  Private
router.post("/:docEntry/convert", auth, quotationController.convertToOrder);

// @route   PATCH /api/quotations/:docEntry/cancel
// @desc    Cancel/deactivate a quotation
// @access  Private
router.patch("/:docEntry/cancel", auth, quotationController.cancelQuotation);

// @route   POST /api/quotations/:docEntry/duplicate
// @desc    Create a duplicate of an existing quotation
// @access  Private
router.post(
  "/:docEntry/duplicate",
  auth,
  quotationController.duplicateQuotation
);

// Send quotation by email
router.post(
  "/:docEntry/send-email",
  auth,
  quotationController.sendQuotationByEmail
);

module.exports = router;
