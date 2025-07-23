// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const orderController = require("../controllers/order.controller");
const { auth } = require("../middleware/auth");

const multer = require("multer");

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files are allowed"), false);
    }
  },
});

// sales order routes
router.post(
  "/:docNum/generate-payment-link",
  orderController.generatePaymentLinkForOrder
);
router.get(
  "/:docNum/payment-status",
  orderController.getUpdateOnPaymentLinkForOrder
);
router.post(
  "/bulk-import",
  upload.single("file"),
  orderController.bulkImportSalesOrders
);
// @route   POST /api/orders
// @desc    Create a new sales order in local DB
// @access  Private
router.post("/", auth, orderController.createOrder);

// @route   GET /api/orders
// @desc    Get all orders with pagination and filtering
// @access  Private
//router.get("/cardCode/:cardCode",auth, orderController.getOrdersByCustomer);
router.get("/", orderController.getAllOrders);

// @route   GET /api/orders
// @desc    Get all orders with pagination and filtering
// @access  Private

// @route   GET /api/orders/:docEntry
// @desc    Get a single order by DocEntry
// @access  Private
// Specific route for getOrdersByCustomer
router.get("/cardCode/:cardCode", auth, orderController.getOrdersByCustomer); // Matches /api/sales-orders/customer/C0003
// @route   POST /api/orders/:docEntry/push-to-sap
// @desc    Push an order to SAP B1
// @access  Private
router.post("/:docEntry/push-to-sap", orderController.pushOrderToSAP);

// @route   PATCH /api/orders/:docEntry/status
// @desc    Update order status
// @access  Private
// router.patch("/:docEntry/status", orderController.updateOrderStatus);

// // @route   PATCH /api/orders/:docEntry/cancel
// // @desc    Cancel an order
// // @access  Private
// router.patch("/:docEntry/cancel", orderController.cancelOrder);

// // @route   GET /api/orders/:docEntry/sap-status
// // @desc    Get order status from SAP B1
// // @access  Private
// router.get("/:docEntry/sap-status", orderController.getSAPOrderStatus);

// // @route   POST /api/orders/:docEntry/duplicate
// // @desc    Create a duplicate of an existing order
// // @access  Private
// router.post("/:docEntry/duplicate", orderController.duplicateOrder);

module.exports = router;
