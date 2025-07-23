// routes/lead.routes.js
const express = require("express");
const router = express.Router();
const { auth, checkRole } = require("../middleware/auth");
const leadController = require("../controllers/lead.controller");

// Get all leads
router.get("/", auth, leadController.getLeads);

router.get("/:id", auth, leadController.getAgentLeads);

// Get lead by ID
router.get("/agent", auth, leadController.getAgentLeads);

// Create a new lead
router.post("/", auth, leadController.createLead);

// Update a lead
router.put("/:id", auth, leadController.updateLead);

// Delete a lead
router.delete(
  "/:id",
  auth,
  checkRole(["admin", "sales_manager"]),
  leadController.deleteLead
);

// Assign a lead to an agent
router.post(
  "/:id/assign",
  auth,
  checkRole(["admin", "sales_manager"]),
  leadController.assignLead
);

// Update lead tags
router.post("/:id/tags", auth, leadController.updateTags);



module.exports = router;
