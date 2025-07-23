// // utils/sapB1CustomerIntegration.js
// const axios = require("axios");
// const dotenv = require("dotenv");

// // Load environment variables
// dotenv.config();

// // SAP B1 Service Layer Configuration
// const SAP_CONFIG = {
//   serviceLayerUrl: process.env.SAP_SERVICE_LAYER_URL,
//   companyDB: process.env.COMPANY_DB,
//   username: process.env.USER_NAME,
//   password: process.env.PASSWORD,
// };

// // Set this to true to enable automatic SAP sync
// const ENABLE_SAP_SYNC = true;

// // Session management (reuse from your existing SAP integration)
// let sessionId = null;
// let sessionTimeout = null;

// // Login to SAP B1 Service Layer and get session ID
// async function loginToSAP() {
//   try {
//     console.log("Logging in to SAP B1 Service Layer...");

//     // Clear any existing session timeout
//     if (sessionTimeout) {
//       clearTimeout(sessionTimeout);
//     }

//     const loginData = {
//       CompanyDB: SAP_CONFIG.companyDB,
//       UserName: SAP_CONFIG.username,
//       Password: SAP_CONFIG.password,
//     };

//     const response = await axios.post(
//       `${SAP_CONFIG.serviceLayerUrl}/Login`,
//       loginData,
//       {
//         headers: {
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     // Extract session ID from cookies
//     const cookies = response.headers["set-cookie"];
//     if (!cookies) {
//       throw new Error("No cookies returned from SAP B1 login");
//     }

//     // Parse session ID from cookies
//     const sessionCookie = cookies.find((cookie) =>
//       cookie.includes("B1SESSION=")
//     );
//     if (!sessionCookie) {
//       throw new Error("B1SESSION cookie not found");
//     }

//     sessionId = sessionCookie.split(";")[0].replace("B1SESSION=", "");

//     // Set session timeout (25 minutes)
//     sessionTimeout = setTimeout(() => {
//       sessionId = null;
//     }, 25 * 60 * 1000);

//     console.log("Successfully logged in to SAP B1 Service Layer");
//     return sessionId;
//   } catch (error) {
//     console.error("Error logging in to SAP B1:", error.message);
//     if (error.response) {
//       console.error("SAP Error details:", error.response.data);
//     }
//     throw new Error(`SAP Login Error: ${error.message}`);
//   }
// }

// // Get a valid session ID (login if necessary)
// async function getSessionId() {
//   if (!sessionId) {
//     return await loginToSAP();
//   }
//   return sessionId;
// }

// // Get the last customer from SAP B1
// exports.getLastCustomerFromSAP = async () => {
//   try {
//     const sessionId = await getSessionId();

//     console.log("Fetching last customer from SAP B1...");

//     const response = await axios.get(
//       `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners?$top=1&$orderby=CardCode desc&$filter=CardType eq 'cCustomer'`,
//       {
//         headers: {
//           "Content-Type": "application/json",
//           Cookie: `B1SESSION=${sessionId}`,
//         },
//       }
//     );

//     if (
//       response.data &&
//       response.data.value &&
//       response.data.value.length > 0
//     ) {
//       const lastCustomer = response.data.value[0];
//       console.log(`Last customer CardCode: ${lastCustomer.CardCode}`);
//       return lastCustomer;
//     }

//     console.log("No customers found in SAP B1");
//     return null;
//   } catch (error) {
//     // If unauthorized, try to login again and retry once
//     if (error.response && error.response.status === 401) {
//       console.log("Session expired, attempting to login again...");
//       sessionId = null;
//       await getSessionId();
//       return exports.getLastCustomerFromSAP();
//     }

//     console.error("Error fetching last customer from SAP:", error.message);
//     throw new Error(`SAP Error: ${error.message}`);
//   }
// };

// // Generate next CardCode based on last customer
// exports.generateNextCardCode = async () => {
//   try {
//     const sessionId = await getSessionId();

