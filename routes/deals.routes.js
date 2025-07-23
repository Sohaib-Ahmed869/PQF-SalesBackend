const express = require("express");
const router = express.Router();
const dealController = require("../controllers/deals.controller");


// Basic CRUD routes
router.get("/:id", dealController.getDealById);
router.get("/", dealController.getDeals);
router.post("/", dealController.createDeal);
router.put("/:id", dealController.updateDeal);
router.delete("/:id", dealController.deleteDeal);

module.exports = router;
