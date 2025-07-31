// controllers/customer.controller.js
const Customer = require("../models/Customer");
const User = require("../models/User");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const CallData = require("../models/CallData");
const SalesOrder = require("../models/SalesOrder");
const Invoice = require("../models/Invoice");
const Quotation = require("../models/Quotation");
const Deal = require("../models/Deal");
const Cart = require("../models/Cart");

const {
  getLastCustomerFromSAP,
  generateNextCardCode,
  formatCustomerForSAP,
  createCustomerInSAP,
  checkCustomerExistsInSAP,
} = require("../utils/sapB1CustomerIntegration");

// Helper function to push customer to SAP
async function pushCustomerToSAPInternal(customer) {
  try {
    // Format the customer for SAP B1
    const sapCustomer = await formatCustomerForSAP(customer);

    // Push to SAP B1
    const sapResponse = await createCustomerInSAP(sapCustomer);

    // Update local customer with SAP CardCode if successful
    if (sapResponse && sapResponse.CardCode) {
      customer.CardCode = sapResponse.CardCode;
      customer.customerType = "sap";
      customer.SyncedWithSAP = true;
      customer.LocalStatus = "Synced";
      customer.updatedAt = new Date();

      await customer.save();

      return {
        success: true,
        CardCode: sapResponse.CardCode,
        sapData: sapResponse,
      };
    } else {
      throw new Error("Invalid response from SAP B1");
    }
  } catch (error) {
    // Update local customer to mark sync failure
    customer.SyncErrors = error.message;
    customer.LastSyncAttempt = new Date();
    customer.LocalStatus = "SyncFailed";
    await customer.save();

    console.error("Error pushing customer to SAP:", error);
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}

// Create a new customer (save to local DB and push to SAP)
exports.createCustomer = async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.CardName) {
      return res.status(400).json({
        success: false,
        message: "Customer name (CardName) is required",
      });
    }

    if (!req.body.Email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    console.log(req.user.role, "is creating a new customer", req.user._id);

    // Get the next CardCode from SAP
    console.log("Getting next CardCode from SAP...");
    const nextCardCode = await generateNextCardCode();

    // Create the new customer
    const newCustomer = new Customer({
      ...req.body,
      CardCode: nextCardCode,
      customerType: "non-sap", // Will be updated to "sap" after successful sync
      assignedTo:
        req.user && req.user.role === "sales_agent"
          ? req.user._id
          : req.body.assignedTo || null,
      SyncedWithSAP: false,
      LocalStatus: "Created",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("Creating new customer:", {
      CardName: newCustomer.CardName,
      CardCode: newCustomer.CardCode,
      Email: newCustomer.Email,
    });

    // Save to local database
    await newCustomer.save();

    // Push to SAP automatically
    console.log("Automatically pushing new customer to SAP...");
    const sapResult = await pushCustomerToSAPInternal(newCustomer);

    // Return response with both local creation and SAP push results
    if (sapResult.success) {
      res.status(201).json({
        success: true,
        data: newCustomer,
        message: "Customer created successfully and synced with SAP",
        sapSync: {
          success: true,
          CardCode: sapResult.CardCode,
        },
      });
    } else {
      res.status(201).json({
        success: true,
        data: newCustomer,
        message:
          "Customer created successfully in local database but failed to sync with SAP",
        sapSync: {
          success: false,
          error: sapResult.error,
        },
      });
    }
  } catch (error) {
    console.error("Error creating customer:", error);
    res.status(500).json({
      success: false,
      message: "Error creating customer",
      error: error.message,
    });
  }
};

// Process customer data from text format
const processCustomerData = (text) => {
  const lines = text.split("\n");
  const customers = [];

  // Skip the header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      // Match pattern: index CardCode CardName Email
      const match = line.match(/^\d+\s+(C\d+)\s+(.*?)(?:\s+(\S+@\S+\.\S+))?$/);

      if (match) {
        const [, CardCode, CardName, Email] = match;

        customers.push({
          CardCode,
          CardName: CardName.trim(),
          Email: Email || "",
          status: "active",
        });
      }
    }
  }

  return customers;
};

// Process XLSX file
const processXLSXFile = (filePath) => {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log("Excel data extracted:", data.length, "records");

    // Map the data to our customer format
    return data
      .map((row) => {
        return {
          CardCode: row["BP Code"] || row["CardCode"] || "",
          CardName: row["BP Name"] || row["CardName"] || "",
          Email: row["E-Mail"] || row["Email"] || "",
          status: "active",
        };
      })
      .filter((customer) => customer.CardCode && customer.CardName); // Filter out invalid entries
  } catch (error) {
    console.error("Error processing XLSX file:", error);
    throw new Error(`Failed to process XLSX file: ${error.message}`);
  }
};

// Add this function to your customer.controller.js

const normalizePhoneNumber = (phone) => {
  if (!phone) return "";

  // Remove all non-digit characters
  let digitsOnly = phone.replace(/[^\d]/g, "");

  // Handle French phone numbers
  if (digitsOnly.startsWith("33") && digitsOnly.length >= 11) {
    // +33123456789 -> 123456789
    return digitsOnly.substring(2);
  } else if (digitsOnly.startsWith("0") && digitsOnly.length === 10) {
    // 0123456789 -> 123456789
    return digitsOnly.substring(1);
  } else if (digitsOnly.length === 9) {
    // 123456789 -> 123456789
    return digitsOnly;
  }

  return digitsOnly;
};

const normalizeNameForMatching = (name) => {
  if (!name) return "";
  return name.toLowerCase().trim().replace(/\s+/g, " ");
};

exports.mapHubspotEmailsAndPhones = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV file with HubSpot data",
      });
    }

    console.log("Processing HubSpot email and phone mapping:", req.file.path);
    const startTime = Date.now();

    // Process CSV file
    const data = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on("data", (row) => {
          data.push(row);
        })
        .on("end", () => {
          console.log(`Extracted ${data.length} rows from CSV file`);
          resolve();
        })
        .on("error", (error) => {
          console.error("CSV parsing error:", error);
          reject(error);
        });
    });

    // Process HubSpot data
    const hubspotContacts = data
      .map((row) => {
        const phone = normalizePhoneNumber(row["Phone Number"] || "");
        const email = (row["Email"] || "").toString().trim().toLowerCase();
        const firstName = (row["First Name"] || "").toString().trim();
        const lastName = (row["Last Name"] || "").toString().trim();

        return {
          email,
          phone,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim(),
          hubspotId: row["Record ID"] ? String(row["Record ID"]) : "",
          originalPhone: row["Phone Number"] || "",
          originalRow: row,
        };
      })
      .filter(
        (contact) =>
          contact.email &&
          (contact.phone || contact.firstName || contact.lastName)
      );

    console.log(
      `Found ${hubspotContacts.length} valid HubSpot contacts with emails`
    );

    // Get all customers without emails
    const customersWithoutEmails = await Customer.find({
      $or: [{ Email: { $exists: false } }, { Email: null }, { Email: "" }],
    }).lean();

    console.log(
      `Found ${customersWithoutEmails.length} customers without emails`
    );

    // Get all customers with emails for phone number updates
    const customersWithEmails = await Customer.find({
      Email: { $exists: true, $ne: null, $ne: "" },
    }).lean();

    console.log(`Found ${customersWithEmails.length} customers with emails`);

    const results = {
      totalHubspotContacts: hubspotContacts.length,
      emailsUpdated: 0,
      phonesAddedToExisting: 0,
      matchedByPhone: 0,
      matchedByName: 0,
      noMatches: 0,
      errors: [],
    };

    const bulkOperations = [];

    // Phase 1: Map emails to customers without emails
    for (const hubspotContact of hubspotContacts) {
      let matchedCustomer = null;
      let matchType = "";

      // Try to match by phone number first (most reliable)
      if (hubspotContact.phone && hubspotContact.phone.length >= 6) {
        for (const customer of customersWithoutEmails) {
          const customerPhones = [
            normalizePhoneNumber(customer.phoneNumber),
            ...(customer.additionalPhoneNumbers || []).map(
              normalizePhoneNumber
            ),
          ].filter(Boolean);

          if (customerPhones.includes(hubspotContact.phone)) {
            matchedCustomer = customer;
            matchType = "phone";
            results.matchedByPhone++;
            break;
          }
        }
      }

      // If no phone match, try name matching (less reliable, stricter criteria)
      if (
        !matchedCustomer &&
        hubspotContact.firstName &&
        hubspotContact.lastName
      ) {
        const hubspotFullName = normalizeNameForMatching(
          hubspotContact.fullName
        );

        for (const customer of customersWithoutEmails) {
          const customerFullName = normalizeNameForMatching(
            `${customer.firstName || ""} ${customer.lastName || ""}`
          );
          const customerCardName = normalizeNameForMatching(
            customer.CardName || ""
          );

          // Exact name match or CardName match
          if (
            hubspotFullName === customerFullName ||
            hubspotFullName === customerCardName ||
            (hubspotContact.firstName.toLowerCase() ===
              (customer.firstName || "").toLowerCase() &&
              hubspotContact.lastName.toLowerCase() ===
                (customer.lastName || "").toLowerCase())
          ) {
            matchedCustomer = customer;
            matchType = "name";
            results.matchedByName++;
            break;
          }
        }
      }

      if (matchedCustomer) {
        // Prepare update for matched customer
        const updateData = {
          Email: hubspotContact.email,
          updatedAt: new Date(),
        };

        // Add firstName/lastName if missing
        if (!matchedCustomer.firstName && hubspotContact.firstName) {
          updateData.firstName = hubspotContact.firstName;
        }
        if (!matchedCustomer.lastName && hubspotContact.lastName) {
          updateData.lastName = hubspotContact.lastName;
        }

        // Add phone number if missing
        if (!matchedCustomer.phoneNumber && hubspotContact.originalPhone) {
          updateData.phoneNumber = hubspotContact.originalPhone;
        }

        // Add HubSpot ID if missing
        if (!matchedCustomer.hubspotId && hubspotContact.hubspotId) {
          updateData.hubspotId = hubspotContact.hubspotId;
        }

        bulkOperations.push({
          updateOne: {
            filter: { _id: matchedCustomer._id },
            update: { $set: updateData },
          },
        });

        results.emailsUpdated++;

        console.log(
          `Matched by ${matchType}: ${matchedCustomer.CardCode} -> ${hubspotContact.email}`
        );

        // Remove from array to avoid duplicate matches
        const index = customersWithoutEmails.indexOf(matchedCustomer);
        if (index > -1) {
          customersWithoutEmails.splice(index, 1);
        }
      } else {
        results.noMatches++;
      }
    }

    // Phase 2: Add phone numbers to existing customers with same email
    const emailToHubspotMap = new Map();
    hubspotContacts.forEach((contact) => {
      if (contact.email && contact.originalPhone) {
        if (!emailToHubspotMap.has(contact.email)) {
          emailToHubspotMap.set(contact.email, []);
        }
        emailToHubspotMap.get(contact.email).push(contact.originalPhone);
      }
    });

    for (const customer of customersWithEmails) {
      const customerEmail = customer.Email.toLowerCase().trim();
      const hubspotPhones = emailToHubspotMap.get(customerEmail);

      if (hubspotPhones && hubspotPhones.length > 0) {
        const existingPhones = [
          customer.phoneNumber,
          ...(customer.additionalPhoneNumbers || []),
        ]
          .filter(Boolean)
          .map((phone) => phone.trim());

        const newPhones = hubspotPhones.filter(
          (phone) =>
            phone &&
            !existingPhones.some(
              (existing) =>
                normalizePhoneNumber(existing) === normalizePhoneNumber(phone)
            )
        );

        if (newPhones.length > 0) {
          bulkOperations.push({
            updateOne: {
              filter: { _id: customer._id },
              update: {
                $addToSet: {
                  additionalPhoneNumbers: { $each: newPhones },
                },
                $set: { updatedAt: new Date() },
              },
            },
          });

          results.phonesAddedToExisting++;
          console.log(
            `Added phones to ${customer.CardCode}: ${newPhones.join(", ")}`
          );
        }
      }
    }

    // Execute bulk operations
    if (bulkOperations.length > 0) {
      console.log(`Executing ${bulkOperations.length} update operations`);

      const bulkResult = await Customer.bulkWrite(bulkOperations, {
        ordered: false,
      });

      console.log(`Bulk update completed:`, {
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount,
      });
    }

    // Clean up uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file:", unlinkError);
    }

    const totalTime = Date.now() - startTime;
    console.log(`Mapping completed in ${totalTime}ms`);

    res.status(200).json({
      success: true,
      message: `HubSpot email and phone mapping completed in ${totalTime}ms`,
      results: {
        ...results,
        processingTimeMs: totalTime,
        bulkOperationsExecuted: bulkOperations.length,
      },
    });
  } catch (error) {
    console.error("HubSpot mapping error:", error);

    // Clean up file
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error mapping HubSpot emails and phones",
      error: error.message,
    });
  }
};