//     console.log("Fetching last customer in C6xxx range from SAP B1...");

//     // Modified query to filter for C6xxx customers only
//     const response = await axios.get(
//       `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners?$top=1&$orderby=CardCode desc&$filter=CardType eq 'cCustomer' and startswith(CardCode,'C6')`,
//       {
//         headers: {
//           "Content-Type": "application/json",
//           Cookie: `B1SESSION=${sessionId}`,
//         },
//       }
//     );

//     if (
//       response.data &&
//       response.data.value &&
//       response.data.value.length > 0
//     ) {
//       const lastCustomer = response.data.value[0];
//       console.log(`Last C6xxx customer CardCode: ${lastCustomer.CardCode}`);

//       const lastCardCode = lastCustomer.CardCode;

//       // Extract numeric part from CardCode (e.g., C6001 -> 6001)
//       const match = lastCardCode.match(/^C(\d+)$/);

//       if (match) {
//         const lastNumber = parseInt(match[1], 10);
//         const nextNumber = lastNumber + 1;
//         const nextCardCode = `C${nextNumber}`;

//         console.log(`Generated next CardCode: ${nextCardCode}`);
//         return nextCardCode;
//       }
//     }

//     // If no C6xxx customers found, start with C6001
//     console.log("No C6xxx customers found, starting with C6001");
//     return "C6001";
//   } catch (error) {
//     // If unauthorized, try to login again and retry once
//     if (error.response && error.response.status === 401) {
//       console.log("Session expired, attempting to login again...");
//       sessionId = null;
//       await getSessionId();
//       return exports.generateNextCardCode();
//     }

//     console.error("Error generating next CardCode:", error);
//     // Fallback to a default CardCode in C6xxx range
//     return "C6001";
//   }
// };

// // Format customer data for SAP B1
// // Format customer data for SAP B1
// exports.formatCustomerForSAP = async (customer) => {
//   const sapCustomer = {
//     CardCode: customer.CardCode || "", // Use existing CardCode or generate a new one
//     CardName: customer.CardName,
//     CardType: "cCustomer",

//     // Contact Information
//     EmailAddress: customer.Email,
//     Phone1: customer.phoneNumber || "",

//     // Default SAP values (you can customize these)
//     GroupCode: 110,
//     Currency: "EUR", // Euro currency as requested
//     PayTermsGrpCode: -1, // Default payment terms - adjust as needed
//     PriceListNum: 2,

//     // Additional phone numbers
//     Phone2:
//       customer.additionalPhoneNumbers &&
//       customer.additionalPhoneNumbers.length > 0
//         ? customer.additionalPhoneNumbers[0]
//         : "",

//     // Notes
//     Notes: customer.notes || "",

//     // Status
//     Valid: customer.status === "active" ? "tYES" : "tNO",
//     Frozen: customer.status === "inactive" ? "tYES" : "tNO",
//   };

//   // Add contact persons if we have detailed contact info
//   if (customer.firstName || customer.lastName) {
//     sapCustomer.ContactEmployees = [
//       {
//         Name: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
//         Phone1: customer.phoneNumber || "",
//         E_Mail: customer.Email || "",
//         Active: "tYES",
//       },
//     ];
//   }

//   // Add addresses array if address exists
//   if (customer.address) {
//     sapCustomer.BPAddresses = [
//       {
//         AddressName: "Bill To",
//         AddressType: "bo_BillTo",
//         Street: customer.address.street || "",
//         ZipCode: customer.address.zipCode || "",
//         City: customer.address.city || "",
//         Country: "FR",
//       },
//       {
//         AddressName: "Ship To",
//         AddressType: "bo_ShipTo",
//         Street: customer.address.street || "",
//         ZipCode: customer.address.zipCode || "",
//         City: customer.address.city || "",
//         Country: "FR",
//       },
//     ];
//   }

