const express = require("express");
const router = express.Router();
const {
  getCustomerProducts,
  getCustomersProductsSummary,
} = require("../controllers/CustomerProductSales.controller");

router.get("/:cardCode", getCustomerProducts);
router.get("/products-summary", getCustomersProductsSummary);

module.exports = router;