exports.fastHubspotImportWithAgents = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV file",
      });
    }

    console.log("Processing HubSpot import with agents:", req.file.path);
    const startTime = Date.now();

    // Process CSV file
    const fileContent = fs.readFileSync(req.file.path, "utf8");
    const csv = require("csv-parser");

    // Parse CSV data
    const data = [];
    const stream = fs
      .createReadStream(req.file.path)
      .pipe(csv())
      .on("data", (row) => {
        data.push(row);
      });

    // Wait for CSV parsing to complete
    await new Promise((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    console.log(`Extracted ${data.length} rows from CSV file`);

    // Build agent mapping from contact owner names to agent IDs
    const salesAgents = await User.find({ role: "sales_agent" }).lean();
    const agentMapping = new Map();

    salesAgents.forEach((agent) => {
      const fullName = `${agent.firstName} ${agent.lastName}`
        .toLowerCase()
        .trim();
      const firstName = agent.firstName.toLowerCase().trim();
      const lastName = agent.lastName.toLowerCase().trim();

      agentMapping.set(fullName, agent._id);
      agentMapping.set(firstName, agent._id);
      agentMapping.set(lastName, agent._id);

      // Handle variations
      agentMapping.set(`${firstName} ${lastName}`, agent._id);
      agentMapping.set(`${lastName} ${firstName}`, agent._id);
    });

    console.log(`Created agent mapping for ${salesAgents.length} agents`);

    // Process HubSpot data
    const processedContacts = [];
    const usedCodes = new Set();

    // Get existing NC codes to avoid conflicts
    const existingNCCodes = await Customer.find({ CardCode: /^NC-/ })
      .select("CardCode")
      .lean();
    existingNCCodes.forEach((customer) => usedCodes.add(customer.CardCode));

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // Helper function to safely get string value
      const getString = (value) => {
        if (value === null || value === undefined) return "";
        return String(value).trim();
      };

      // Extract data safely
      const email = getString(row["Email"]);
      const phone = getString(row["Phone Number"]).replace(/[^\d+]/g, "");

      // Skip if no email or phone
      if (!email && !phone) continue;

      // Extract names - handle RingOver contacts
      let firstName = getString(row["First Name"]);
      let lastName = getString(row["Last Name"]);

      // Clean up RingOver contact names
      if (
        firstName.includes("New RingOver Contact") ||
        firstName.includes("Ringover contact") ||
        firstName.match(/^\+?\d+/)
      ) {
        firstName = "";
      }
      if (
        lastName.includes("New RingOver Contact") ||
        lastName.includes("Ringover contact") ||
        lastName.match(/^\+?\d+/)
      ) {
        lastName = "";
      }

      // Generate CardName
      let cardName = "";
      if (firstName || lastName) {
        cardName = `${firstName} ${lastName}`.trim();
      } else if (phone) {
        cardName = `Contact ${phone}`;
      } else if (email) {
        cardName = email;
      } else {
        cardName = "Unnamed Contact";
      }

      // Clean cardName if it contains RingOver references
      if (
        cardName.includes("New RingOver Contact") ||
        cardName.includes("Ringover contact")
      ) {
        if (phone) {
          cardName = `Contact ${phone}`;
        } else if (email) {
          cardName = email;
        } else {
          cardName = "Unnamed Contact";
        }
      }

      // Generate unique CardCode
      let baseCode = "NC-";
      const hubspotId = getString(row["Record ID"]);

      if (hubspotId) {
        if (hubspotId.includes("E+")) {
          const parts = hubspotId.split("E+");
          const base = parseFloat(parts[0]);
          const exponent = parseInt(parts[1]);
          const fullNumber = Math.round(
            base * Math.pow(10, exponent)
          ).toString();
          baseCode += "HS-" + fullNumber.substring(0, 8);
        } else {
          baseCode += "HS-" + hubspotId.substring(0, 8);
        }
      } else if (email) {
        const emailPrefix = email.split("@")[0];
        baseCode += "EM-" + emailPrefix.substring(0, 8);
      } else {
        baseCode += "TMP-" + Date.now().toString().substring(8) + "-" + i;
      }

      // Ensure uniqueness
      let finalCode = baseCode;
      let counter = 1;
      while (usedCodes.has(finalCode)) {
        finalCode = `${baseCode}-${counter}`;
        counter++;
      }
      usedCodes.add(finalCode);

      // Find assigned agent
      let assignedTo = null;
      const contactOwner = getString(row["Contact owner"]).toLowerCase();
      if (contactOwner && agentMapping.has(contactOwner)) {
        assignedTo = agentMapping.get(contactOwner);
      }

      // Marketing status
      let marketingStatus = "marketing-contact";
      const marketingContactStatus = getString(
        row["Marketing contact status"]
      ).toLowerCase();
      if (marketingContactStatus.includes("non-marketing")) {
        marketingStatus = "non-marketing-contact";
      } else if (marketingContactStatus.includes("unsubscribe")) {
        marketingStatus = "unsubscribed";
      }

      // Parse create date
      let createDate = new Date();
      const createDateStr = getString(row["Create Date"]);
      if (createDateStr) {
        try {
          createDate = new Date(createDateStr);
          if (isNaN(createDate.getTime())) {
            createDate = new Date();
          }
        } catch (error) {
          createDate = new Date();
        }
      }

      processedContacts.push({
        CardCode: finalCode,
        CardName: cardName,
        firstName: firstName,
        lastName: lastName,
        Email: email,
        phoneNumber: phone,
        hubspotId: hubspotId,
        assignedTo: assignedTo,
        customerType: "non-sap",
        status: getString(row["Lead Status"]) ? "lead" : "prospect",
        marketingStatus: marketingStatus,
        company: getString(row["Associated Company"]),
        companyId: getString(row["Primary Associated Company ID"]),
        contactOwnerName: getString(row["Contact owner"]),
        createdAt: createDate,
      });
    }

    console.log(`Processed ${processedContacts.length} valid contacts`);

    // Get all existing customers by email for efficient lookup
    const allEmails = processedContacts
      .filter((c) => c.Email)
      .map((c) => c.Email.toLowerCase());
    const existingCustomersByEmail = await Customer.find({
      Email: { $in: allEmails },
    }).lean();

    const emailToCustomerMap = new Map();
    existingCustomersByEmail.forEach((customer) => {
      if (customer.Email) {
        emailToCustomerMap.set(customer.Email.toLowerCase(), customer);
      }
    });

    // Also get existing customers by HubSpot ID
    const allHubspotIds = processedContacts
      .filter((c) => c.hubspotId)
      .map((c) => c.hubspotId);
    const existingByHubspot = await Customer.find({
      hubspotId: { $in: allHubspotIds },
    }).lean();

    const hubspotToCustomerMap = new Map();
    existingByHubspot.forEach((customer) => {
      if (customer.hubspotId) {
        hubspotToCustomerMap.set(customer.hubspotId, customer);
      }
    });

    console.log(
      `Found ${existingCustomersByEmail.length} existing customers by email`
    );
    console.log(
      `Found ${existingByHubspot.length} existing customers by HubSpot ID`
    );

    // Prepare operations
    const newCustomers = [];
    const updateOperations = [];
    const results = {
      total: processedContacts.length,
      newCustomers: 0,
      updatedAgents: 0,
      mergedWithSAP: 0,
      duplicatesSkipped: 0,
      errors: [],
    };

    for (const contact of processedContacts) {
      try {
        // Check if customer exists by HubSpot ID first
        let existingCustomer = null;
        if (contact.hubspotId) {
          existingCustomer = hubspotToCustomerMap.get(contact.hubspotId);
        }

        // If not found by HubSpot ID, check by email
        if (!existingCustomer && contact.Email) {
          existingCustomer = emailToCustomerMap.get(
            contact.Email.toLowerCase()
          );
        }

        if (existingCustomer) {
          // Customer exists - only update contact owner if needed
          if (
            contact.assignedTo &&
            existingCustomer.assignedTo?.toString() !==
              contact.assignedTo.toString()
          ) {
            updateOperations.push({
              updateOne: {
                filter: { _id: existingCustomer._id },
                update: {
                  $set: {
                    assignedTo: contact.assignedTo,
                    contactOwnerName: contact.contactOwnerName,
                  },
                },
              },
            });
            results.updatedAgents++;
          }

          // If existing customer is SAP and new contact has different data, count as merged
          if (existingCustomer.CardCode.startsWith("C")) {
            results.mergedWithSAP++;
          } else {
            results.duplicatesSkipped++;
          }
        } else {
          // New customer
          newCustomers.push(contact);
          results.newCustomers++;
        }
      } catch (error) {
        results.errors.push({
          contact: contact.Email || contact.CardCode,
          error: error.message,
        });
      }
    }

    console.log(
      `Prepared ${newCustomers.length} new customers and ${updateOperations.length} updates`
    );

    // Execute operations in parallel
    const operationPromises = [];

    // Insert new customers
    if (newCustomers.length > 0) {
      operationPromises.push(
        Customer.insertMany(newCustomers, { ordered: false })
          .then((result) => ({ insertedCount: result.length }))
          .catch((error) => {
            console.error("Insert error:", error);
            return { insertedCount: 0 };
          })
      );
    }

    // Update existing customers
    if (updateOperations.length > 0) {
      operationPromises.push(
        Customer.bulkWrite(updateOperations, { ordered: false })
          .then((result) => ({ modifiedCount: result.modifiedCount }))
          .catch((error) => {
            console.error("Update error:", error);
            return { modifiedCount: 0 };
          })
      );
    }

    const operationResults = await Promise.all(operationPromises);

    // Clean up file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file:", unlinkError);
    }

    const totalTime = Date.now() - startTime;
    console.log(`Total processing time: ${totalTime}ms`);

    res.status(200).json({
      success: true,
      message: `HubSpot import completed in ${totalTime}ms`,
      results: {
        ...results,
        processingTimeMs: totalTime,
        recordsPerSecond: Math.round(
          (processedContacts.length / totalTime) * 1000
        ),
      },
    });
  } catch (error) {
    console.error("Fast HubSpot import error:", error);

    // Clean up file
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error importing HubSpot contacts",
      error: error.message,
    });
  }
};
// Replace the previous function with this ultra-fast version