//   console.log("Formatted customer for SAP:", {
//     CardCode: sapCustomer.CardCode,
//     CardName: sapCustomer.CardName,
//     EmailAddress: sapCustomer.EmailAddress,
//     GroupCode: sapCustomer.GroupCode,
//     Currency: sapCustomer.Currency,
//   });

//   return sapCustomer;
// };
// // Create a customer in SAP B1
// exports.createCustomerInSAP = async (customerData) => {
//   try {
//     // Skip SAP sync if disabled
//     if (!ENABLE_SAP_SYNC) {
//       console.log("SAP sync is disabled. Skipping customer creation in SAP.");
//       return {
//         simulated: true,
//         message: "SAP sync is disabled",
//         CardCode: customerData.CardCode,
//       };
//     }

//     const sessionId = await getSessionId();

//     console.log("Creating customer in SAP B1...");

//     const response = await axios.post(
//       `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners`,
//       customerData,
//       {
//         headers: {
//           "Content-Type": "application/json",
//           Cookie: `B1SESSION=${sessionId}`,
//         },
//       }
//     );

//     console.log("Customer created successfully in SAP B1");
//     return response.data;
//   } catch (error) {
//     console.error("Error creating customer in SAP B1:", error.message);
//     if (error.response) {
//       console.error("SAP Error details:", error.response.data);

//       // Log detailed error information
//       if (
//         error.response.data &&
//         error.response.data.error &&
//         error.response.data.error.message
//       ) {
//         console.error(
//           "Error field details:",
//           error.response.data.error.message.value
//         );
//       }
//     }

//     // If unauthorized, try to login again and retry once
//     if (error.response && error.response.status === 401) {
//       console.log("Session expired, attempting to login again...");
//       sessionId = null;
//       await getSessionId();
//       return exports.createCustomerInSAP(customerData);
//     }

//     throw new Error(`SAP Error: ${error.message}`);
//   }
// };

// // Check if a customer exists in SAP
// exports.checkCustomerExistsInSAP = async (cardCode) => {
//   try {
//     const sessionId = await getSessionId();

//     console.log(`Checking if customer ${cardCode} exists in SAP...`);

//     const response = await axios.get(
//       `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners('${cardCode}')`,
//       {
//         headers: {
//           "Content-Type": "application/json",
//           Cookie: `B1SESSION=${sessionId}`,
//         },
//       }
//     );

//     console.log(`Customer ${cardCode} exists in SAP`);
//     return true;
//   } catch (error) {
//     if (error.response && error.response.status === 404) {
//       console.log(`Customer ${cardCode} does not exist in SAP`);
//       return false;
//     }

//     // If unauthorized, try to login again and retry once
//     if (error.response && error.response.status === 401) {
//       console.log("Session expired, attempting to login again...");
//       sessionId = null;
//       await getSessionId();
//       return exports.checkCustomerExistsInSAP(cardCode);
//     }

//     console.error("Error checking customer in SAP:", error.message);
//     throw new Error(`SAP Error: ${error.message}`);
//   }
// };
// utils/sapB1CustomerIntegration.js
const axios = require("axios");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// SAP B1 Service Layer Configuration
const SAP_CONFIG = {
  serviceLayerUrl: process.env.SAP_SERVICE_LAYER_URL,
  companyDB: process.env.COMPANY_DB,
  username: process.env.USER_NAME,
  password: process.env.PASSWORD,
};

// Set this to true to enable automatic SAP sync
const ENABLE_SAP_SYNC = true;

// Session management (reuse from your existing SAP integration)
let sessionId = null;
let sessionTimeout = null;

// Cache for valid group codes
let validGroupCodes = null;

