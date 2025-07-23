// utils/data-formatter.js - Utility for formatting HubSpot agent data
/**
 * Format agent data from Excel import for MongoDB storage
 *
 * @param {Object} data - Raw agent data from Excel
 * @returns {Object} - Formatted agent data
 */
function formatAgentData(data) {
  const formattedData = { ...data };

  // Format date fields
  ["lastLogin", "lastActive", "createdAt"].forEach((dateField) => {
    if (formattedData[dateField]) {
      if (!(formattedData[dateField] instanceof Date)) {
        // Try to parse various date formats
        const parsedDate = parseDate(formattedData[dateField]);
        formattedData[dateField] = parsedDate || null;
      }
    } else {
      formattedData[dateField] = null;
    }
  });

  // Ensure createdAt is set (required field)
  if (!formattedData.createdAt) {
    formattedData.createdAt = new Date();
  }

  // Format boolean fields
  ["deactivated", "paidSeat", "twoFactorAuthenticationEnabled"].forEach(
    (boolField) => {
      if (formattedData[boolField] !== undefined) {
        formattedData[boolField] = formatBoolean(formattedData[boolField]);
      }
    }
  );

  // Format array fields
  if (formattedData.additionalTeams) {
    formattedData.additionalTeams = formatArray(formattedData.additionalTeams);
  } else {
    formattedData.additionalTeams = [];
  }

  if (formattedData.permissions) {
    formattedData.permissions = formatArray(formattedData.permissions);
  } else {
    formattedData.permissions = [];
  }

  // Ensure string fields are trimmed
  [
    "userId",
    "firstName",
    "lastName",
    "email",
    "primaryTeam",
    "permissionSet",
  ].forEach((stringField) => {
    if (formattedData[stringField]) {
      formattedData[stringField] = formattedData[stringField].toString().trim();
    }
  });

  return formattedData;
}

/**
 * Parse a date string into a Date object
 * Handles various date formats
 *
 * @param {string|Date} dateValue - Date value to parse
 * @returns {Date|null} - Parsed Date object or null if invalid
 */
function parseDate(dateValue) {
  if (!dateValue) return null;
  if (dateValue instanceof Date) return dateValue;

  // If it's already a number or numeric string representing a timestamp
  if (!isNaN(dateValue)) {
    // Check if it's seconds (10 digits) or milliseconds (13 digits)
    const timestamp = parseInt(dateValue, 10);
    if (timestamp > 1000000000 && timestamp < 10000000000) {
      // Seconds timestamp - convert to milliseconds
      return new Date(timestamp * 1000);
    } else if (timestamp > 1000000000000 && timestamp < 10000000000000) {
      // Milliseconds timestamp
      return new Date(timestamp);
    }
  }

  // Try to parse as a date string
  const date = new Date(dateValue);

  // Check if the date is valid
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try to parse common formats
  // Format: MM/DD/YYYY
  const usDatePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const usDateTimePattern =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

  // Format: YYYY-MM-DD
  const isoDatePattern = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const isoDateTimePattern =
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;

  let match;

  if ((match = usDatePattern.exec(dateValue))) {
    return new Date(
      parseInt(match[3], 10),
      parseInt(match[1], 10) - 1,
      parseInt(match[2], 10)
    );
  } else if ((match = usDateTimePattern.exec(dateValue))) {
    return new Date(
      parseInt(match[3], 10),
      parseInt(match[1], 10) - 1,
      parseInt(match[2], 10),
      parseInt(match[4], 10),
      parseInt(match[5], 10),
      match[6] ? parseInt(match[6], 10) : 0
    );
  } else if ((match = isoDatePattern.exec(dateValue))) {
    return new Date(
      parseInt(match[1], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[3], 10)
    );
  } else if ((match = isoDateTimePattern.exec(dateValue))) {
    return new Date(
      parseInt(match[1], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[3], 10),
      parseInt(match[4], 10),
      parseInt(match[5], 10),
      match[6] ? parseInt(match[6], 10) : 0
    );
  }

  return null;
}

/**
 * Format a value as a boolean
 *
 * @param {any} value - Value to format as boolean
 * @returns {boolean} - Formatted boolean
 */
function formatBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowercasedValue = value.toLowerCase().trim();
    return (
      lowercasedValue === "true" ||
      lowercasedValue === "yes" ||
      lowercasedValue === "y" ||
      lowercasedValue === "1" ||
      lowercasedValue === "enabled" ||
      lowercasedValue === "active"
    );
  }
  return false;
}

/**
 * Format a value as an array
 *
 * @param {any} value - Value to format as array
 * @returns {Array} - Formatted array
 */
function formatArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    // Split by commas, semicolons, or newlines
    return value
      .split(/[,;\n]/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

/**
 * Format a HubSpot permission set
 * Map common permission set names to standard values
 *
 * @param {string} permissionSet - Raw permission set value
 * @returns {string} - Standardized permission set
 */
function standardizePermissionSet(permissionSet) {
  if (!permissionSet) return "";

  const permissionSetMap = {
    admin: "Admin",
    administrator: "Admin",
    "super admin": "Super Admin",
    superadmin: "Super Admin",
    sales: "Sales",
    "sales rep": "Sales",
    salesperson: "Sales",
    marketing: "Marketing",
    service: "Service",
    "customer service": "Service",
    support: "Service",
    "read only": "Read Only",
    readonly: "Read Only",
    viewer: "Read Only",
    standard: "Standard",
    regular: "Standard",
    default: "Standard",
  };

  const normalizedValue = permissionSet.toLowerCase().trim();
  return permissionSetMap[normalizedValue] || permissionSet.trim();
}

/**
 * Format a HubSpot team name
 * Standardize team names to consistent format
 *
 * @param {string} team - Raw team name
 * @returns {string} - Standardized team name
 */
function standardizeTeamName(team) {
  if (!team) return "";

  // Remove special characters except spaces, letters, and numbers
  let cleanedTeam = team.replace(/[^a-zA-Z0-9\s]/g, " ").trim();

  // Replace multiple spaces with a single space
  cleanedTeam = cleanedTeam.replace(/\s+/g, " ");

  // Capitalize first letter of each word
  return cleanedTeam.replace(/\b\w/g, (char) => char.toUpperCase());
}

module.exports = {
  formatAgentData,
  parseDate,
  formatBoolean,
  formatArray,
  standardizePermissionSet,
  standardizeTeamName,
};