exports.comprehensiveCustomerUpdate = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload an Excel file",
      });
    }

    console.log("Processing file:", req.file.path);
    const startTime = Date.now();

    let customersData = [];
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // Process Excel file
    if (fileExt === ".xlsx" || fileExt === ".xls") {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      console.log(`Extracted ${data.length} rows from Excel file`);

      // Fast data processing - no validation loops
      customersData = data
        .map((row) => {
          const cardCode = (row["BP Code"] || "").toString().trim();
          if (!cardCode) return null;

          const phone1 = (row["Telephone 1"] || "").toString().trim();
          const phone2 = (row["Telephone 2"] || "").toString().trim();
          const balanceStr = (row["Account Balance"] || "0")
            .toString()
            .replace(/[^\d.-]/g, "");

          return {
            CardCode: cardCode,
            CardName: (row["BP Name"] || "").toString().trim(),
            Email: (row["E-Mail"] || "").toString().trim(),
            phoneNumber: phone1,
            phone2: phone2,
            outstandingBalance: parseFloat(balanceStr) || 0,
            prestashopAcc: (row["PRESTASHOP ACC"] || "").toString().trim(),
            street: (row["Bill-to Street"] || "").toString().trim(),
            zipCode: (row["Bill-to Postcode"] || "").toString().trim(),
            city: (row["Bill-to City"] || "").toString().trim(),
            county: (row["Bill-to County"] || "").toString().trim(),
            customerType: cardCode.startsWith("C") ? "sap" : "non-sap",
          };
        })
        .filter((customer) => customer !== null);

      console.log(
        `Processed ${customersData.length} records in ${
          Date.now() - startTime
        }ms`
      );
    } else {
      throw new Error("Only Excel files (.xlsx, .xls) are supported");
    }

    if (customersData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid customer data found",
      });
    }

    // Get ALL existing customers in ONE query using projection for speed
    const existingCustomers = await Customer.find(
      {
        CardCode: { $in: customersData.map((c) => c.CardCode) },
      },
      {
        CardCode: 1,
        Email: 1,
        phoneNumber: 1,
        additionalPhoneNumbers: 1,
        address: 1,
        outstandingBalance: 1,
        prestashopAcc: 1,
        CardName: 1,
        customerType: 1,
      }
    ).lean();

    console.log(
      `Found ${existingCustomers.length} existing customers in ${
        Date.now() - startTime
      }ms`
    );

    // Create fast lookup map
    const existingMap = new Map(existingCustomers.map((c) => [c.CardCode, c]));

    // Separate new customers and updates
    const newCustomers = [];
    const bulkUpdateOps = [];

    // Fast processing - no complex logic
    for (const customerData of customersData) {
      const existing = existingMap.get(customerData.CardCode);

      if (!existing) {
        // NEW CUSTOMER - simple object creation
        newCustomers.push({
          CardCode: customerData.CardCode,
          CardName: customerData.CardName,
          Email: customerData.Email,
          phoneNumber: customerData.phoneNumber,
          additionalPhoneNumbers: customerData.phone2
            ? [customerData.phone2]
            : [],
          outstandingBalance: customerData.outstandingBalance,
          prestashopAcc: customerData.prestashopAcc,
          address: {
            street: customerData.street,
            zipCode: customerData.zipCode,
            city: customerData.city,
            county: customerData.county,
            country: "France",
          },
          status: "active",
          customerType: customerData.customerType,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        // EXISTING CUSTOMER - build update object quickly
        const updateDoc = {
          CardName: customerData.CardName,
          outstandingBalance: customerData.outstandingBalance,
          prestashopAcc: customerData.prestashopAcc,
          customerType: customerData.customerType,
          updatedAt: new Date(),
        };

        // Only update email if customer doesn't have one
        if (
          customerData.Email &&
          (!existing.Email || existing.Email.trim() === "")
        ) {
          updateDoc.Email = customerData.Email;
        }

        // Update phone if different or missing
        if (
          customerData.phoneNumber &&
          customerData.phoneNumber !== existing.phoneNumber
        ) {
          updateDoc.phoneNumber = customerData.phoneNumber;
        }

        // Handle additional phones - simplified logic
        if (customerData.phone2) {
          const existingPhones = existing.additionalPhoneNumbers || [];
          if (
            !existingPhones.includes(customerData.phone2) &&
            customerData.phone2 !== existing.phoneNumber
          ) {
            updateDoc.additionalPhoneNumbers = [
              ...existingPhones,
              customerData.phone2,
            ];
          }
        }

        // Update address - always update all fields
        updateDoc.address = {
          street: customerData.street,
          zipCode: customerData.zipCode,
          city: customerData.city,
          county: customerData.county,
          country: "France",
        };

        bulkUpdateOps.push({
          updateOne: {
            filter: { CardCode: customerData.CardCode },
            update: { $set: updateDoc },
          },
        });
      }
    }

    console.log(`Prepared operations in ${Date.now() - startTime}ms`);

    // Execute bulk operations in parallel
    const results = {
      total: customersData.length,
      created: 0,
      updated: 0,
      errors: 0,
    };

    try {
      // Execute both operations in parallel
      const [insertResult, updateResult] = await Promise.all([
        // Bulk insert new customers
        newCustomers.length > 0
          ? Customer.insertMany(newCustomers, { ordered: false })
          : Promise.resolve([]),
        // Bulk update existing customers
        bulkUpdateOps.length > 0
          ? Customer.bulkWrite(bulkUpdateOps, { ordered: false })
          : Promise.resolve({ modifiedCount: 0 }),
      ]);

      results.created = Array.isArray(insertResult) ? insertResult.length : 0;
      results.updated = updateResult.modifiedCount || 0;

      console.log(`Bulk operations completed in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error("Bulk operation error:", error);
      // Handle partial success
      if (error.writeErrors) {
        results.errors = error.writeErrors.length;
        results.created = newCustomers.length - results.errors;
      }
    }

    // Clean up file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file:", unlinkError);
    }

    const totalTime = Date.now() - startTime;
    console.log(`Total processing time: ${totalTime}ms`);

    res.status(200).json({
      success: true,
      message: `Fast update completed in ${totalTime}ms: ${results.created} created, ${results.updated} updated`,
      results: {
        ...results,
        processingTimeMs: totalTime,
        recordsPerSecond: Math.round((customersData.length / totalTime) * 1000),
      },
    });
  } catch (error) {
    console.error("Fast customer update error:", error);

    // Clean up file
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error updating customers",
      error: error.message,
    });
  }
};

// Controller function for checking and adding new customers
exports.checkAndAddNewCustomers = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log("File upload path:", req.file.path);
    console.log("File exists check:", fs.existsSync(req.file.path));

    // Process Excel file
    let customersData = [];
    try {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      console.log(`Extracted ${data.length} rows from Excel file`);

      // Map data to our customer format
      customersData = data
        .map((row) => {
          return {
            CardCode: row["BP Code"] || "",
            CardName: row["BP Name"] || row["BP Code"],
            Email: row["E-Mail 1"] || "",
            phoneNumber: row["Telephone 1"] || "",
            outstandingBalance: parseFloat(row["Account Balance"] || 0),
            address: {
              street: row["Bill-to Street"] || "",
              zipCode: row["Bill-to Postcode"] || "",
              city: row["Bill-to City"] || "",
              country: "France",
            },
            status: "active",
          };
        })
        .filter((customer) => customer.CardCode); // Filter out entries without CardCode
    } catch (error) {
      console.error("Error processing Excel file:", error);
      throw new Error(`Failed to process Excel file: ${error.message}`);
    }

    // Get all existing CardCodes in one query for efficient comparison
    const existingCardCodes = await Customer.distinct("CardCode");
    const existingCardCodesSet = new Set(existingCardCodes);

    // Filter out only new customers
    const newCustomers = customersData.filter(
      (customer) => !existingCardCodesSet.has(customer.CardCode)
    );

    console.log(
      `Found ${newCustomers.length} new customers out of ${customersData.length} total`
    );

    // If no new customers, return early
    if (newCustomers.length === 0) {
      // Clean up the uploaded file
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (unlinkError) {
        console.error("Error deleting file after processing:", unlinkError);
      }

      return res.status(200).json({
        success: true,
        message: "No new customers found to add",
        totalProcessed: customersData.length,
        newCustomers: 0,
      });
    }

    // Insert all new customers in one operation
    const result = await Customer.insertMany(newCustomers);

    // Clean up the uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file after processing:", unlinkError);
    }

    res.status(200).json({
      success: true,
      message: `Added ${newCustomers.length} new customers`,
      totalProcessed: customersData.length,
      newCustomers: newCustomers.length,
      newCustomerDetails: newCustomers.map((c) => ({
        CardCode: c.CardCode,
        CardName: c.CardName,
      })),
    });
  } catch (error) {
    console.error("Error in check and add new customers:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error processing customers",
      error: error.message,
    });
  }
};

// Get all customers
exports.getCustomers = async (req, res) => {
  try {
    const { status, search, assignedTo } = req.query;
    const query = {};

    // Apply filters if provided
    if (status) query.status = status;

    // Search by name, code or email
    if (search) {
      query.$or = [
        { CardName: { $regex: search, $options: "i" } },
        { CardCode: { $regex: search, $options: "i" } },
        { Email: { $regex: search, $options: "i" } },
      ];
    }

    // // Filter by assigned agent
    // if (assignedTo) {
    //   query.assignedTo = assignedTo;
    // }

    // // Role-based queries
    // if (req.user && req.user.role === "sales_agent") {
    //   // Sales agents can only see customers assigned to them
    //   query.assignedTo = req.user._id;
    // }
    // // Admins can see all customers

    const customers = await Customer.find(query).populate(
      "assignedTo",
      "firstName lastName email hubspotId"
    );

    res.json(customers);
  } catch (error) {
    console.error("Customer fetch error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all customers
exports.getSAPCustomers = async (req, res) => {
  try {
    const { status, search, assignedTo } = req.query;
    const query = {};

    // Apply filters if provided
    if (status) query.status = status;

    // Search by name, code or email
    if (search) {
      query.$or = [
        { CardName: { $regex: search, $options: "i" } },
        { CardCode: { $regex: search, $options: "i" } },
        { Email: { $regex: search, $options: "i" } },
      ];
    }

    // // Filter by assigned agent
    // if (assignedTo) {
    //   query.assignedTo = assignedTo;
    // }

    // // Role-based queries
    // if (req.user && req.user.role === "sales_agent") {
    //   // Sales agents can only see customers assigned to them
    //   query.assignedTo = req.user._id;
    // }
    // // Admins can see all customers

    const customers = await Customer.find({
      ...query,
      status: "active",
    }).populate("assignedTo", "firstName lastName email hubspotId");

    //only get the customers with CardCode starting with C
    const sapCustomers = customers.filter((customer) =>
      customer.CardCode.startsWith("C")
    );
    res.json(sapCustomers);
  } catch (error) {
    console.error("Customer fetch error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Function to unassign a sales agent from a customer
exports.unassignCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Verify user has permission (admins and sales managers)
    if (
      req.user &&
      req.user.role !== "admin" &&
      req.user.role !== "sales_manager"
    ) {
      return res.status(403).json({
        message:
          "Unauthorized: Only admins and sales managers can unassign customers",
      });
    }

    // Remove assignedTo field
    customer.assignedTo = undefined;
    await customer.save();

    const updatedCustomer = await Customer.findById(id).populate(
      "assignedTo",
      "firstName lastName email hubspotId"
    );

    res.json({
      message: "Customer unassigned successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Customer unassignment error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Function to bulk unassign customers
exports.bulkUnassignCustomers = async (req, res) => {
  try {
    const { customerIds } = req.body;

    // Validate input
    if (
      !customerIds ||
      !Array.isArray(customerIds) ||
      customerIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid array of customer IDs",
      });
    }

    // Verify user has permission (admins and sales managers)
    if (
      req.user &&
      req.user.role !== "admin" &&
      req.user.role !== "sales_manager"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Unauthorized: Only admins and sales managers can unassign customers",
      });
    }

    // Perform bulk update
    const result = await Customer.updateMany(
      { _id: { $in: customerIds } },
      { $unset: { assignedTo: "" } }
    );

    res.json({
      success: true,
      message: "Customers unassigned successfully",
      count: result.modifiedCount,
      totalRequested: customerIds.length,
    });
  } catch (error) {
    console.error("Bulk customer unassignment error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Get customer by ID
exports.getCustomerById = async (req, res) => {
  try {
    const customerId = req.params.id;
    let customer;

    // Role-based permissions
    if (req.user && req.user.role === "admin") {
      // Admin can see any customer
      customer = await Customer.findById(customerId).populate(
        "assignedTo",
        "firstName lastName email hubspotId"
      );
    } else if (req.user && req.user.role === "sales_manager") {
      // Get all agents managed by this manager
      const salesAgents = await User.find({
        role: "sales_agent",
        manager: req.user._id,
      }).select("_id");

      const agentIds = salesAgents.map((agent) => agent._id);

      // Find customer assigned to one of those agents
      customer = await Customer.findOne({
        _id: customerId,
        assignedTo: { $in: agentIds },
      }).populate("assignedTo", "firstName lastName email hubspotId");
    } else {
      // Sales agent can only see assigned customers
      customer = await Customer.findOne({
        _id: customerId,
      }).populate("assignedTo", "firstName lastName email hubspotId");
    }

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json(customer);
  } catch (error) {
    console.error("Customer fetch error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update customer
exports.updateCustomer = async (req, res) => {
  try {
    const customerId = req.params.id;
    const {
      CardName,
      CardCode,
      Email,
      phoneNumber,
      hubspotId,
      assignedTo,
      status,
      notes,
    } = req.body;

    // Find customer
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Build update object
    const updateData = {};
    if (CardName) updateData.CardName = CardName;
    if (CardCode) updateData.CardCode = CardCode;
    if (Email) updateData.Email = Email;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (hubspotId !== undefined) updateData.hubspotId = hubspotId;
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    // Handle assignedTo separately with permission checks
    if (assignedTo !== undefined) {
      // Only admin and sales manager can reassign
      if (req.user && req.user.role === "sales_agent") {
        return res
          .status(403)
          .json({ message: "Sales agents cannot reassign customers" });
      }

      if (assignedTo) {
        // Verify assigned agent exists and is a sales agent
        const agent = await User.findById(assignedTo);
        if (!agent || agent.role !== "sales_agent") {
          return res.status(400).json({ message: "Invalid sales agent ID" });
        }
      }

      updateData.assignedTo = assignedTo;
    }

    // Update customer
    const updatedCustomer = await Customer.findByIdAndUpdate(
      customerId,
      updateData,
      { new: true, runValidators: true }
    ).populate("assignedTo", "firstName lastName email hubspotId");

    res.json({
      message: "Customer updated successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Customer update error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getCustomerEmailByCode = async (req, res) => {
  try {
    const { cardCode } = req.params;
    if (!cardCode) {
      return res.status(400).json({ message: "CardCode is required" });
    }
    // Find customer by CardCode
    const customer = await Customer.find({ CardCode: cardCode })
      .select("Email")
      .lean();

    console.log("Customer found:", customer);

    if (!customer || customer.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }
    // Return the email of the customer
    res.json({ email: customer[0].Email });
  } catch (error) {
    console.error("Error fetching customer email:", error);
  }
};

// Import customers from SAP or external source
exports.importCustomers = async (req, res) => {
  try {
    const { customers } = req.body;

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return res
        .status(400)
        .json({ message: "Valid customers array is required" });
    }

    const results = {
      total: customers.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };

    // Process each customer
    for (const customerData of customers) {
      try {
        // Check required fields
        if (
          !customerData.CardName ||
          !customerData.CardCode ||
          !customerData.Email
        ) {
          results.failed++;
          results.errors.push({
            CardCode: customerData.CardCode || "unknown",
            error: "Missing required fields (CardName, CardCode, or Email)",
          });
          continue;
        }

        // Check if customer exists
        const existingCustomer = await Customer.findOne({
          CardCode: customerData.CardCode,
        });

        if (existingCustomer) {
          // Update existing customer
          await Customer.updateOne(
            { CardCode: customerData.CardCode },
            {
              $set: {
                CardName: customerData.CardName,
                Email: customerData.Email,
                phoneNumber: customerData.phoneNumber,
                updatedAt: Date.now(),
              },
            }
          );
          results.updated++;
        } else {
          // Create new customer
          const newCustomer = new Customer({
            CardName: customerData.CardName,
            CardCode: customerData.CardCode,
            Email: customerData.Email,
            phoneNumber: customerData.phoneNumber,
          });

          await newCustomer.save();
          results.created++;
        }
      } catch (err) {
        results.failed++;
        results.errors.push({
          CardCode: customerData.CardCode || "unknown",
          error: err.message,
        });
      }
    }

    res.json({
      message: "Import completed",
      results,
    });
  } catch (error) {
    console.error("Customer import error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Assign/reassign customer
exports.assignCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    if (!assignedTo) {
      return res
        .status(400)
        .json({ message: "Sales agent ID (assignedTo) is required" });
    }

    // Check if customer exists
    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Verify assigned agent exists and is a sales agent
    const agent = await User.findById(assignedTo);
    if (!agent || agent.role !== "sales_agent") {
      return res.status(400).json({ message: "Invalid sales agent ID" });
    }

    // Update customer
    customer.assignedTo = assignedTo;
    await customer.save();

    const updatedCustomer = await Customer.findById(id).populate(
      "assignedTo",
      "firstName lastName email hubspotId"
    );

    res.json({
      message: "Customer assigned successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Customer assignment error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get customers assigned to a specific sales agent
exports.getCustomersByAgent = async (req, res) => {
  try {
    const { agentId } = req.params;

    // Permission checks
    if (
      req.user &&
      req.user.role === "sales_agent" &&
      req.user._id.toString() !== agentId
    ) {
      return res
        .status(403)
        .json({ message: "You can only view your own customers" });
    }

    if (req.user && req.user.role === "sales_manager") {
      // Check if the agent belongs to this manager
      const agent = await User.findById(agentId);
      if (
        !agent ||
        agent.role !== "sales_agent" ||
        agent.manager.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          message: "You can only view customers of your sales agents",
        });
      }
    }

    // Get customers
    const customers = await Customer.find({ assignedTo: agentId }).populate(
      "assignedTo",
      "firstName lastName email hubspotId"
    );

    res.json(customers);
  } catch (error) {
    console.error("Customer fetch error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Add notes to customer
exports.addNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (!notes) {
      return res.status(400).json({ message: "Notes are required" });
    }

    // Update customer notes
    const updatedCustomer = await Customer.findByIdAndUpdate(
      id,
      { notes },
      { new: true, runValidators: true }
    ).populate("assignedTo", "firstName lastName email hubspotId");

    if (!updatedCustomer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      message: "Customer notes updated",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Notes update error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Upload customers from file (supports text and Excel)
exports.uploadCustomers = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log("Created uploads directory at", uploadsDir);
    }

    console.log("File upload path:", req.file.path);
    console.log("File exists check:", fs.existsSync(req.file.path));

    let customers = [];
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // Process file based on extension
    if (fileExt === ".xlsx" || fileExt === ".xls") {
      // Process Excel file
      customers = processXLSXFile(req.file.path);
      console.log(`Processed ${customers.length} customers from Excel file`);
    } else {
      // Process text file
      try {
        const fileContent = fs.readFileSync(req.file.path, "utf8");
        customers = processCustomerData(fileContent);
        console.log(`Processed ${customers.length} customers from text file`);
      } catch (readError) {
        console.error("Error reading file:", readError);
        throw new Error(`Could not read file: ${readError.message}`);
      }
    }

    if (customers.length === 0) {
      // Clean up file
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (unlinkError) {
        console.error("Error deleting file:", unlinkError);
      }

      return res.status(400).json({
        success: false,
        message: "No valid customer data found in the file",
      });
    }

    // Use bulk operation for efficiency
    const operations = customers.map((customer) => ({
      updateOne: {
        filter: { CardCode: customer.CardCode },
        update: { $set: customer },
        upsert: true,
      },
    }));

    const result = await Customer.bulkWrite(operations);

    // Clean up the uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file after processing:", unlinkError);
    }

    res.status(200).json({
      success: true,
      message: `Processed ${customers.length} customers`,
      result: {
        matched: result.matchedCount,
        modified: result.modifiedCount,
        upserted: result.upsertedCount,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error uploading customers",
      error: error.message,
    });
  }
};

// Alternative CSV upload method
exports.uploadCustomersCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV file",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const customers = [];

    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on("data", (row) => {
        customers.push({
          CardCode: row.CardCode || row["BP Code"],
          CardName: row.CardName || row["BP Name"],
          Email: row.Email || row["E-Mail"] || "",
          status: "active",
        });
      })
      .on("end", async () => {
        // Process customers
        const operations = customers.map((customer) => ({
          updateOne: {
            filter: { CardCode: customer.CardCode },
            update: { $set: customer },
            upsert: true,
          },
        }));

        const result = await Customer.bulkWrite(operations);

        // Clean up the uploaded file
        try {
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
        } catch (unlinkError) {
          console.error("Error cleaning up CSV file:", unlinkError);
        }

        res.status(200).json({
          success: true,
          message: `Processed ${customers.length} customers from CSV`,
          result: {
            matched: result.matchedCount,
            modified: result.modifiedCount,
            upserted: result.upsertedCount,
          },
        });
      })
      .on("error", (error) => {
        throw error;
      });
  } catch (error) {
    console.error("CSV upload error:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up CSV file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error uploading customers from CSV",
      error: error.message,
    });
  }
};

// exports.getCustomersPaginated = async (req, res) => {
//   try {
//     // Extract pagination parameters
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 50;
//     const skip = (page - 1) * limit;

//     //check user role
//     if (req.user && req.user.role === "sales_agent") {
//       // Sales agents can only see customers assigned to them
//       req.query.assignedTo = req.user._id;
//     }

//     // Extract filtering parameters
//     const { status, search, assignedTo, type, sortBy, sortOrder } = req.query;
//     const query = {};

//     // Apply filters if provided
//     if (status) query.status = status;

//     if (assignedTo === "unassigned") {
//       query.assignedTo = { $exists: false }; // This properly targets documents where assignedTo field doesn't exist
//     } else if (assignedTo !== "all" && assignedTo) {
//       query.assignedTo = assignedTo; // Keep the existing filter for specific agents
//     }

//     // Search by name, code or email
//     if (search) {
//       query.$or = [
//         { CardName: { $regex: search, $options: "i" } },
//         { CardCode: { $regex: search, $options: "i" } },
//         { Email: { $regex: search, $options: "i" } },
//       ];
//     }

//     // Get all matching customers without pagination for sorting by metrics
//     let customers = await Customer.find({ ...query })
//       .select(
//         "CardCode CardName Email phoneNumber status assignedTo TotalSales LastPurchaseDate notes"
//       )
//       .populate("assignedTo", "firstName lastName email")
//       .lean();

//     // Extract customer codes and emails for efficient batch processing
//     const customerCodes = customers.map((c) => c.CardCode);
//     const customerEmails = customers.filter((c) => c.Email).map((c) => c.Email);

//     // Batch query for all metrics in parallel for better performance
//     const [
//       invoiceCounts,
//       orderCounts,
//       abandonedCarts,
//       totalTurnover,
//       salesOrderTotal,
//       latestInvoiceDates,
//       quotationCounts,
//     ] = await Promise.all([
//       // Get invoice counts for all customers at once
//       Invoice.aggregate([
//         { $match: { CardCode: { $in: customerCodes } } },
//         { $group: { _id: "$CardCode", count: { $sum: 1 } } },
//       ]),

//       // Get order counts for all customers at once
//       SalesOrder.aggregate([
//         { $match: { CardCode: { $in: customerCodes } } },
//         { $group: { _id: "$CardCode", count: { $sum: 1 } } },
//       ]),

//       // Get abandoned cart counts for all customers at once
//       Cart.aggregate([
//         {
//           $match: {
//             $or: [
//               { customerEmail: { $in: customerEmails } },
//               { "contactInfo.email": { $in: customerEmails } },
//             ],
//             status: "abandoned",
//             isAbandoned: true,
//           },
//         },
//         {
//           $group: {
//             _id: {
//               $cond: [
//                 { $ifNull: ["$customerEmail", false] },
//                 "$customerEmail",
//                 "$contactInfo.email",
//               ],
//             },
//             count: { $sum: 1 },
//           },
//         },
//       ]),

//       // Get total turnover (sum of invoice amounts) for all customers
//       Invoice.aggregate([
//         { $match: { CardCode: { $in: customerCodes } } },
//         { $group: { _id: "$CardCode", totalAmount: { $sum: "$DocTotal" } } },
//       ]),

//       // Get total sales order amount for all customers
//       SalesOrder.aggregate([
//         { $match: { CardCode: { $in: customerCodes } } },
//         { $group: { _id: "$CardCode", totalAmount: { $sum: "$DocTotal" } } },
//       ]),

//       // Get latest invoice date for each customer
//       Invoice.aggregate([
//         { $match: { CardCode: { $in: customerCodes } } },
//         { $sort: { DocDate: -1 } },
//         {
//           $group: {
//             _id: "$CardCode",
//             latestInvoiceDate: { $first: "$DocDate" },
//           },
//         },
//       ]),

//       Quotation.aggregate([
//         { $match: { CardCode: { $in: customerCodes } } },
//         { $group: { _id: "$CardCode", count: { $sum: 1 } } },
//       ]),
//     ]);

//     // Create lookup maps for O(1) access
//     const invoiceMap = {};
//     invoiceCounts.forEach((item) => {
//       invoiceMap[item._id] = item.count;
//     });

//     const orderMap = {};
//     orderCounts.forEach((item) => {
//       orderMap[item._id] = item.count;
//     });

//     const cartMap = {};
//     abandonedCarts.forEach((item) => {
//       cartMap[item._id] = item.count;
//     });

//     // Create turnover map
//     const turnoverMap = {};
//     totalTurnover.forEach((item) => {
//       turnoverMap[item._id] = item.totalAmount;
//     });

//     // Create sales order total map
//     const salesOrderMap = {};
//     salesOrderTotal.forEach((item) => {
//       salesOrderMap[item._id] = item.totalAmount;
//     });

//     // Create latest invoice date map
//     const latestInvoiceDateMap = {};
//     latestInvoiceDates.forEach((item) => {
//       latestInvoiceDateMap[item._id] = item.latestInvoiceDate;
//     });

//     const quotationMap = {};
//     quotationCounts.forEach((item) => {
//       quotationMap[item._id] = item.count;
//     });

//     // Helper function to check if CardCode is SAP format (starts with letter followed by numbers)
//     const isSAPCardCode = (cardCode) => {
//       return /^[A-Za-z]\d+$/.test(cardCode);
//     };

//     // Enhance customers with metrics
//     const enhancedCustomers = customers.map((customer) => {
//       return {
//         ...customer,
//         metrics: {
//           invoiceCount: invoiceMap[customer.CardCode] || 0,
//           orderCount: orderMap[customer.CardCode] || 0,
//           abandonedCartCount: customer.Email ? cartMap[customer.Email] || 0 : 0,
//           sapTurnover: turnoverMap[customer.CardCode] || 0,
//           salesOrderTotal: salesOrderMap[customer.CardCode] || 0,
//           latestInvoiceDate: latestInvoiceDateMap[customer.CardCode] || null,
//           quotationCount: quotationMap[customer.CardCode] || 0,
//         },
//         isSAPCustomer: isSAPCardCode(customer.CardCode), // Add this flag for easier identification
//       };
//     });

//     // Apply sorting based on metrics
//     if (sortBy) {
//       const sortDirection = sortOrder === "desc" ? -1 : 1;

//       enhancedCustomers.sort((a, b) => {
//         let aValue, bValue;

//         switch (sortBy) {
//           case "invoiceCount":
//             aValue = a.metrics.invoiceCount;
//             bValue = b.metrics.invoiceCount;
//             break;
//           case "orderCount":
//             aValue = a.metrics.orderCount;
//             bValue = b.metrics.orderCount;
//             break;
//           case "abandonedCartCount":
//             aValue = a.metrics.abandonedCartCount;
//             bValue = b.metrics.abandonedCartCount;
//             break;
//           case "sapTurnover":
//             // For regular sapTurnover sorting (when company is not pqf or general sorting)
//             aValue = a.metrics.sapTurnover;
//             bValue = b.metrics.sapTurnover;
//             break;
//           case "historicalTurnover":
//             // Sort only non-SAP customers by turnover, SAP customers go to bottom
//             if (!a.isSAPCustomer && !b.isSAPCustomer) {
//               aValue = a.metrics.sapTurnover;
//               bValue = b.metrics.sapTurnover;
//             } else if (!a.isSAPCustomer && b.isSAPCustomer) {
//               return -1; // Non-SAP customer comes first
//             } else if (a.isSAPCustomer && !b.isSAPCustomer) {
//               return 1; // SAP customer goes after non-SAP
//             } else {
//               // Both are SAP customers, maintain their relative order
//               return 0;
//             }
//             break;
//           case "sapTurnoverOnly":
//             // Sort only SAP customers by turnover, non-SAP customers go to bottom
//             if (a.isSAPCustomer && b.isSAPCustomer) {
//               aValue = a.metrics.sapTurnover;
//               bValue = b.metrics.sapTurnover;
//             } else if (a.isSAPCustomer && !b.isSAPCustomer) {
//               return -1; // SAP customer comes first
//             } else if (!a.isSAPCustomer && b.isSAPCustomer) {
//               return 1; // Non-SAP customer goes after SAP
//             } else {
//               // Both are non-SAP customers, maintain their relative order
//               return 0;
//             }
//             break;
//           case "salesOrderTotal":
//             aValue = a.metrics.salesOrderTotal;
//             bValue = b.metrics.salesOrderTotal;
//             break;
//           case "latestInvoiceDate":
//             aValue = a.metrics.latestInvoiceDate
//               ? new Date(a.metrics.latestInvoiceDate).getTime()
//               : 0;
//             bValue = b.metrics.latestInvoiceDate
//               ? new Date(b.metrics.latestInvoiceDate).getTime()
//               : 0;
//             break;
//           case "quotationCount":
//             aValue = a.metrics.quotationCount;
//             bValue = b.metrics.quotationCount;
//             break;
//           case "CardName":
//             return sortDirection * a.CardName.localeCompare(b.CardName);
//           default:
//             return 0;
//         }

//         // For cases where we have aValue and bValue
//         if (sortBy === "historicalTurnover" || sortBy === "sapTurnoverOnly") {
//           return sortDirection * (aValue - bValue);
//         } else if (aValue !== undefined && bValue !== undefined) {
//           return sortDirection * (aValue - bValue);
//         }

//         return 0;
//       });
//     } else {
//       // Default sorting by CardName
//       enhancedCustomers.sort((a, b) => a.CardName.localeCompare(b.CardName));
//     }

//     // Get the total count AFTER all filters and sorting have been applied
//     const totalCount = enhancedCustomers.length;

//     // Apply pagination after sorting
//     const paginatedCustomers = enhancedCustomers.slice(skip, skip + limit);

//     return res.status(200).json({
//       success: true,
//       customers: paginatedCustomers,
//       pagination: {
//         total: totalCount,
//         page,
//         pages: Math.ceil(totalCount / limit),
//         limit,
//       },
//     });
//   } catch (error) {
//     console.error("Customer fetch error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };

exports.getCustomersPaginated = async (req, res) => {
  try {
    // Extract pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Check user role
    if (req.user && req.user.role === "sales_agent") {
      // Sales agents can only see customers assigned to them
      req.query.assignedTo = req.user._id;
    }

    // Extract filtering parameters
    const { status, search, assignedTo, type, sortBy, sortOrder } = req.query;
    const query = {};

    // Apply filters if provided
    if (status) query.status = status;

    if (assignedTo === "unassigned") {
      query.assignedTo = { $exists: false };
    } else if (assignedTo !== "all" && assignedTo) {
      query.assignedTo = assignedTo;
    }

    // Search by name, code or email
    if (search) {
      query.$or = [
        { CardName: { $regex: search, $options: "i" } },
        { CardCode: { $regex: search, $options: "i" } },
        { Email: { $regex: search, $options: "i" } },
      ];
    }

    // Get all matching customers without pagination for sorting by metrics
    let customers = await Customer.find({ ...query })
      .select(
        "CardCode CardName Email phoneNumber status assignedTo TotalSales LastPurchaseDate notes"
      )
      .populate("assignedTo", "firstName lastName email")
      .lean();

    // Extract customer codes and emails for efficient batch processing
    const customerCodes = customers.map((c) => c.CardCode);
    const customerEmails = customers.filter((c) => c.Email).map((c) => c.Email);

    // Helper function to check if CardCode is SAP format (starts with letter followed by numbers)
    const isSAPCardCode = (cardCode) => {
      return /^[A-Za-z]\d+$/.test(cardCode);
    };

    // Batch query for all metrics in parallel for better performance
    const [
      invoiceCounts,
      orderCounts,
      abandonedCarts,
      historicalTurnover,
      sapTurnover,
      salesOrderTotal,
      latestInvoiceDates,
      quotationCounts,
    ] = await Promise.all([
      // Get invoice counts for all customers at once
      Invoice.aggregate([
        { $match: { CardCode: { $in: customerCodes } } },
        { $group: { _id: "$CardCode", count: { $sum: 1 } } },
      ]),

      // Get order counts for all customers at once
      SalesOrder.aggregate([
        { $match: { CardCode: { $in: customerCodes } } },
        { $group: { _id: "$CardCode", count: { $sum: 1 } } },
      ]),

      // Get abandoned cart counts for all customers at once
      Cart.aggregate([
        {
          $match: {
            $or: [
              { customerEmail: { $in: customerEmails } },
              { "contactInfo.email": { $in: customerEmails } },
            ],
            status: "abandoned",
            isAbandoned: true,
          },
        },
        {
          $group: {
            _id: {
              $cond: [
                { $ifNull: ["$customerEmail", false] },
                "$customerEmail",
                "$contactInfo.email",
              ],
            },
            count: { $sum: 1 },
          },
        },
      ]),

      // Get historical turnover
      // Scenario 1: Invoices with Historical: true (from merged customers)
      // Scenario 2: Invoices from unmerged historical customers (non-SAP CardCode format and no Historical field)
      Invoice.aggregate([
        {
          $match: {
            CardCode: { $in: customerCodes },
            $or: [
              // Scenario 1: Explicitly marked as historical
              { Historical: true },
              // Scenario 2: Unmerged historical customers
              // Non-SAP format AND no Historical field (meaning it's an unmerged historical customer)
              {
                $and: [
                  { Historical: { $exists: false } },
                  { CardCode: { $not: /^[A-Za-z]\d+$/ } }, // Not SAP format
                ],
              },
            ],
          },
        },
        { $group: { _id: "$CardCode", totalAmount: { $sum: "$DocTotal" } } },
      ]),

      // Get SAP turnover
      // Scenario 1: Invoices with Historical: false (from merged customers)
      // Scenario 3: Invoices from pure SAP customers (SAP CardCode format and no Historical field)
      Invoice.aggregate([
        {
          $match: {
            CardCode: { $in: customerCodes },
            $or: [
              // Scenario 1: Explicitly marked as SAP (not historical)
              { Historical: false },
              // Scenario 3: Pure SAP customers
              // SAP format AND no Historical field (meaning it's a pure SAP customer)
              {
                $and: [
                  { Historical: { $exists: false } },
                  { CardCode: /^[A-Za-z]\d+$/ }, // SAP format
                ],
              },
            ],
          },
        },
        { $group: { _id: "$CardCode", totalAmount: { $sum: "$DocTotal" } } },
      ]),

      // Get total sales order amount for all customers
      SalesOrder.aggregate([
        { $match: { CardCode: { $in: customerCodes } } },
        { $group: { _id: "$CardCode", totalAmount: { $sum: "$DocTotal" } } },
      ]),

      // Get latest invoice date for each customer (from all invoices regardless of type)
      Invoice.aggregate([
        { $match: { CardCode: { $in: customerCodes } } },
        { $sort: { DocDate: -1 } },
        {
          $group: {
            _id: "$CardCode",
            latestInvoiceDate: { $first: "$DocDate" },
          },
        },
      ]),

      // Get quotation counts for all customers
      Quotation.aggregate([
        { $match: { CardCode: { $in: customerCodes } } },
        { $group: { _id: "$CardCode", count: { $sum: 1 } } },
      ]),
    ]);

    // Create lookup maps for O(1) access
    const invoiceMap = {};
    invoiceCounts.forEach((item) => {
      invoiceMap[item._id] = item.count;
    });

    const orderMap = {};
    orderCounts.forEach((item) => {
      orderMap[item._id] = item.count;
    });

    const cartMap = {};
    abandonedCarts.forEach((item) => {
      cartMap[item._id] = item.count;
    });

    // Create historical turnover map
    const historicalTurnoverMap = {};
    historicalTurnover.forEach((item) => {
      historicalTurnoverMap[item._id] = item.totalAmount;
    });

    // Create SAP turnover map
    const sapTurnoverMap = {};
    sapTurnover.forEach((item) => {
      sapTurnoverMap[item._id] = item.totalAmount;
    });

    // Create sales order total map
    const salesOrderMap = {};
    salesOrderTotal.forEach((item) => {
      salesOrderMap[item._id] = item.totalAmount;
    });

    // Create latest invoice date map
    const latestInvoiceDateMap = {};
    latestInvoiceDates.forEach((item) => {
      latestInvoiceDateMap[item._id] = item.latestInvoiceDate;
    });

    const quotationMap = {};
    quotationCounts.forEach((item) => {
      quotationMap[item._id] = item.count;
    });

    // Enhance customers with metrics
    const enhancedCustomers = customers.map((customer) => {
      const historicalAmount = historicalTurnoverMap[customer.CardCode] || 0;
      const sapAmount = sapTurnoverMap[customer.CardCode] || 0;
      const isSAP = isSAPCardCode(customer.CardCode);

      return {
        ...customer,
        metrics: {
          invoiceCount: invoiceMap[customer.CardCode] || 0,
          orderCount: orderMap[customer.CardCode] || 0,
          abandonedCartCount: customer.Email ? cartMap[customer.Email] || 0 : 0,
          historicalTurnover: historicalAmount,
          sapTurnover: sapAmount,
          totalTurnover: historicalAmount + sapAmount, // Combined turnover
          salesOrderTotal: salesOrderMap[customer.CardCode] || 0,
          latestInvoiceDate: latestInvoiceDateMap[customer.CardCode] || null,
          quotationCount: quotationMap[customer.CardCode] || 0,
        },
        // Customer classification flags
        isSAPCustomer: isSAP,
        isHistoricalCustomer: !isSAP, // Non-SAP format indicates historical
        isMergedCustomer: historicalAmount > 0 && sapAmount > 0, // Has both types of turnover
        isPureSAPCustomer: isSAP && historicalAmount === 0 && sapAmount > 0,
        isPureHistoricalCustomer:
          !isSAP && historicalAmount > 0 && sapAmount === 0,
      };
    });

    // Apply sorting based on metrics
    if (sortBy) {
      const sortDirection = sortOrder === "desc" ? -1 : 1;

      enhancedCustomers.sort((a, b) => {
        let aValue, bValue;

        switch (sortBy) {
          case "invoiceCount":
            aValue = a.metrics.invoiceCount;
            bValue = b.metrics.invoiceCount;
            break;
          case "orderCount":
            aValue = a.metrics.orderCount;
            bValue = b.metrics.orderCount;
            break;
          case "abandonedCartCount":
            aValue = a.metrics.abandonedCartCount;
            bValue = b.metrics.abandonedCartCount;
            break;
          case "historicalTurnover":
            // Sort by historical turnover - customers with historical data first
            if (
              a.metrics.historicalTurnover > 0 &&
              b.metrics.historicalTurnover > 0
            ) {
              aValue = a.metrics.historicalTurnover;
              bValue = b.metrics.historicalTurnover;
            } else if (
              a.metrics.historicalTurnover > 0 &&
              b.metrics.historicalTurnover === 0
            ) {
              return -1; // Customer with historical data comes first
            } else if (
              a.metrics.historicalTurnover === 0 &&
              b.metrics.historicalTurnover > 0
            ) {
              return 1; // Customer without historical data goes after
            } else {
              // Both have no historical data, maintain relative order
              return 0;
            }
            break;
          case "sapTurnover":
            // Sort by SAP turnover
            aValue = a.metrics.sapTurnover;
            bValue = b.metrics.sapTurnover;
            break;
          case "sapTurnoverOnly":
            // Sort by SAP turnover - customers with SAP data first
            if (a.metrics.sapTurnover > 0 && b.metrics.sapTurnover > 0) {
              aValue = a.metrics.sapTurnover;
              bValue = b.metrics.sapTurnover;
            } else if (
              a.metrics.sapTurnover > 0 &&
              b.metrics.sapTurnover === 0
            ) {
              return -1; // Customer with SAP data comes first
            } else if (
              a.metrics.sapTurnover === 0 &&
              b.metrics.sapTurnover > 0
            ) {
              return 1; // Customer without SAP data goes after
            } else {
              // Both have no SAP data, maintain relative order
              return 0;
            }
            break;
          case "totalTurnover":
            // Sort by combined turnover
            aValue = a.metrics.totalTurnover;
            bValue = b.metrics.totalTurnover;
            break;
          case "salesOrderTotal":
            aValue = a.metrics.salesOrderTotal;
            bValue = b.metrics.salesOrderTotal;
            break;
          case "latestInvoiceDate":
            aValue = a.metrics.latestInvoiceDate
              ? new Date(a.metrics.latestInvoiceDate).getTime()
              : 0;
            bValue = b.metrics.latestInvoiceDate
              ? new Date(b.metrics.latestInvoiceDate).getTime()
              : 0;
            break;
          case "quotationCount":
            aValue = a.metrics.quotationCount;
            bValue = b.metrics.quotationCount;
            break;
          case "CardName":
            return sortDirection * a.CardName.localeCompare(b.CardName);
          default:
            return 0;
        }

        // For cases where we have aValue and bValue
        if (aValue !== undefined && bValue !== undefined) {
          return sortDirection * (aValue - bValue);
        }

        return 0;
      });
    } else {
      // Default sorting by CardName
      enhancedCustomers.sort((a, b) => a.CardName.localeCompare(b.CardName));
    }

    // Get the total count AFTER all filters and sorting have been applied
    const totalCount = enhancedCustomers.length;

    // Apply pagination after sorting
    const paginatedCustomers = enhancedCustomers.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      customers: paginatedCustomers,
      pagination: {
        total: totalCount,
        page,
        pages: Math.ceil(totalCount / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Customer fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
exports.getCustomersPaginated2 = async (req, res) => {
  try {
    // Extract pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Extract filtering parameters
    const { status, search, assignedTo, type, sortBy, sortOrder } = req.query;
    const query = {};

    // Apply filters if provided
    if (status) query.status = status;

    if (assignedTo) query.assignedTo = assignedTo;

    // Search by name, code or email
    if (search) {
      query.$or = [
        { CardName: { $regex: search, $options: "i" } },
        { CardCode: { $regex: search, $options: "i" } },
        { Email: { $regex: search, $options: "i" } },
      ];
    }

    // Count total matching documents (for pagination)
    const totalCount = await Customer.countDocuments(query);

    // Get all matching customers without pagination for sorting by metrics
    let customers = await Customer.find({ ...query, status: "active" })
      .select(
        "CardCode CardName Email phoneNumber status assignedTo TotalSales LastPurchaseDate notes"
      )
      .populate("assignedTo", "firstName lastName email")
      .lean();

    // Extract customer codes and emails for efficient batch processing
    const customerCodes = customers.map((c) => c.CardCode);
    const customerEmails = customers.filter((c) => c.Email).map((c) => c.Email);

    // Batch query for all metrics in parallel for better performance
    const [invoiceCounts, orderCounts, abandonedCarts] = await Promise.all([
      // Get invoice counts for all customers at once
      Invoice.aggregate([
        { $match: { CardCode: { $in: customerCodes } } },
        { $group: { _id: "$CardCode", count: { $sum: 1 } } },
      ]),

      // Get order counts for all customers at once
      SalesOrder.aggregate([
        { $match: { CardCode: { $in: customerCodes } } },
        { $group: { _id: "$CardCode", count: { $sum: 1 } } },
      ]),

      // Get abandoned cart counts for all customers at once
      // Get abandoned cart counts for all customers at once
      Cart.aggregate([
        {
          $match: {
            $or: [
              { customerEmail: { $in: customerEmails } },
              { "contactInfo.email": { $in: customerEmails } },
            ],
            status: "abandoned",
            isAbandoned: true,
          },
        },
        {
          $group: {
            _id: {
              $cond: [
                { $ifNull: ["$customerEmail", false] },
                "$customerEmail",
                "$contactInfo.email",
              ],
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Create lookup maps for O(1) access
    const invoiceMap = {};
    invoiceCounts.forEach((item) => {
      invoiceMap[item._id] = item.count;
    });

    const orderMap = {};
    orderCounts.forEach((item) => {
      orderMap[item._id] = item.count;
    });

    const cartMap = {};
    abandonedCarts.forEach((item) => {
      cartMap[item._id] = item.count;
    });

    // Enhance customers with metrics
    const enhancedCustomers = customers.map((customer) => {
      return {
        ...customer,
        metrics: {
          invoiceCount: invoiceMap[customer.CardCode] || 0,
          orderCount: orderMap[customer.CardCode] || 0,
          abandonedCartCount: customer.Email ? cartMap[customer.Email] || 0 : 0,
        },
      };
    });

    // Apply sorting based on metrics
    if (sortBy) {
      const sortDirection = sortOrder === "desc" ? -1 : 1;

      enhancedCustomers.sort((a, b) => {
        let aValue, bValue;

        switch (sortBy) {
          case "invoiceCount":
            aValue = a.metrics.invoiceCount;
            bValue = b.metrics.invoiceCount;
            break;
          case "orderCount":
            aValue = a.metrics.orderCount;
            bValue = b.metrics.orderCount;
            break;
          case "abandonedCartCount":
            aValue = a.metrics.abandonedCartCount;
            bValue = b.metrics.abandonedCartCount;
            break;
          case "CardName":
            return sortDirection * a.CardName.localeCompare(b.CardName);
          default:
            return 0;
        }

        return sortDirection * (aValue - bValue);
      });
    } else {
      // Default sorting by CardName
      enhancedCustomers.sort((a, b) => a.CardName.localeCompare(b.CardName));
    }

    // Apply pagination after sorting
    const paginatedCustomers = enhancedCustomers.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      customers: paginatedCustomers,
      pagination: {
        total: totalCount,
        page,
        pages: Math.ceil(totalCount / limit),
        limit,
      },
    });
  } catch (error) {
    console.error("Customer fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Process HubSpot export Excel file
const processHubspotExport = (filePath) => {
  try {
    const workbook = XLSX.readFile(filePath, {
      cellDates: true, // Handle dates properly
      dateNF: "yyyy/mm/dd", // Date format
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });

    console.log("Excel data extracted:", data.length, "records");

    // Map the data to our customer format
    return data
      .map((row) => {
        // Parse the date field if it exists
        let createDate = null;
        if (row["Create Date"]) {
          // Handle different date formats
          try {
            createDate = new Date(row["Create Date"]);
            if (isNaN(createDate.getTime())) {
              // Try alternative date format (DD/MM/YYYY)
              const parts = row["Create Date"].split("/");
              if (parts.length === 3) {
                // Convert to MM/DD/YYYY format for JS Date
                createDate = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
              }
            }
          } catch (error) {
            console.warn("Could not parse date:", row["Create Date"]);
          }
        }

        let lastActivityDate = null;
        if (row["Last Activity Date"]) {
          try {
            lastActivityDate = new Date(row["Last Activity Date"]);
          } catch (error) {
            console.warn(
              "Could not parse activity date:",
              row["Last Activity Date"]
            );
          }
        }

        // Handle additional emails if present
        const additionalEmails = row["Additional email addresses"]
          ? row["Additional email addresses"]
              .split(/[,;]/)
              .map((email) => email.trim())
              .filter(Boolean)
          : [];

        // Marketing status mapping
        let marketingStatus = "marketing-contact";
        if (row["Marketing contact status"]) {
          if (
            row["Marketing contact status"]
              .toLowerCase()
              .includes("non-marketing")
          ) {
            marketingStatus = "non-marketing-contact";
          } else if (
            row["Marketing contact status"]
              .toLowerCase()
              .includes("unsubscribe")
          ) {
            marketingStatus = "unsubscribed";
          }
        }

        // Generate a CardName from first/last or full row
        let firstName = row["First Name"] || "";
        let lastName = row["Last Name"] || "";

        let phoneNumber = row["Phone Number"]
          ? String(row["Phone Number"]).replace(/[^\d+]/g, "")
          : "";

        // Handle special cases with "New RingOver Contact" or phone numbers
        if (
          firstName.includes("New RingOver Contact") ||
          firstName.includes("Ringover contact") ||
          firstName.match(/^\+?\d+/) || // Starts with + or digits
          firstName.includes("+")
        ) {
          firstName = "";
        }

        if (
          lastName.includes("New RingOver Contact") ||
          lastName.includes("Ringover contact") ||
          lastName.match(/^\+?\d+/)
        ) {
          // Starts with + or digits
          lastName = "";
        }

        // For CardName, combine name fields or use phone if that's all we have
        let cardName = "";
        if (firstName || lastName) {
          cardName = `${firstName} ${lastName}`.trim();
        } else if (phoneNumber) {
          // Use phone number as a name if nothing else available
          cardName = `Contact ${phoneNumber}`;
        } else if (row["Email"]) {
          // Use email as a name if nothing else available
          cardName = row["Email"];
        } else {
          // Fallback
          cardName = "Unnamed Contact";
        }

        // Sanitize CardName - don't keep "New RingOver Contact" as a name
        if (
          cardName.includes("New RingOver Contact") ||
          cardName.includes("Ringover contact")
        ) {
          if (phoneNumber) {
            cardName = `Contact ${phoneNumber}`;
          } else if (row["Email"]) {
            cardName = row["Email"];
          } else {
            cardName = "Unnamed Contact";
          }
        }

        // Check if phone number is in firstName or lastName for Ringover contacts
        if (
          (!phoneNumber || phoneNumber === "") &&
          firstName.match(/\d{10,}/)
        ) {
          // Extract phone number from firstName
          const match = firstName.match(/(\+?\d{10,})/);
          if (match) {
            phoneNumber = match[1].replace(/[^\d+]/g, "");
            firstName = firstName.replace(match[1], "").trim();
          }
        }

        return {
          // Basic info - required fields
          CardName: cardName,
          firstName: firstName,
          lastName: lastName,
          Email: row["Email"] || "",
          phoneNumber: phoneNumber,

          // External IDs
          hubspotId: row["Record ID"] ? String(row["Record ID"]) : undefined,

          // Classification
          customerType: "non-sap",
          status: row["Lead Status"] ? "lead" : "prospect",
          marketingStatus: marketingStatus,

          // Associated company
          company: row["Associated Company"] || "",
          companyId: row["Primary Associated Company ID"] || "",

          // Contact ownership
          contactOwnerName: row["Contact owner"] || "",

          createdAt: createDate || new Date(),

          // Additional info
          additionalEmails: additionalEmails,
        };
      })
      .filter((customer) => {
        // Filter out records with no usable contact information
        return (
          customer.Email ||
          customer.phoneNumber ||
          (customer.firstName && customer.lastName)
        );
      });
  } catch (error) {
    console.error("Error processing Excel file:", error);
    throw new Error(`Failed to process Excel file: ${error.message}`);
  }
};
const generateUniqueCardCode = (contact, index, usedCodes) => {
  // Start with NC prefix (Non-SAP Customer)
  let baseCode = "NC-";

  // Create a code based on available identifiers
  if (contact.hubspotId) {
    // Convert scientific notation to regular string without decimals
    if (String(contact.hubspotId).includes("E+")) {
      const parts = String(contact.hubspotId).split("E+");
      const base = parseFloat(parts[0]);
      const exponent = parseInt(parts[1]);

      // Convert to full number string
      const fullNumber = Math.round(base * Math.pow(10, exponent)).toString();
      baseCode += "HS-" + fullNumber.substring(0, 8); // Use first 8 digits of HubSpot ID
    } else {
      // Use the first 8 chars of ID
      baseCode += "HS-" + String(contact.hubspotId).substring(0, 8);
    }
  } else if (contact.Email) {
    // Use email prefix
    const emailPrefix = contact.Email.split("@")[0];
    baseCode += "EM-" + emailPrefix.substring(0, 8);
  } else if (contact.phoneNumber) {
    // Use last 8 digits of phone
    baseCode +=
      "PH-" +
      contact.phoneNumber.substring(
        Math.max(0, contact.phoneNumber.length - 8)
      );
  } else {
    // Fallback to timestamp + index
    baseCode += "TMP-" + Date.now().toString().substring(8) + "-" + index;
  }

  // Ensure uniqueness by adding suffixes if needed
  let finalCode = baseCode;
  let counter = 1;

  while (usedCodes.has(finalCode)) {
    finalCode = `${baseCode}-${counter}`;
    counter++;
  }

  // Add to used codes set
  usedCodes.add(finalCode);

  return finalCode;
};
// Import contacts from HubSpot export
exports.importHubspotContacts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log("File upload path:", req.file.path);

    // Process the Excel file
    const rawContacts = processHubspotExport(req.file.path);

    if (rawContacts.length === 0) {
      // Clean up file
      try {
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (unlinkError) {
        console.error("Error deleting file:", unlinkError);
      }

      return res.status(400).json({
        success: false,
        message: "No valid contact data found in the file",
      });
    }

    // Match contact owners to actual users in the system
    const agentMapping = {};

    // Get all sales agents
    const salesAgents = await User.find({ role: "sales_agent" });

    // Create agent name to ID mapping for faster lookups
    salesAgents.forEach((agent) => {
      const fullName = `${agent.firstName} ${agent.lastName}`.toLowerCase();
      agentMapping[fullName] = agent._id;
      agentMapping[agent.firstName.toLowerCase()] = agent._id;
      agentMapping[agent.lastName.toLowerCase()] = agent._id;
    });

    // Set to track used CardCodes to ensure uniqueness
    const usedCodes = new Set();

    // Check existing CardCodes in the database to avoid conflicts
    const existingCodes = await Customer.find({ CardCode: /^NC-/ }).select(
      "CardCode"
    );
    existingCodes.forEach((customer) => {
      usedCodes.add(customer.CardCode);
    });

    // Process all contacts and generate unique CardCodes
    const processedContacts = rawContacts.map((contact, index) => {
      // Generate unique CardCode
      const cardCode = generateUniqueCardCode(contact, index, usedCodes);

      // Assign the CardCode to the contact
      contact.CardCode = cardCode;

      // Assign agent if possible
      if (contact.contactOwnerName) {
        const ownerName = contact.contactOwnerName.toLowerCase();

        if (agentMapping[ownerName]) {
          contact.assignedTo = agentMapping[ownerName];
        }
      }

      return contact;
    });

    // Prepare operations for bulk import/update
    const operations = processedContacts.map((contact) => {
      // First try to find by HubSpot ID or email/phone
      let filter = {};

      if (contact.hubspotId) {
        filter.hubspotId = contact.hubspotId;
      } else if (contact.Email && contact.Email.length > 0) {
        filter.Email = contact.Email;
      } else if (contact.phoneNumber && contact.phoneNumber.length > 0) {
        filter.phoneNumber = contact.phoneNumber;
      } else {
        // No identifiable fields, create a new record
        return { insertOne: { document: contact } };
      }

      return {
        updateOne: {
          filter: filter,
          update: { $set: contact },
          upsert: true,
        },
      };
    });

    const result = await Customer.bulkWrite(operations);

    // Clean up the uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file after processing:", unlinkError);
    }

    res.status(200).json({
      success: true,
      message: `Processed ${processedContacts.length} contacts`,
      result: {
        matched: result.matchedCount,
        inserted: result.insertedCount,
        modified: result.modifiedCount,
        upserted: result.upsertedCount,
      },
    });
  } catch (error) {
    console.error("Import error:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error importing contacts",
      error: error.message,
    });
  }
};

exports.updateCustomerPhones = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file containing customer phone numbers",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log("File upload path:", req.file.path);
    console.log("File exists check:", fs.existsSync(req.file.path));

    let phoneData = [];
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // Process file based on extension
    if (fileExt === ".xlsx" || fileExt === ".xls") {
      // Process Excel file
      try {
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Extracted ${data.length} rows from Excel file`);

        // Map data to our phone format
        phoneData = data.map((row) => {
          // Extract phone numbers from different possible column names
          let phone1 = row["Telephone 1"] || row["Phone"] || "";
          let phone2 = row["Telephone 2"] || "";

          // Convert to string if they're numbers
          phone1 = phone1 !== undefined ? phone1.toString() : "";
          phone2 = phone2 !== undefined ? phone2.toString() : "";

          return {
            CardCode: row["BP Code"] || row["CardCode"] || "",
            phoneNumber: phone1.trim(),
            alternativePhone: phone2.trim(),
          };
        });
      } catch (error) {
        console.error("Error processing Excel file:", error);
        throw new Error(`Failed to process Excel file: ${error.message}`);
      }
    } else if (fileExt === ".csv") {
      // Process CSV file
      try {
        phoneData = await new Promise((resolve, reject) => {
          const results = [];
          fs.createReadStream(req.file.path)
            .pipe(csv())
            .on("data", (row) => {
              // Extract phone numbers from different possible column names
              let phone1 = row["Telephone 1"] || row["Phone"] || "";
              let phone2 = row["Telephone 2"] || "";

              // Convert to string
              phone1 = phone1 !== undefined ? phone1.toString() : "";
              phone2 = phone2 !== undefined ? phone2.toString() : "";

              results.push({
                CardCode: row["BP Code"] || row["CardCode"] || "",
                phoneNumber: phone1.trim(),
                alternativePhone: phone2.trim(),
              });
            })
            .on("end", () => {
              console.log(`Processed ${results.length} rows from CSV`);
              resolve(results);
            })
            .on("error", (error) => {
              reject(error);
            });
        });
      } catch (error) {
        console.error("Error processing CSV file:", error);
        throw new Error(`Failed to process CSV file: ${error.message}`);
      }
    } else {
      // Process text file with specific format
      try {
        const fileContent = fs.readFileSync(req.file.path, "utf8");
        const lines = fileContent.split("\n");

        console.log(`Processing ${lines.length} lines from text file`);

        // Process each line (skip header)
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Extract line index, CardCode, and CardName first
          // The pattern looks for: number C#### NAME/TEXT followed by possible phone numbers
          const basicMatch = line.match(/^\s*(\d+)\s+(C\d+)\s+(.*)/);

          if (basicMatch) {
            const [fullMatch, lineIndex, cardCode, remaining] = basicMatch;

            // Get all content after the CardCode
            const afterCardCode = line.substring(
              line.indexOf(cardCode) + cardCode.length
            );

            // Define various phone patterns with better pattern recognition
            // We'll use capturing groups to preserve the formatting
            const phonePattern =
              /(\d{2}[\s\.]{1}\d{2}[\s\.]{1}\d{2}[\s\.]{1}\d{2}[\s\.]{1}\d{2}|\d{2}[\s\.]{1}\d{2}[\s\.]{1}\d{2}[\s\.]{1}\d{2}|\d{10}|\d{9}|\d{8})/g;

            // Find all phone-like patterns in the text
            const phoneMatches = [...afterCardCode.matchAll(phonePattern)];
            const phones = phoneMatches.map((match) => match[0]);

            // Add to results if phone numbers found
            if (phones.length > 0) {
              phoneData.push({
                CardCode: cardCode.trim(),
                phoneNumber: phones[0] || "",
                alternativePhone: phones[1] || "",
              });
            }
          }
        }

        console.log(
          `Extracted ${phoneData.length} customer records with phones`
        );
      } catch (error) {
        console.error("Error processing text file:", error);
        throw new Error(`Failed to process text file: ${error.message}`);
      }
    }

    // Filter out entries without CardCode or phone numbers
    phoneData = phoneData.filter(
      (item) => item.CardCode && (item.phoneNumber || item.alternativePhone)
    );

    // Clean and format phone numbers properly, preserving spaces and formatting
    const cleanedPhoneData = phoneData.map((item) => {
      let phoneNum = item.phoneNumber;
      let altPhone = item.alternativePhone;

      // Function to clean and format phone numbers
      const formatPhoneNumber = (phone) => {
        if (!phone) return "";

        // Remove any non-phone content after the number (like "MILOUD" or "ancien")
        // This regex captures the phone part and ignores trailing text
        const phoneMatch = phone.match(
          /^((?:\+?\d+[\s\.\-]?)+)(?:\s+[a-zA-Z].*)?$/
        );
        let formattedPhone = phoneMatch ? phoneMatch[1].trim() : phone.trim();

        // If it's a plain 10-digit number, format it as XX XX XX XX XX
        if (/^\d{10}$/.test(formattedPhone)) {
          formattedPhone = formattedPhone.replace(
            /(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/,
            "$1 $2 $3 $4 $5"
          );
        }

        return formattedPhone;
      };

      return {
        CardCode: item.CardCode,
        phoneNumber: formatPhoneNumber(phoneNum),
        alternativePhone: formatPhoneNumber(altPhone),
      };
    });

    console.log(`Prepared ${cleanedPhoneData.length} phone records for update`);

    // Update database
    const updateResults = {
      total: cleanedPhoneData.length,
      updated: 0,
      notFound: 0,
      errors: [],
    };

    for (const item of cleanedPhoneData) {
      try {
        // Find customer by CardCode
        const customer = await Customer.findOne({ CardCode: item.CardCode });

        if (customer) {
          // Update primary phone number
          if (item.phoneNumber) {
            customer.phoneNumber = item.phoneNumber;
          }

          // Store alternative phone in additionalPhones array if it exists
          if (item.alternativePhone) {
            // Initialize additionalPhones if it doesn't exist
            if (!customer.additionalPhones) {
              customer.additionalPhones = [];
            }

            // Only add if not already present
            if (!customer.additionalPhones.includes(item.alternativePhone)) {
              customer.additionalPhones.push(item.alternativePhone);
            }
          }

          await customer.save();
          updateResults.updated++;
        } else {
          updateResults.notFound++;
        }
      } catch (error) {
        console.error(`Error updating customer ${item.CardCode}:`, error);
        updateResults.errors.push({
          CardCode: item.CardCode,
          error: error.message,
        });
      }
    }

    // Clean up the uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file after processing:", unlinkError);
    }

    res.status(200).json({
      success: true,
      message: `Phone number update complete`,
      results: updateResults,
    });
  } catch (error) {
    console.error("Phone update error:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error updating customer phone numbers",
      error: error.message,
    });
  }
};

