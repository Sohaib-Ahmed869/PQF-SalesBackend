// utils/excelReader.js
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");

/**
 * Read data from an Excel file
 * @param {string} filePath - Path to the Excel file
 * @param {string} sheetName - Optional sheet name (uses first sheet if not provided)
 * @returns {Array} Array of objects representing the rows in the Excel file
 */
function readExcelFile(filePath, sheetName = null) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Read the workbook
    const workbook = xlsx.readFile(filePath);

    // Determine which sheet to use
    const sheet = sheetName
      ? workbook.Sheets[sheetName]
      : workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet) {
      throw new Error(
        `Sheet "${sheetName || workbook.SheetNames[0]}" not found in workbook`
      );
    }

    // Convert to JSON with options
    const data = xlsx.utils.sheet_to_json(sheet, {
      raw: false,
      defval: "",
      blankrows: false,
    });

    return data;
  } catch (error) {
    console.error("Error reading Excel file:", error);
    throw error;
  }
}

module.exports = {
  readExcelFile,
};