// Login to SAP B1 Service Layer and get session ID
async function loginToSAP() {
  try {
    console.log("Logging in to SAP B1 Service Layer...");

    // Clear any existing session timeout
    if (sessionTimeout) {
      clearTimeout(sessionTimeout);
    }

    const loginData = {
      CompanyDB: SAP_CONFIG.companyDB,
      UserName: SAP_CONFIG.username,
      Password: SAP_CONFIG.password,
    };

    const response = await axios.post(
      `${SAP_CONFIG.serviceLayerUrl}/Login`,
      loginData,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Extract session ID from cookies
    const cookies = response.headers["set-cookie"];
    if (!cookies) {
      throw new Error("No cookies returned from SAP B1 login");
    }

    // Parse session ID from cookies
    const sessionCookie = cookies.find((cookie) =>
      cookie.includes("B1SESSION=")
    );
    if (!sessionCookie) {
      throw new Error("B1SESSION cookie not found");
    }

    sessionId = sessionCookie.split(";")[0].replace("B1SESSION=", "");

    // Set session timeout (25 minutes)
    sessionTimeout = setTimeout(() => {
      sessionId = null;
    }, 25 * 60 * 1000);

    console.log("Successfully logged in to SAP B1 Service Layer");
    return sessionId;
  } catch (error) {
    console.error("Error logging in to SAP B1:", error.message);
    if (error.response) {
      console.error("SAP Error details:", error.response.data);
    }
    throw new Error(`SAP Login Error: ${error.message}`);
  }
}

// Get a valid session ID (login if necessary)
async function getSessionId() {
  if (!sessionId) {
    return await loginToSAP();
  }
  return sessionId;
}

// Get valid customer group codes from SAP
exports.getValidGroupCodes = async () => {
  try {
    // Return cached group codes if available
    if (validGroupCodes) {
      return validGroupCodes;
    }

    const sessionId = await getSessionId();

    console.log("Fetching valid customer group codes from SAP B1...");

    const response = await axios.get(
      `${SAP_CONFIG.serviceLayerUrl}/BusinessPartnerGroups`,
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: `B1SESSION=${sessionId}`,
        },
      }
    );

    if (response.data && response.data.value) {
      validGroupCodes = response.data.value;
      console.log(`Found ${validGroupCodes.length} valid group codes:`);
      validGroupCodes.forEach((group) => {
        console.log(`  - Code: ${group.Code}, Name: ${group.Name}`);
      });
      return validGroupCodes;
    }

    console.log("No group codes found in SAP B1");
    return [];
  } catch (error) {
    // If unauthorized, try to login again and retry once
    if (error.response && error.response.status === 401) {
      console.log("Session expired, attempting to login again...");
      sessionId = null;
      await getSessionId();
      return exports.getValidGroupCodes();
    }

    console.error("Error fetching group codes from SAP:", error.message);
    throw new Error(`SAP Error: ${error.message}`);
  }
};

// Get the first valid group code (fallback)
exports.getDefaultGroupCode = async () => {
  try {
    const groupCodes = await exports.getValidGroupCodes();

    if (groupCodes && groupCodes.length > 0) {
      const defaultGroup = groupCodes[0];
      console.log(
        `Using default group code: ${defaultGroup.Code} (${defaultGroup.Name})`
      );
      return defaultGroup.Code;
    }

    console.log("No valid group codes found, using fallback");
    return 100; // Common fallback
  } catch (error) {
    console.error("Error getting default group code:", error.message);
    return 100; // Ultimate fallback
  }
};

// Get the last customer from SAP B1
exports.getLastCustomerFromSAP = async () => {
  try {
    const sessionId = await getSessionId();

    console.log("Fetching last customer from SAP B1...");

    const response = await axios.get(
      `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners?$top=1&$orderby=CardCode desc&$filter=CardType eq 'cCustomer'`,
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: `B1SESSION=${sessionId}`,
        },
      }
    );

    if (
      response.data &&
      response.data.value &&
      response.data.value.length > 0
    ) {
      const lastCustomer = response.data.value[0];
      console.log(`Last customer CardCode: ${lastCustomer.CardCode}`);
      return lastCustomer;
    }

    console.log("No customers found in SAP B1");
    return null;
  } catch (error) {
    // If unauthorized, try to login again and retry once
    if (error.response && error.response.status === 401) {
      console.log("Session expired, attempting to login again...");
      sessionId = null;
      await getSessionId();
      return exports.getLastCustomerFromSAP();
    }

    console.error("Error fetching last customer from SAP:", error.message);
    throw new Error(`SAP Error: ${error.message}`);
  }
};