exports.updateCustomerAddresses = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file containing customer addresses",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log("File upload path:", req.file.path);
    console.log("File exists check:", fs.existsSync(req.file.path));

    let addressData = [];
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // Process file based on extension
    if (fileExt === ".xlsx" || fileExt === ".xls") {
      // Process Excel file
      try {
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Extracted ${data.length} rows from Excel file`);

        // Map data to our address format
        addressData = data.map((row) => {
          return {
            CardCode: row["BP Code"] || row["CardCode"] || "",
            street: row["Bill-to Street"] || row["Street"] || "",
            zipCode:
              row["Bill-to Zip Code"] || row["Zip Code"] || row["ZIP"] || "",
            city: row["Bill-to City"] || "",
            BP_Name: row["BP Name"] || row["CardName"] || "",
          };
        });
      } catch (error) {
        console.error("Error processing Excel file:", error);
        throw new Error(`Failed to process Excel file: ${error.message}`);
      }
    } else if (fileExt === ".csv") {
      // Process CSV file
      try {
        addressData = await new Promise((resolve, reject) => {
          const results = [];
          fs.createReadStream(req.file.path)
            .pipe(csv())
            .on("data", (row) => {
              results.push({
                CardCode: row["BP Code"] || row["CardCode"] || "",
                street: row["Bill-to Street"] || row["Street"] || "",
                zipCode:
                  row["Bill-to Zip Code"] ||
                  row["Zip Code"] ||
                  row["ZIP"] ||
                  "",
                city: row["Bill-to City"] || "",
                BP_Name: row["BP Name"] || row["CardName"] || "",
              });
            })
            .on("end", () => {
              console.log(`Processed ${results.length} rows from CSV`);
              resolve(results);
            })
            .on("error", (error) => {
              reject(error);
            });
        });
      } catch (error) {
        console.error("Error processing CSV file:", error);
        throw new Error(`Failed to process CSV file: ${error.message}`);
      }
    } else {
      // Process text file with specific format (like your example)
      try {
        const fileContent = fs.readFileSync(req.file.path, "utf8");
        const lines = fileContent.split("\n");

        console.log(`Processing ${lines.length} lines from text file`);

        // Process each line (skip header if present)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Match text format: index BP_Code BP_Name Street ZipCode
          // This regex captures the line structure with flexible spacing
          const match = line.match(
            /^\s*(\d+)\s+(C\d+)\s+(.+?)\s+(\d+.*?)(?:\s+(\d{5}))?\s*$/
          );

          if (match) {
            // If there are 5 matches, then we have index, BP_Code, BP_Name, Street, ZipCode
            const [, index, cardCode, name, street, zipCode] = match;

            // Extract city from the address if available
            const streetParts = street.split(",");
            let addressStreet = street;
            let city = "";

            // If there's a comma, assume the part after the comma is the city
            if (streetParts.length > 1) {
              addressStreet = streetParts[0].trim();
              city = streetParts[1].trim();
            }

            addressData.push({
              CardCode: cardCode.trim(),
              BP_Name: name.trim(),
              street: addressStreet,
              zipCode: zipCode || "",
              city: city,
            });
          } else {
            // Try alternative format without index at the beginning
            const altMatch = line.match(
              /^(C\d+)\s+(.+?)\s+(\d+.*?)(?:\s+(\d{5}))?\s*$/
            );

            if (altMatch) {
              const [, cardCode, name, street, zipCode] = altMatch;

              // Process same as above
              const streetParts = street.split(",");
              let addressStreet = street;
              let city = "";

              if (streetParts.length > 1) {
                addressStreet = streetParts[0].trim();
                city = streetParts[1].trim();
              }

              addressData.push({
                CardCode: cardCode.trim(),
                BP_Name: name.trim(),
                street: addressStreet,
                zipCode: zipCode || "",
                city: city,
              });
            }
          }
        }

        console.log(
          `Extracted ${addressData.length} customer records with addresses`
        );
      } catch (error) {
        console.error("Error processing text file:", error);
        throw new Error(`Failed to process text file: ${error.message}`);
      }
    }

    // Filter out entries without CardCode or address
    addressData = addressData.filter((item) => item.CardCode && item.street);

    // Clean and process address data
    const cleanedAddressData = addressData.map((item) => {
      // Extract city from zipCode if not already set
      let city = item.city || "";
      let zipCode = item.zipCode || "";

      // French postal codes are typically 5 digits
      if (!city && zipCode.length === 5) {
        // You could add a lookup table here for French postal codes to cities
        // For now, we'll just use the data as is
      }

      // Clean street address - remove any excess whitespace
      let street = item.street ? item.street.trim() : "";

      return {
        CardCode: item.CardCode,
        address: {
          street: street,
          zipCode: zipCode,
          city: city,
          country: "France", // Default for your dataset
        },
      };
    });

    console.log(
      `Prepared ${cleanedAddressData.length} address records for update`
    );

    // Update database
    const updateResults = {
      total: cleanedAddressData.length,
      updated: 0,
      notFound: 0,
      errors: [],
    };

    for (const item of cleanedAddressData) {
      try {
        // Find customer by CardCode
        const customer = await Customer.findOne({ CardCode: item.CardCode });

        if (customer) {
          // Update address fields
          customer.address = item.address;

          await customer.save();
          updateResults.updated++;
        } else {
          updateResults.notFound++;
        }
      } catch (error) {
        console.error(`Error updating customer ${item.CardCode}:`, error);
        updateResults.errors.push({
          CardCode: item.CardCode,
          error: error.message,
        });
      }
    }

    // Clean up the uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file after processing:", unlinkError);
    }

    res.status(200).json({
      success: true,
      message: `Address update complete`,
      results: updateResults,
    });
  } catch (error) {
    console.error("Address update error:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error updating customer addresses",
      error: error.message,
    });
  }
};

exports.updateCustomerOutstandingBalance = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message:
          "Please upload a file containing customer outstanding balances",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log("File upload path:", req.file.path);
    console.log("File exists check:", fs.existsSync(req.file.path));

    let balanceData = [];
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // Process file based on extension (same as before)
    if (fileExt === ".xlsx" || fileExt === ".xls") {
      // Process Excel file
      try {
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Extracted ${data.length} rows from Excel file`);

        balanceData = data.map((row) => {
          return {
            CardCode: row["BP Code"] || row["CardCode"] || "",
            outstandingBalance: parseFloat(
              row["Account Balance"] || row["Balance"] || 0
            ),
            BP_Name: row["BP Name"] || row["CardName"] || "",
          };
        });
      } catch (error) {
        console.error("Error processing Excel file:", error);
        throw new Error(`Failed to process Excel file: ${error.message}`);
      }
    } else if (fileExt === ".csv") {
      // Process CSV file
      try {
        balanceData = await new Promise((resolve, reject) => {
          const results = [];
          fs.createReadStream(req.file.path)
            .pipe(csv())
            .on("data", (row) => {
              results.push({
                CardCode: row["BP Code"] || row["CardCode"] || "",
                outstandingBalance: parseFloat(
                  row["Account Balance"] || row["Balance"] || 0
                ),
                BP_Name: row["BP Name"] || row["CardName"] || "",
              });
            })
            .on("end", () => {
              console.log(`Processed ${results.length} rows from CSV`);
              resolve(results);
            })
            .on("error", (error) => {
              reject(error);
            });
        });
      } catch (error) {
        console.error("Error processing CSV file:", error);
        throw new Error(`Failed to process CSV file: ${error.message}`);
      }
    } else {
      // Process text file with specific format
      try {
        const fileContent = fs.readFileSync(req.file.path, "utf8");
        const lines = fileContent.split("\n");

        console.log(`Processing ${lines.length} lines from text file`);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          if (
            line.includes("BP Code") &&
            line.includes("BP Name") &&
            line.includes("Account Balance")
          ) {
            continue;
          }

          const match = line.match(
            /^\s*(\d+)\s+(C\d+)\s+(.+?)\s+(-?\d+(\.\d+)?)\s*$/
          );

          if (match) {
            const [, index, cardCode, name, balance] = match;
            balanceData.push({
              CardCode: cardCode.trim(),
              BP_Name: name.trim(),
              outstandingBalance: parseFloat(balance),
            });
          } else {
            const altMatch = line.match(
              /^(C\d+)\s+(.+?)\s+(-?\d+(\.\d+)?)\s*$/
            );

            if (altMatch) {
              const [, cardCode, name, balance] = altMatch;
              balanceData.push({
                CardCode: cardCode.trim(),
                BP_Name: name.trim(),
                outstandingBalance: parseFloat(balance),
              });
            }
          }
        }

        console.log(
          `Extracted ${balanceData.length} customer records with balances`
        );
      } catch (error) {
        console.error("Error processing text file:", error);
        throw new Error(`Failed to process text file: ${error.message}`);
      }
    }

    // Filter out entries without CardCode
    balanceData = balanceData.filter((item) => item.CardCode);

    // Ensure balance values are numbers and not NaN
    const cleanedBalanceData = balanceData.map((item) => {
      return {
        CardCode: item.CardCode,
        outstandingBalance: isNaN(item.outstandingBalance)
          ? 0
          : item.outstandingBalance,
      };
    });

    console.log(
      `Prepared ${cleanedBalanceData.length} balance records for update`
    );

    // OPTIMIZED BATCH UPDATE SECTION
    const updateResults = {
      total: cleanedBalanceData.length,
      updated: 0,
      notFound: 0,
      errors: [],
    };

    if (cleanedBalanceData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid balance data found in the uploaded file",
      });
    }

    try {
      // Extract all CardCodes for bulk query
      const cardCodes = cleanedBalanceData.map((item) => item.CardCode);

      // Find all existing customers in one query
      const existingCustomers = await Customer.find({
        CardCode: { $in: cardCodes },
      }).select("CardCode");

      const existingCardCodes = new Set(
        existingCustomers.map((c) => c.CardCode)
      );

      // Prepare bulk operations
      const bulkOperations = [];

      for (const item of cleanedBalanceData) {
        if (existingCardCodes.has(item.CardCode)) {
          bulkOperations.push({
            updateOne: {
              filter: { CardCode: item.CardCode },
              update: { $set: { outstandingBalance: item.outstandingBalance } },
            },
          });
          updateResults.updated++;
        } else {
          updateResults.notFound++;
        }
      }

      // Execute bulk update if we have operations
      if (bulkOperations.length > 0) {
        console.log(
          `Executing bulk update for ${bulkOperations.length} customers`
        );

        const bulkResult = await Customer.bulkWrite(bulkOperations, {
          ordered: false, // Continue even if some operations fail
        });

        console.log("Bulk update result:", {
          matchedCount: bulkResult.matchedCount,
          modifiedCount: bulkResult.modifiedCount,
          upsertedCount: bulkResult.upsertedCount,
        });

        // Update our results based on actual bulk operation results
        updateResults.updated = bulkResult.modifiedCount;

        // Handle any bulk write errors
        if (bulkResult.writeErrors && bulkResult.writeErrors.length > 0) {
          updateResults.errors = bulkResult.writeErrors.map((err) => ({
            CardCode: err.op?.filter?.CardCode || "Unknown",
            error: err.errmsg,
          }));
        }
      }

      console.log("Update completed:", updateResults);
    } catch (error) {
      console.error("Bulk update error:", error);
      updateResults.errors.push({
        CardCode: "Bulk Operation",
        error: error.message,
      });
    }

    // Clean up the uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file after processing:", unlinkError);
    }

    res.status(200).json({
      success: true,
      message: `Outstanding balance update complete`,
      results: updateResults,
    });
  } catch (error) {
    console.error("Balance update error:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error updating customer outstanding balances",
      error: error.message,
    });
  }
};
exports.getCustomerCallData = async (req, res) => {
  try {
    const customerId = req.params.id;

    // First, find the customer to get their phone numbers
    const customer = await Customer.findOne({ CardCode: customerId });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Collect ALL phone numbers from different fields
    let allPhoneNumbers = [];

    // Add primary phone number
    if (customer.phoneNumber) {
      allPhoneNumbers.push(customer.phoneNumber);
    }

    // Add additional phone numbers (from additionalPhoneNumbers field)
    if (
      customer.additionalPhoneNumbers &&
      Array.isArray(customer.additionalPhoneNumbers)
    ) {
      allPhoneNumbers.push(...customer.additionalPhoneNumbers);
    }

    // Add additional phones (from additionalPhones field if it exists)
    if (customer.additionalPhones && Array.isArray(customer.additionalPhones)) {
      allPhoneNumbers.push(...customer.additionalPhones);
    }

    // Function to normalize phone numbers to core digits for matching
    const normalizePhoneForMatching = (phone) => {
      if (!phone || typeof phone !== "string") return null;

      // Remove all non-digit characters
      let digitsOnly = phone.replace(/[^\d]/g, "");

      // Handle French numbers - normalize to 9 digits (without leading 0)
      if (digitsOnly.startsWith("33") && digitsOnly.length >= 11) {
        // +33123456789 -> 123456789
        return digitsOnly.substring(2);
      } else if (digitsOnly.startsWith("0") && digitsOnly.length === 10) {
        // 0123456789 -> 123456789
        return digitsOnly.substring(1);
      } else if (digitsOnly.length === 9) {
        // 123456789 -> 123456789
        return digitsOnly;
      }

      return digitsOnly;
    };

    // Normalize customer phone numbers to core digits
    const customerCoreNumbers = [];

    allPhoneNumbers.forEach((phone) => {
      const coreNumber = normalizePhoneForMatching(phone);
      if (coreNumber && coreNumber.length >= 6) {
        customerCoreNumbers.push(coreNumber);
      }
    });

    // Remove duplicates
    const uniqueCoreNumbers = [...new Set(customerCoreNumbers)];

    console.log(`Customer ${customerId} phone numbers:`, {
      original: allPhoneNumbers,
      coreNumbers: uniqueCoreNumbers,
    });

    // If no valid numbers, return empty response
    if (uniqueCoreNumbers.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        statistics: {
          totalCalls: 0,
          inboundCalls: 0,
          outboundCalls: 0,
          missedCalls: 0,
          answerRate: 0,
          avgDuration: 0,
        },
        pagination: {
          total: 0,
          page: 1,
          limit: 10,
          pages: 0,
        },
      });
    }

    // Get pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get all call data to check against customer numbers
    const allCalls = await CallData.find({
      $and: [
        { fromNumber: { $nin: [null, "", ".", "N/A", "Unknown"] } },
        { toNumber: { $nin: [null, "", ".", "N/A", "Unknown"] } },
      ],
    })
      .select("fromNumber toNumber _id")
      .lean();

    // Find matching calls by normalizing call data phone numbers
    const matchingCallIds = [];

    allCalls.forEach((call) => {
      const fromCore = normalizePhoneForMatching(call.fromNumber);
      const toCore = normalizePhoneForMatching(call.toNumber);

      if (
        (fromCore && uniqueCoreNumbers.includes(fromCore)) ||
        (toCore && uniqueCoreNumbers.includes(toCore))
      ) {
        matchingCallIds.push(call._id);
      }
    });

    const filter = {
      _id: { $in: matchingCallIds },
    };

    // Date range filter
    if (req.query.startDate && req.query.endDate) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        startTime: {
          $gte: new Date(req.query.startDate),
          $lte: new Date(req.query.endDate),
        },
      });
    }

    // Direction filter
    if (req.query.direction && req.query.direction !== "all") {
      filter.$and = filter.$and || [];
      filter.$and.push({ direction: req.query.direction });
    }

    // Call status filter
    if (req.query.status === "missed") {
      filter.$and = filter.$and || [];
      filter.$and.push({ missed: { $ne: "" } });
    } else if (req.query.status === "answered") {
      filter.$and = filter.$and || [];
      filter.$and.push({ missed: "" });
    }

    console.log(
      `Found ${matchingCallIds.length} matching calls for customer ${customerId}`
    );

    // Get paginated call data
    const callData = await CallData.find(filter)
      .select(
        "id callID direction fromNumber toNumber startTime inCallDuration totalDuration lastState missed userName transcript analysis qualityScore structuredAnalysis analysisTimestamp file"
      )
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Count total documents
    const total = await CallData.countDocuments(filter);

    // Aggregate call statistics
    const statistics = await CallData.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          inboundCalls: {
            $sum: { $cond: [{ $eq: ["$direction", "in"] }, 1, 0] },
          },
          outboundCalls: {
            $sum: { $cond: [{ $eq: ["$direction", "out"] }, 1, 0] },
          },
          missedCalls: { $sum: { $cond: [{ $ne: ["$missed", ""] }, 1, 0] } },
          totalDuration: { $sum: "$totalDuration" },
          avgDuration: { $avg: "$inCallDuration" },
          totalInCallDuration: { $sum: "$inCallDuration" },
        },
      },
    ]);

    const stats = statistics[0] || {
      totalCalls: 0,
      inboundCalls: 0,
      outboundCalls: 0,
      missedCalls: 0,
      totalDuration: 0,
      avgDuration: 0,
      totalInCallDuration: 0,
    };

    stats.answerRate =
      stats.totalCalls > 0
        ? (
            ((stats.totalCalls - stats.missedCalls) / stats.totalCalls) *
            100
          ).toFixed(1)
        : 0;

    return res.status(200).json({
      success: true,
      data: callData,
      statistics: stats,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
      debug: {
        customerPhones: uniqueCoreNumbers,
        totalMatchingCalls: matchingCallIds.length,
      },
    });
  } catch (error) {
    console.error("Error fetching customer call data:", error);
    return res.status(500).json({
      error: "Error fetching customer call data",
      details: error.message,
    });
  }
};

