// routes/customer.routes.js
const express = require("express");
const multer = require("multer");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const {
  auth,
  checkRole,
  canManageCustomer,
  updateLastLogin,
} = require("../middleware/auth");
const customerController = require("../controllers/customer.controller");

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("Created uploads directory in routes:", uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExt = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + fileExt);
  },
});

// File filter to allow specific file types
const fileFilter = (req, file, cb) => {
  // Accept Excel, CSV, and text files
  const allowedExtensions = [".xlsx", ".xls", ".csv", ".txt"];
  const fileExt = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error("Only Excel, CSV, and text files are allowed"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB file size limit
  },
});

router.post("/create", auth,customerController.createCustomer);

// Route for mapping HubSpot emails and phones
router.post(
  "/map-hubspot-emails-phones",
  upload.single("file"),
  customerController.mapHubspotEmailsAndPhones
);

router.get(
  "/get-customer-by-card/:cardCode",

  customerController.getCustomerByCardCode
);

router.get(
  "/get-customer-email/:cardCode",
  auth,
  customerController.getCustomerEmailByCode
);
router.get(
  "/preview-zero-value",
  customerController.previewZeroValueAbandonedCarts
);

// Route for removing zero-value abandoned carts (admin only with multiple safety checks)
router.delete(
  "/remove-zero-value",
  customerController.removeZeroValueAbandonedCarts
);
// Add this route to your customer.routes.js file after the existing routes
router.post(
  "/assign-from-file",
  upload.single("file"),
  customerController.assignCustomersFromFile
);

router.post(
  "/fast-hubspot-import",
  upload.single("file"),
  customerController.fastHubspotImportWithAgents
);

router.post(
  "/comprehensive-update",
  upload.single("file"),
  customerController.comprehensiveCustomerUpdate
);

router.post(
  "/update-missing-emails",
  upload.single("file"),
  customerController.updateMissingEmails
);

router.post(
  "/update-phones",
  upload.single("file"),
  customerController.updateCustomerPhones
);

router.post(
  "/update-addresses",
  upload.single("file"),
  customerController.updateCustomerAddresses
);

router.post(
  "/update-balances",
  upload.single("file"),
  customerController.updateCustomerOutstandingBalance
);
// Get all customers (with filtering and permissions)
router.get("/", auth, updateLastLogin, customerController.getCustomers);

// Get all customers (with filtering and permissions)
router.get("/sap", auth, updateLastLogin, customerController.getSAPCustomers);

// Route for bulk unassignment
router.post(
  "/bulk-unassign",
  auth,
  checkRole(["admin", "sales_manager"]),
  customerController.bulkUnassignCustomers
);
router.get(
  "/paginated",
  auth,
  updateLastLogin,
  customerController.getCustomersPaginated
);

router.post(
  "/check-add-new",
  upload.single("file"),
  customerController.checkAndAddNewCustomers
);

router.get("/preview-S-Code", customerController.previewCustomersWithSCardCode);

router.post("/remove-S-Code", customerController.removeCustomersWithSCardCode);

// Add this new route:
router.post("/bulk-assign", auth, customerController.bulkAssignCustomers);

router.get(
  "/paginated2",
  auth,
  updateLastLogin,
  customerController.getCustomersPaginated2
);

// Route to unassign a single customer
router.post(
  "/:id/unassign",
  auth,
  checkRole(["admin", "sales_manager"]),
  customerController.unassignCustomer
);

// Get customer by ID
router.get("/:id", auth, updateLastLogin, customerController.getCustomerById);

// Create customer
router.post(
  "/",
  auth,
  checkRole(["admin", "sales_manager", "sales_agent"]),
  customerController.createCustomer
);

// Update customer
router.put("/:id", auth, canManageCustomer, customerController.updateCustomer);

// Import customers from SAP or external source
router.post(
  "/import",
  auth,
  checkRole(["admin"]),
  customerController.importCustomers
);

router.get(
  "/:id/calls",
  auth,
  updateLastLogin,
  customerController.getCustomerCallData
);

// Assign/reassign customer
router.post(
  "/:id/assign",
  auth,
  checkRole(["admin", "sales_manager"]),
  customerController.assignCustomer
);

// Get customers assigned to a specific sales agent
router.get("/agent/:agentId", auth, customerController.getCustomersByAgent);

// Add notes to customer
router.post("/:id/notes", auth, canManageCustomer, customerController.addNotes);

// @route   POST /api/customers/upload
// @desc    Upload customers from file (supports txt, xlsx, xls)
// @access  Private (removed auth for testing)
router.post(
  "/upload",
  upload.single("file"),
  customerController.uploadCustomers
);

// @route   POST /api/customers/upload-csv
// @desc    Upload customers from CSV file
// @access  Private (removed auth for testing)
router.post(
  "/upload-csv",
  upload.single("file"),
  customerController.uploadCustomersCSV
);

router.post(
  "/import-hubspot",
  auth,
  upload.single("file"),
  customerController.importHubspotContacts
);

router.post("/merge-customers", customerController.mergeCustomersWithSameEmail);

router.post("/delete-merged", customerController.deleteMergedNonSapCustomers);

module.exports = router;