// Generate next CardCode based on last customer - MODIFIED FOR C001 FORMAT
exports.generateNextCardCode = async () => {
  try {
    const sessionId = await getSessionId();

    console.log("Fetching last customer with C prefix from SAP B1...");

    // Modified query to filter for customers starting with 'C' followed by digits
    const response = await axios.get(
      `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners?$top=50&$orderby=CardCode desc&$filter=CardType eq 'cCustomer' and startswith(CardCode,'C')`,
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: `B1SESSION=${sessionId}`,
        },
      }
    );

    if (
      response.data &&
      response.data.value &&
      response.data.value.length > 0
    ) {
      // Find the highest numbered C customer
      let highestNumber = 0;
      let highestCardCode = null;

      for (const customer of response.data.value) {
        const cardCode = customer.CardCode;
        // Match pattern C followed by digits (C001, C002, etc.)
        const match = cardCode.match(/^C(\d+)$/);

        if (match) {
          const number = parseInt(match[1], 10);
          if (number > highestNumber) {
            highestNumber = number;
            highestCardCode = cardCode;
          }
        }
      }

      if (highestCardCode) {
        console.log(`Last C customer CardCode: ${highestCardCode}`);
        const nextNumber = highestNumber + 1;
        // Format with leading zeros to maintain 3-digit format (C001, C002, etc.)
        const nextCardCode = `C${nextNumber.toString().padStart(3, "0")}`;

        console.log(`Generated next CardCode: ${nextCardCode}`);
        return nextCardCode;
      }
    }

    // If no C customers found, start with C001
    console.log("No C customers found, starting with C001");
    return "C001";
  } catch (error) {
    // If unauthorized, try to login again and retry once
    if (error.response && error.response.status === 401) {
      console.log("Session expired, attempting to login again...");
      sessionId = null;
      await getSessionId();
      return exports.generateNextCardCode();
    }

    console.error("Error generating next CardCode:", error);
    // Fallback to a default CardCode
    return "C001";
  }
};

// Format customer data for SAP B1
exports.formatCustomerForSAP = async (customer) => {
  // Get a valid group code
  const groupCode = await exports.getDefaultGroupCode();

  const sapCustomer = {
    CardCode: customer.CardCode || "", // Use existing CardCode or generate a new one
    CardName: customer.CardName,
    CardType: "cCustomer",

    // Contact Information
    EmailAddress: customer.Email,
    Phone1: customer.phoneNumber || "",

    // Updated to use valid group code
    GroupCode: groupCode,
    Currency: "EUR", // Euro currency as requested
    PayTermsGrpCode: -1, // Default payment terms - adjust as needed
    PriceListNum: 2,

    // Additional phone numbers
    Phone2:
      customer.additionalPhoneNumbers &&
      customer.additionalPhoneNumbers.length > 0
        ? customer.additionalPhoneNumbers[0]
        : "",

    // Notes
    Notes: customer.notes || "",

    // Status
    Valid: customer.status === "active" ? "tYES" : "tNO",
    Frozen: customer.status === "inactive" ? "tYES" : "tNO",
  };

  // Add contact persons if we have detailed contact info
  if (customer.firstName || customer.lastName) {
    sapCustomer.ContactEmployees = [
      {
        Name: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
        Phone1: customer.phoneNumber || "",
        E_Mail: customer.Email || "",
        Active: "tYES",
      },
    ];
  }

  // Add addresses array if address exists
  if (customer.address) {
    sapCustomer.BPAddresses = [
      {
        AddressName: "Bill To",
        AddressType: "bo_BillTo",
        Street: customer.address.street || "",
        ZipCode: customer.address.zipCode || "",
        City: customer.address.city || "",
        Country: "FR",
      },
      {
        AddressName: "Ship To",
        AddressType: "bo_ShipTo",
        Street: customer.address.street || "",
        ZipCode: customer.address.zipCode || "",
        City: customer.address.city || "",
        Country: "FR",
      },
    ];
  }

  console.log("Formatted customer for SAP:", {
    CardCode: sapCustomer.CardCode,
    CardName: sapCustomer.CardName,
    EmailAddress: sapCustomer.EmailAddress,
    GroupCode: sapCustomer.GroupCode,
    Currency: sapCustomer.Currency,
  });

  return sapCustomer;
};