// Merge customers with the same email address
exports.mergeCustomersWithSameEmail = async (req, res) => {
  try {
    // Get all customers with non-empty emails
    const customersWithEmail = await Customer.find({
      Email: { $ne: null, $ne: "" },
    }).sort({ createdAt: 1 });

    // Group customers by email address
    const emailGroups = {};
    customersWithEmail.forEach((customer) => {
      const email = customer.Email.toLowerCase().trim();
      if (!emailGroups[email]) {
        emailGroups[email] = [];
      }
      emailGroups[email].push(customer);
    });

    const mergeResults = {
      totalEmailGroups: 0,
      totalMerges: 0,
      skippedSingleCustomers: 0,
      skippedMoreThanTwoCustomers: 0,
      mergedPairs: [],
    };

    // Process each email group
    for (const [email, customers] of Object.entries(emailGroups)) {
      mergeResults.totalEmailGroups++;

      // Skip if only one customer with this email
      if (customers.length === 1) {
        mergeResults.skippedSingleCustomers++;
        continue;
      }

      // Find SAP and non-SAP customers
      const sapCustomers = customers.filter((c) => c.CardCode.startsWith("C"));
      const nonSapCustomers = customers.filter((c) =>
        c.CardCode.startsWith("NC")
      );

      // If we have both SAP and non-SAP customers, merge them
      if (sapCustomers.length > 0 && nonSapCustomers.length > 0) {
        // Take the first customer from each group for merging
        const sapCustomer = sapCustomers[0];
        const nonSapCustomer = nonSapCustomers[0];

        // Merge the customers
        const primaryCustomer = sapCustomer; // SAP customer is the primary
        const secondaryCustomer = nonSapCustomer;

        // Create a merged customer object
        const mergedData = {
          // Keep SAP data from the primary customer
          CardName: primaryCustomer.CardName,
          CardCode: primaryCustomer.CardCode,
          Email: primaryCustomer.Email,

          // Prefer data from the SAP customer but fall back to non-SAP data
          firstName: primaryCustomer.firstName || secondaryCustomer.firstName,
          lastName: primaryCustomer.lastName || secondaryCustomer.lastName,
          phoneNumber:
            primaryCustomer.phoneNumber || secondaryCustomer.phoneNumber,

          // Keep external IDs
          hubspotId: secondaryCustomer.hubspotId || primaryCustomer.hubspotId,

          // Keep assignedTo from either customer
          assignedTo:
            primaryCustomer.assignedTo || secondaryCustomer.assignedTo,

          // Keep additional data
          notes: primaryCustomer.notes || secondaryCustomer.notes,

          // Combine additional emails
          additionalEmails: [
            ...(primaryCustomer.additionalEmails || []),
            ...(secondaryCustomer.additionalEmails || []),
            // Add the secondary customer's email if different from primary
            ...(primaryCustomer.Email !== secondaryCustomer.Email
              ? [secondaryCustomer.Email]
              : []),
          ].filter((email, index, self) => self.indexOf(email) === index), // Remove duplicates

          // Prefer SAP customer's address
          address: primaryCustomer.address || secondaryCustomer.address,

          // Use SAP customer's balance
          outstandingBalance: primaryCustomer.outstandingBalance,

          // Set the customer type to SAP
          customerType: "sap",

          // Keep the active status if either customer is active
          status:
            primaryCustomer.status === "active" ||
            secondaryCustomer.status === "active"
              ? "active"
              : primaryCustomer.status,

          // Update timestamp
          updatedAt: new Date(),
        };

        // Update the primary customer with the merged data
        await Customer.findByIdAndUpdate(primaryCustomer._id, mergedData);

        // Optionally: Mark the secondary customer as merged or delete it
        // Here we'll keep it but mark it as inactive and add a note
        await Customer.findByIdAndUpdate(secondaryCustomer._id, {
          status: "inactive",
          notes: `Merged with ${primaryCustomer.CardCode} (${
            primaryCustomer.CardName
          }) on ${new Date().toISOString()}. ${secondaryCustomer.notes || ""}`,
          mergedInto: primaryCustomer._id,
        });

        mergeResults.totalMerges++;
        mergeResults.mergedPairs.push({
          primaryCustomer: {
            _id: primaryCustomer._id,
            CardCode: primaryCustomer.CardCode,
            CardName: primaryCustomer.CardName,
            Email: primaryCustomer.Email,
          },
          secondaryCustomer: {
            _id: secondaryCustomer._id,
            CardCode: secondaryCustomer.CardCode,
            CardName: secondaryCustomer.CardName,
            Email: secondaryCustomer.Email,
          },
        });
      } else if (customers.length > 2) {
        // If we have more than 2 customers but not a SAP + non-SAP pair
        mergeResults.skippedMoreThanTwoCustomers++;
      }
    }

    return res.status(200).json({
      success: true,
      message: "Customer merge operation completed",
      results: mergeResults,
    });
  } catch (error) {
    console.error("Error merging customers:", error);
    return res.status(500).json({
      success: false,
      message: "Error merging customers",
      error: error.message,
    });
  }
};

// Delete non-SAP customers that have been previously merged
exports.deleteMergedNonSapCustomers = async (req, res) => {
  try {
    // Find all non-SAP customers (NC prefix) that have been marked as inactive due to merging
    const mergedCustomers = await Customer.find({
      CardCode: { $regex: "^NC" },
      status: "inactive",
      notes: { $regex: "Merged with C" }, // Look for the merge note pattern
    });

    if (mergedCustomers.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No merged non-SAP customers found to delete",
        count: 0,
      });
    }

    // Get the IDs of customers to delete
    const customerIdsToDelete = mergedCustomers.map((customer) => customer._id);

    // Optional: Log which customers will be deleted
    console.log(
      `Deleting ${customerIdsToDelete.length} merged non-SAP customers`
    );

    // Delete all these customers in one operation
    const deleteResult = await Customer.deleteMany({
      _id: { $in: customerIdsToDelete },
    });

    return res.status(200).json({
      success: true,
      message: "Successfully deleted merged non-SAP customers",
      count: deleteResult.deletedCount,
      details: mergedCustomers.map((c) => ({
        _id: c._id,
        CardCode: c.CardCode,
        CardName: c.CardName,
        Email: c.Email,
        mergedWith: c.notes.match(/Merged with (C\d+)/)?.[1] || "Unknown",
      })),
    });
  } catch (error) {
    console.error("Error deleting merged customers:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting merged customers",
      error: error.message,
    });
  }
};