// Create a customer in SAP B1
exports.createCustomerInSAP = async (customerData) => {
  try {
    // Skip SAP sync if disabled
    if (!ENABLE_SAP_SYNC) {
      console.log("SAP sync is disabled. Skipping customer creation in SAP.");
      return {
        simulated: true,
        message: "SAP sync is disabled",
        CardCode: customerData.CardCode,
      };
    }

    const sessionId = await getSessionId();

    console.log("Creating customer in SAP B1...");

    const response = await axios.post(
      `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners`,
      customerData,
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: `B1SESSION=${sessionId}`,
        },
      }
    );

    console.log("Customer created successfully in SAP B1");
    return response.data;
  } catch (error) {
    console.error("Error creating customer in SAP B1:", error.message);
    if (error.response) {
      console.error("SAP Error details:", error.response.data);

      // Log detailed error information
      if (
        error.response.data &&
        error.response.data.error &&
        error.response.data.error.message
      ) {
        console.error(
          "Error field details:",
          error.response.data.error.message.value
        );
      }
    }

    // If unauthorized, try to login again and retry once
    if (error.response && error.response.status === 401) {
      console.log("Session expired, attempting to login again...");
      sessionId = null;
      await getSessionId();
      return exports.createCustomerInSAP(customerData);
    }

    throw new Error(`SAP Error: ${error.message}`);
  }
};

// Check if a customer exists in SAP
exports.checkCustomerExistsInSAP = async (cardCode) => {
  try {
    const sessionId = await getSessionId();

    console.log(`Checking if customer ${cardCode} exists in SAP...`);

    const response = await axios.get(
      `${SAP_CONFIG.serviceLayerUrl}/BusinessPartners('${cardCode}')`,
      {
        headers: {
          "Content-Type": "application/json",
          Cookie: `B1SESSION=${sessionId}`,
        },
      }
    );

    console.log(`Customer ${cardCode} exists in SAP`);
    return true;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`Customer ${cardCode} does not exist in SAP`);
      return false;
    }

    // If unauthorized, try to login again and retry once
    if (error.response && error.response.status === 401) {
      console.log("Session expired, attempting to login again...");
      sessionId = null;
      await getSessionId();
      return exports.checkCustomerExistsInSAP(cardCode);
    }

    console.error("Error checking customer in SAP:", error.message);
    throw new Error(`SAP Error: ${error.message}`);
  }
};

// Utility function to test and display all valid group codes
exports.testGroupCodes = async () => {
  try {
    console.log("Testing group codes...");
    const groupCodes = await exports.getValidGroupCodes();

    console.log("\n=== VALID GROUP CODES ===");
    if (groupCodes && groupCodes.length > 0) {
      groupCodes.forEach((group, index) => {
        console.log(`${index + 1}. Code: ${group.Code}, Name: ${group.Name}`);
      });
    } else {
      console.log("No group codes found!");
    }
    console.log("========================\n");

    return groupCodes;
  } catch (error) {
    console.error("Error testing group codes:", error.message);
    return [];
  }
};