// Controller function for assigning customers to agents from CSV file
exports.assignCustomersFromFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a CSV file",
      });
    }

    console.log("Processing customer-agent assignment file:", req.file.path);
    const startTime = Date.now();

    // Read CSV file
    const csv = require("csv-parser");
    const data = [];

    // Parse CSV data
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on("data", (row) => {
          data.push(row);
        })
        .on("end", () => {
          console.log(`Extracted ${data.length} rows from CSV file`);
          resolve();
        })
        .on("error", (error) => {
          console.error("CSV parsing error:", error);
          reject(error);
        });
    });

    // Log the first few rows to see the actual structure
    console.log(
      "First 3 rows of data:",
      JSON.stringify(data.slice(0, 3), null, 2)
    );

    // Log all available column names
    if (data.length > 0) {
      console.log("Available columns:", Object.keys(data[0]));
    }

    // Extract assignments from the data with more flexible column matching
    const assignments = data
      .map((row, index) => {
        // Try different possible column name variations
        const cardCode = (
          row["card code"] ||
          row["CardCode"] ||
          row["Card Code"] ||
          row["CARD CODE"] ||
          row["card_code"] ||
          ""
        )
          .toString()
          .trim();

        const agentName = (
          row["agent name"] ||
          row["AgentName"] ||
          row["Agent Name"] ||
          row["AGENT NAME"] ||
          row["agent_name"] ||
          ""
        )
          .toString()
          .trim();

        // Log first 5 rows for debugging
        if (index < 5) {
          console.log(`Row ${index + 1}:`, {
            rawRow: row,
            extractedCardCode: cardCode,
            extractedAgentName: agentName,
          });
        }

        return {
          cardCode,
          agentName,
        };
      })
      .filter((item) => item.cardCode && item.agentName);

    console.log(
      `Found ${assignments.length} valid assignments out of ${data.length} rows`
    );

    if (assignments.length === 0) {
      // If no assignments found, provide detailed debugging info
      console.log(
        "DEBUG: No assignments found. Let's check the data structure:"
      );

      if (data.length > 0) {
        console.log("Sample row keys:", Object.keys(data[0]));
        console.log("Sample row values:", Object.values(data[0]));

        // Try to auto-detect column names
        const possibleCardCodeColumns = Object.keys(data[0]).filter(
          (key) =>
            key.toLowerCase().includes("card") ||
            key.toLowerCase().includes("code")
        );
        const possibleAgentNameColumns = Object.keys(data[0]).filter(
          (key) =>
            key.toLowerCase().includes("agent") ||
            key.toLowerCase().includes("name")
        );

        console.log("Possible CardCode columns:", possibleCardCodeColumns);
        console.log("Possible AgentName columns:", possibleAgentNameColumns);
      }

      return res.status(400).json({
        success: false,
        message: "No valid customer-agent assignments found in the file",
        debug: {
          totalRows: data.length,
          sampleRow: data[0] || null,
          availableColumns: data.length > 0 ? Object.keys(data[0]) : [],
        },
      });
    }

    // Get all sales agents and create name mapping
    const salesAgents = await User.find({ role: "sales_agent" }).lean();
    const agentMapping = new Map();

    salesAgents.forEach((agent) => {
      const fullName = `${agent.firstName} ${agent.lastName}`
        .toLowerCase()
        .trim();
      const firstName = agent.firstName.toLowerCase().trim();
      const lastName = agent.lastName.toLowerCase().trim();

      // Map different name variations to agent ID
      agentMapping.set(fullName, agent._id);
      agentMapping.set(firstName, agent._id);
      agentMapping.set(lastName, agent._id);

      // Handle name variations (with/without spaces, different order)
      agentMapping.set(`${firstName} ${lastName}`, agent._id);
      agentMapping.set(`${lastName} ${firstName}`, agent._id);
      agentMapping.set(firstName.replace(/\s+/g, ""), agent._id);
      agentMapping.set(lastName.replace(/\s+/g, ""), agent._id);

      console.log(`Agent mapping: "${fullName}" -> ${agent._id}`);
    });

    console.log(`Created agent mapping for ${salesAgents.length} agents`);

    // Get all customer CardCodes from assignments
    const cardCodes = assignments.map((a) => a.cardCode);

    // Find existing customers
    const existingCustomers = await Customer.find({
      CardCode: { $in: cardCodes },
    }).lean();

    const existingCardCodeMap = new Map();
    existingCustomers.forEach((customer) => {
      existingCardCodeMap.set(customer.CardCode, customer._id);
    });

    console.log(
      `Found ${existingCustomers.length} existing customers out of ${cardCodes.length} card codes`
    );

    // Prepare bulk update operations
    const bulkOperations = [];
    const results = {
      total: assignments.length,
      assigned: 0,
      customerNotFound: 0,
      agentNotFound: 0,
      errors: [],
    };

    for (const assignment of assignments) {
      try {
        // Check if customer exists
        const customerId = existingCardCodeMap.get(assignment.cardCode);
        if (!customerId) {
          results.customerNotFound++;
          results.errors.push({
            cardCode: assignment.cardCode,
            agentName: assignment.agentName,
            error: "Customer not found",
          });
          continue;
        }

        // Find agent ID
        const agentName = assignment.agentName.toLowerCase().trim();
        const agentId = agentMapping.get(agentName);

        if (!agentId) {
          results.agentNotFound++;
          results.errors.push({
            cardCode: assignment.cardCode,
            agentName: assignment.agentName,
            error: `Agent not found. Available agents: ${Array.from(
              agentMapping.keys()
            ).join(", ")}`,
          });
          continue;
        }

        // Add to bulk operations
        bulkOperations.push({
          updateOne: {
            filter: { _id: customerId },
            update: {
              $set: {
                assignedTo: agentId,
                updatedAt: new Date(),
              },
            },
          },
        });

        results.assigned++;
      } catch (error) {
        results.errors.push({
          cardCode: assignment.cardCode,
          agentName: assignment.agentName,
          error: error.message,
        });
      }
    }

    // Execute bulk operations
    if (bulkOperations.length > 0) {
      console.log(`Executing ${bulkOperations.length} assignment updates`);

      const bulkResult = await Customer.bulkWrite(bulkOperations, {
        ordered: false,
      });

      console.log("Bulk update result:", {
        matchedCount: bulkResult.matchedCount,
        modifiedCount: bulkResult.modifiedCount,
      });
    }

    // Clean up uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file:", unlinkError);
    }

    const totalTime = Date.now() - startTime;
    console.log(`Assignment completed in ${totalTime}ms`);

    res.status(200).json({
      success: true,
      message: `Customer assignment completed in ${totalTime}ms`,
      results: {
        ...results,
        processingTimeMs: totalTime,
      },
    });
  } catch (error) {
    console.error("Customer assignment error:", error);

    // Clean up file
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error assigning customers to agents",
      error: error.message,
    });
  }
};
exports.updateMissingEmails = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file containing customer email data",
      });
    }

    // Ensure uploads directory exists
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log("File upload path:", req.file.path);
    console.log("File exists check:", fs.existsSync(req.file.path));

    let emailData = [];
    const fileExt = path.extname(req.file.originalname).toLowerCase();

    // Process file based on extension
    if (fileExt === ".xlsx" || fileExt === ".xls") {
      // Process Excel file
      try {
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Extracted ${data.length} rows from Excel file`);

        // Map data to our email format
        emailData = data.map((row) => {
          return {
            CardCode: row["BP Code"] || row["CardCode"] || "",
            Email: row["E-Mail"] || row["Email"] || "",
            BP_Name: row["BP Name"] || row["CardName"] || "",
          };
        });
      } catch (error) {
        console.error("Error processing Excel file:", error);
        throw new Error(`Failed to process Excel file: ${error.message}`);
      }
    } else if (fileExt === ".csv") {
      // Process CSV file
      try {
        emailData = await new Promise((resolve, reject) => {
          const results = [];
          fs.createReadStream(req.file.path)
            .pipe(csv())
            .on("data", (row) => {
              results.push({
                CardCode: row["BP Code"] || row["CardCode"] || "",
                Email: row["E-Mail"] || row["Email"] || "",
                BP_Name: row["BP Name"] || row["CardName"] || "",
              });
            })
            .on("end", () => {
              console.log(`Processed ${results.length} rows from CSV`);
              resolve(results);
            })
            .on("error", (error) => {
              reject(error);
            });
        });
      } catch (error) {
        console.error("Error processing CSV file:", error);
        throw new Error(`Failed to process CSV file: ${error.message}`);
      }
    } else {
      // Process text file with specific format
      try {
        const fileContent = fs.readFileSync(req.file.path, "utf8");
        const lines = fileContent.split("\n");

        console.log(`Processing ${lines.length} lines from text file`);

        // Skip header row if it exists
        let startLine = 0;
        if (
          lines[0].includes("BP Code") ||
          lines[0].includes("BP Name") ||
          lines[0].includes("E-Mail")
        ) {
          startLine = 1;
        }

        // Process each line
        for (let i = startLine; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Match pattern for text: [index] BP_Code BP_Name Email
          const match = line.match(
            /^(?:\d+\s+)?(C\d+)\s+(.*?)(?:\s+(\S+@\S+\.\S+))?$/
          );

          if (match) {
            const [, CardCode, BP_Name, Email] = match;

            emailData.push({
              CardCode: CardCode.trim(),
              BP_Name: BP_Name.trim(),
              Email: Email || "",
            });
          }
        }

        console.log(
          `Extracted ${emailData.length} customer records with emails`
        );
      } catch (error) {
        console.error("Error processing text file:", error);
        throw new Error(`Failed to process text file: ${error.message}`);
      }
    }

    // Filter out entries without CardCode or Email
    emailData = emailData.filter((item) => item.CardCode && item.Email);

    console.log(`Prepared ${emailData.length} email records for update`);

    // Update database - only for customers with missing emails
    const updateResults = {
      total: emailData.length,
      updated: 0,
      skipped: 0,
      notFound: 0,
      errors: [],
    };

    for (const item of emailData) {
      try {
        // Find customer by CardCode
        const customer = await Customer.findOne({ CardCode: item.CardCode });

        if (customer) {
          // Only update if the customer doesn't have an email
          if (!customer.Email || customer.Email.trim() === "") {
            customer.Email = item.Email;
            await customer.save();
            updateResults.updated++;
          } else {
            // Skip update if customer already has an email
            updateResults.skipped++;
          }
        } else {
          updateResults.notFound++;
        }
      } catch (error) {
        console.error(`Error updating customer ${item.CardCode}:`, error);
        updateResults.errors.push({
          CardCode: item.CardCode,
          error: error.message,
        });
      }
    }

    // Clean up the uploaded file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error deleting file after processing:", unlinkError);
    }

    res.status(200).json({
      success: true,
      message: `Email update complete`,
      results: updateResults,
    });
  } catch (error) {
    console.error("Email update error:", error);

    // Clean up file if it exists
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (unlinkError) {
      console.error("Error cleaning up file:", unlinkError);
    }

    res.status(500).json({
      success: false,
      message: "Error updating customer emails",
      error: error.message,
    });
  }
};

exports.bulkAssignCustomers = async (req, res) => {
  try {
    const { customerIds, agentId } = req.body;

    // Validate input
    if (
      !customerIds ||
      !Array.isArray(customerIds) ||
      customerIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid array of customer IDs",
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid agent ID",
      });
    }

    // Verify user has permission (admins and sales managers)
    if (
      req.user &&
      req.user.role !== "admin" &&
      req.user.role !== "sales_manager"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Unauthorized: Only admins and sales managers can reassign customers",
      });
    }

    // Verify the agent exists and is a sales agent
    const agent = await User.findById(agentId);
    if (!agent || agent.role !== "sales_agent") {
      return res.status(400).json({
        success: false,
        message: "Invalid sales agent ID",
      });
    }

    // Perform bulk update to assign all customers to the specified agent
    const result = await Customer.updateMany(
      { _id: { $in: customerIds } },
      { $set: { assignedTo: agentId } }
    );

    res.json({
      success: true,
      message: "Customers assigned successfully",
      count: result.modifiedCount,
      totalRequested: customerIds.length,
    });
  } catch (error) {
    console.error("Bulk customer assignment error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Controller function to remove zero-value abandoned carts
exports.removeZeroValueAbandonedCarts = async (req, res) => {
  try {
    console.log("Starting zero-value abandoned cart removal process...");
    const startTime = Date.now();

    // Step 1: Find all zero-value abandoned carts with multiple safety checks
    const zeroValueQuery = {
      $and: [
        // Must be abandoned
        { isAbandoned: true },
        { status: "abandoned" },

        // Multiple zero-value checks for safety
        { totalIncludingTaxes: { $lte: 0 } },
        { totalExcludingTaxes: { $lte: 0 } },

        // Additional safety: check that products array is empty or all products have zero total
        {
          $or: [
            { products: { $size: 0 } }, // Empty products array
            { products: { $exists: false } }, // No products field
            {
              $and: [
                { products: { $exists: true } },
                { "products.totalPrice": { $not: { $gt: 0 } } }, // No product has totalPrice > 0
              ],
            },
          ],
        },

        // Ensure not converted (additional safety)
        { status: { $ne: "converted" } },
        { convertedDate: { $exists: false } },
      ],
    };

    // Step 2: Count zero-value carts first for logging
    const zeroValueCount = await Cart.countDocuments(zeroValueQuery);
    console.log(`Found ${zeroValueCount} zero-value abandoned carts`);

    if (zeroValueCount === 0) {
      return res.status(200).json({
        success: true,
        message: "No zero-value abandoned carts found to remove",
        results: {
          totalFound: 0,
          deleted: 0,
          processingTimeMs: Date.now() - startTime,
        },
      });
    }

    // Step 3: Get sample records for verification (first 5)
    const sampleCarts = await Cart.find(zeroValueQuery)
      .select(
        "cartId customerEmail totalIncludingTaxes totalExcludingTaxes products status isAbandoned createDate"
      )
      .limit(5)
      .lean();

    console.log("Sample zero-value carts to be deleted:");
    sampleCarts.forEach((cart, index) => {
      console.log(
        `${index + 1}. CartID: ${cart.cartId}, Email: ${
          cart.customerEmail
        }, TotalInc: ${cart.totalIncludingTaxes}, TotalExc: ${
          cart.totalExcludingTaxes
        }, Products: ${cart.products?.length || 0}, Status: ${
          cart.status
        }, Abandoned: ${cart.isAbandoned}`
      );
    });

    // Step 4: Additional verification - double-check each cart
    const verificationCarts = await Cart.find(zeroValueQuery).lean();
    const safeToDelete = verificationCarts.filter((cart) => {
      // Triple-check each cart meets all criteria
      const isAbandoned =
        cart.isAbandoned === true && cart.status === "abandoned";
      const hasZeroValue =
        (cart.totalIncludingTaxes || 0) <= 0 &&
        (cart.totalExcludingTaxes || 0) <= 0;
      const hasNoProducts =
        !cart.products ||
        cart.products.length === 0 ||
        cart.products.every((product) => (product.totalPrice || 0) <= 0);
      const notConverted = cart.status !== "converted" && !cart.convertedDate;

      return isAbandoned && hasZeroValue && hasNoProducts && notConverted;
    });

    console.log(
      `Verification: ${safeToDelete.length} out of ${verificationCarts.length} carts are safe to delete`
    );

    if (safeToDelete.length !== verificationCarts.length) {
      console.warn(
        "WARNING: Some carts failed verification. Aborting deletion for safety."
      );
      return res.status(400).json({
        success: false,
        message: "Some carts failed safety verification. Deletion aborted.",
        results: {
          totalFound: verificationCarts.length,
          safeToDelete: safeToDelete.length,
          failedVerification: verificationCarts.length - safeToDelete.length,
        },
      });
    }

    // Step 5: Perform the deletion with the verified IDs
    const idsToDelete = safeToDelete.map((cart) => cart._id);

    console.log(
      `Proceeding to delete ${idsToDelete.length} verified zero-value abandoned carts...`
    );

    const deleteResult = await Cart.deleteMany({
      _id: { $in: idsToDelete },
    });

    console.log(
      `Deletion completed. Deleted ${deleteResult.deletedCount} carts.`
    );

    // Step 6: Final verification - ensure we didn't delete anything we shouldn't have
    const remainingCount = await Cart.countDocuments(zeroValueQuery);
    if (remainingCount > 0) {
      console.warn(
        `WARNING: ${remainingCount} zero-value carts still remain after deletion`
      );
    }

    const totalTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Successfully removed ${deleteResult.deletedCount} zero-value abandoned carts`,
      results: {
        totalFound: zeroValueCount,
        deleted: deleteResult.deletedCount,
        remainingZeroValueCarts: remainingCount,
        processingTimeMs: totalTime,
        sampleDeletedCarts: sampleCarts.map((cart) => ({
          cartId: cart.cartId,
          customerEmail: cart.customerEmail,
          totalValue: cart.totalIncludingTaxes,
          productsCount: cart.products?.length || 0,
        })),
      },
    });
  } catch (error) {
    console.error("Error removing zero-value abandoned carts:", error);
    res.status(500).json({
      success: false,
      message: "Error removing zero-value abandoned carts",
      error: error.message,
    });
  }
};

// Alternative function for dry-run (preview what would be deleted without actually deleting)
exports.previewZeroValueAbandonedCarts = async (req, res) => {
  try {
    console.log("Starting zero-value abandoned cart preview...");

    const zeroValueQuery = {
      $and: [
        { isAbandoned: true },
        { status: "abandoned" },
        { totalIncludingTaxes: { $lte: 0 } },
        { totalExcludingTaxes: { $lte: 0 } },
        {
          $or: [
            { products: { $size: 0 } },
            { products: { $exists: false } },
            {
              $and: [
                { products: { $exists: true } },
                { "products.totalPrice": { $not: { $gt: 0 } } },
              ],
            },
          ],
        },
        { status: { $ne: "converted" } },
        { convertedDate: { $exists: false } },
      ],
    };

    const count = await Cart.countDocuments(zeroValueQuery);

    const sampleCarts = await Cart.find(zeroValueQuery)
      .select(
        "cartId customerEmail totalIncludingTaxes totalExcludingTaxes products status isAbandoned createDate"
      )
      .limit(20)
      .sort({ createDate: -1 })
      .lean();

    res.status(200).json({
      success: true,
      message: `Found ${count} zero-value abandoned carts that would be deleted`,
      results: {
        totalCount: count,
        sampleCarts: sampleCarts.map((cart) => ({
          cartId: cart.cartId,
          customerEmail: cart.customerEmail,
          totalIncludingTaxes: cart.totalIncludingTaxes,
          totalExcludingTaxes: cart.totalExcludingTaxes,
          productsCount: cart.products?.length || 0,
          status: cart.status,
          isAbandoned: cart.isAbandoned,
          createDate: cart.createDate,
        })),
      },
    });
  } catch (error) {
    console.error("Error previewing zero-value abandoned carts:", error);
    res.status(500).json({
      success: false,
      message: "Error previewing zero-value abandoned carts",
      error: error.message,
    });
  }
};

exports.getCustomerByCardCode = async (req, res) => {
  try {
    const { cardCode } = req.params;

    if (!cardCode) {
      return res.status(400).json({
        success: false,
        message: "Card code is required",
      });
    }

    // Find customer by CardCode
    const customer = await Customer.findOne({ CardCode: cardCode }).lean();

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error("Error fetching customer by card code:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching customer",
      error: error.message,
    });
  }
};

// Remove all customers where CardCode starts with "S"
exports.removeCustomersWithSCardCode = async (req, res) => {
  try {
    console.log(
      "Starting removal of customers with CardCode starting with 'S'..."
    );
    const startTime = Date.now();

    // Step 1: Find all customers with CardCode starting with "S"
    const sCustomersQuery = {
      CardCode: { $regex: /^S\d{4}$/, $options: "i" },
    };

    // Step 2: Count customers first for logging
    const sCustomersCount = await Customer.countDocuments(sCustomersQuery);
    console.log(
      `Found ${sCustomersCount} customers with CardCode starting with 'S'`
    );

    if (sCustomersCount === 0) {
      return res.status(200).json({
        success: true,
        message: "No customers found with CardCode starting with 'S'",
        results: {
          totalFound: 0,
          deleted: 0,
          processingTimeMs: Date.now() - startTime,
        },
      });
    }

    // Step 3: Get sample records for verification (first 10)
    const sampleCustomers = await Customer.find(sCustomersQuery)
      .select("CardCode CardName Email status customerType")
      .limit(10)
      .lean();

    console.log("Sample customers with 'S' CardCode to be deleted:");
    sampleCustomers.forEach((customer, index) => {
      console.log(
        `${index + 1}. CardCode: ${customer.CardCode}, Name: ${
          customer.CardName
        }, Email: ${customer.Email}, Status: ${customer.status}, Type: ${
          customer.customerType
        }`
      );
    });

    // Step 4: Additional verification - get all customers for final check
    const allSCustomers = await Customer.find(sCustomersQuery)
      .select("CardCode CardName Email status customerType")
      .lean();

    console.log(
      `Verification: Found ${allSCustomers.length} customers to delete`
    );

    // Step 5: Perform the deletion
    console.log(
      `Proceeding to delete ${allSCustomers.length} customers with CardCode starting with 'S'...`
    );

    const deleteResult = await Customer.deleteMany(sCustomersQuery);

    console.log(
      `Deletion completed. Deleted ${deleteResult.deletedCount} customers.`
    );

    // Step 6: Final verification - ensure deletion was successful
    const remainingCount = await Customer.countDocuments(sCustomersQuery);
    if (remainingCount > 0) {
      console.warn(
        `WARNING: ${remainingCount} customers with 'S' CardCode still remain after deletion`
      );
    }

    const totalTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Successfully removed ${deleteResult.deletedCount} customers with CardCode starting with 'S'`,
      results: {
        totalFound: sCustomersCount,
        deleted: deleteResult.deletedCount,
        remainingCustomers: remainingCount,
        processingTimeMs: totalTime,
        sampleDeletedCustomers: sampleCustomers.map((customer) => ({
          CardCode: customer.CardCode,
          CardName: customer.CardName,
          Email: customer.Email,
          status: customer.status,
          customerType: customer.customerType,
        })),
      },
    });
  } catch (error) {
    console.error("Error removing customers with 'S' CardCode:", error);
    res.status(500).json({
      success: false,
      message: "Error removing customers with CardCode starting with 'S'",
      error: error.message,
    });
  }
};

// Alternative function for dry-run (preview what would be deleted without actually deleting)
exports.previewCustomersWithSCardCode = async (req, res) => {
  try {
    console.log(
      "Starting preview of customers with CardCode starting with 'S'..."
    );

    const sCustomersQuery = {
      CardCode: { $regex: /^S\d{4}$/, $options: "i" },
    };

    const count = await Customer.countDocuments(sCustomersQuery);

    const sampleCustomers = await Customer.find(sCustomersQuery)
      .select("CardCode CardName Email status customerType createdAt")
      .limit(20)
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      message: `Found ${count} customers with CardCode starting with 'S' that would be deleted`,
      results: {
        totalCount: count,
        sampleCustomers: sampleCustomers.map((customer) => ({
          CardCode: customer.CardCode,
          CardName: customer.CardName,
          Email: customer.Email,
          status: customer.status,
          customerType: customer.customerType,
          createdAt: customer.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("Error previewing customers with 'S' CardCode:", error);
    res.status(500).json({
      success: false,
      message: "Error previewing customers with CardCode starting with 'S'",
      error: error.message,
    });
  }
};
