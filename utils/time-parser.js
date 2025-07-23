// utils/time-parser.js - Utility for parsing DeskTime time formats

/**
 * Parse a single time string to hours and minutes
 * Handles formats like:
 * - "9:00 AM" (12-hour format)
 * - "14:30" (24-hour format)
 * - "6:56:25" (hours:minutes:seconds format)
 *
 * @param {string} timeStr - Time string to parse
 * @returns {Object|null} - Object with hours and minutes properties or null if invalid
 */
function parseSingleTime(timeStr) {
  if (!timeStr) return null;

  // Trim whitespace and standardize
  timeStr = timeStr.trim();

  // Handle 12-hour format with AM/PM
  const twelveHourMatch = timeStr.match(/(\d+):?(\d*)?\s*(am|pm)/i);
  if (twelveHourMatch) {
    let hours = parseInt(twelveHourMatch[1], 10);
    const minutes = twelveHourMatch[2] ? parseInt(twelveHourMatch[2], 10) : 0;
    const period = twelveHourMatch[3].toLowerCase();

    // Adjust hours for PM
    if (period === "pm" && hours < 12) {
      hours += 12;
    }
    // Adjust 12 AM to 0 hours
    if (period === "am" && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  // Handle HH:MM:SS format (e.g., "6:56:25")
  const timeWithSecondsMatch = timeStr.match(/(\d+):(\d+):(\d+)/);
  if (timeWithSecondsMatch) {
    const hours = parseInt(timeWithSecondsMatch[1], 10);
    const minutes = parseInt(timeWithSecondsMatch[2], 10);
    const seconds = parseInt(timeWithSecondsMatch[3], 10);

    // Convert seconds to fractional minutes
    const totalMinutes = minutes + seconds / 60;

    return { hours, minutes: totalMinutes };
  }

  // Handle 24-hour format (HH:MM)
  const twentyFourHourMatch = timeStr.match(/(\d+):(\d+)/);
  if (twentyFourHourMatch) {
    const hours = parseInt(twentyFourHourMatch[1], 10);
    const minutes = parseInt(twentyFourHourMatch[2], 10);
    return { hours, minutes };
  }

  return null;
}

/**
 * Parse time range string to start and end Date objects
 * Handles formats like "9:00 AM - 5:30 PM"
 *
 * @param {string} timeRangeStr - Time range string to parse
 * @param {Date} baseDate - Base date to use (defaults to today)
 * @returns {Object} - Object with start and end properties as Date objects
 */
function parseTimeRange(timeRangeStr, baseDate = new Date()) {
  if (!timeRangeStr) {
    return { start: null, end: null };
  }

  const parts = timeRangeStr.split("-").map((part) => part.trim());
  if (parts.length !== 2) {
    return { start: null, end: null };
  }

  const startTime = parts[0];
  const endTime = parts[1];

  const startDate = new Date(baseDate);
  const endDate = new Date(baseDate);

  // Parse start time
  const startParts = parseSingleTime(startTime);
  if (startParts) {
    startDate.setHours(startParts.hours);
    startDate.setMinutes(startParts.minutes);
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);
  } else {
    return { start: null, end: null };
  }

  // Parse end time
  const endParts = parseSingleTime(endTime);
  if (endParts) {
    endDate.setHours(endParts.hours);
    endDate.setMinutes(endParts.minutes);
    endDate.setSeconds(0);
    endDate.setMilliseconds(0);
  } else {
    return { start: null, end: null };
  }

  return { start: startDate, end: endDate };
}

/**
 * Calculate time difference in hours between two time strings
 *
 * @param {string} startTimeStr - Start time string
 * @param {string} endTimeStr - End time string
 * @param {Date} baseDate - Base date to use (defaults to today)
 * @returns {number} - Difference in hours (decimal)
 */
function calculateTimeDifference(
  startTimeStr,
  endTimeStr,
  baseDate = new Date()
) {
  const start = parseSingleTime(startTimeStr);
  const end = parseSingleTime(endTimeStr);

  if (!start || !end) return 0;

  const startDate = new Date(baseDate);
  startDate.setHours(start.hours, start.minutes, 0, 0);

  const endDate = new Date(baseDate);
  endDate.setHours(end.hours, end.minutes, 0, 0);

  // Handle end time being on the next day
  if (endDate < startDate) {
    endDate.setDate(endDate.getDate() + 1);
  }

  // Calculate difference in milliseconds and convert to hours
  const diffMs = endDate - startDate;
  return diffMs / (1000 * 60 * 60);
}

/**
 * Parse time string to hours
 * Handles formats like:
 * - "2h 30m", "45m", "3h", etc.
 * - "6:56:25" (hours:minutes:seconds)
 * - "9:00 AM - 5:30 PM" (time range)
 *
 * @param {string} timeStr - Time string to parse
 * @returns {number} - Time in hours (decimal)
 */
function parseTimeToHours(timeStr) {
  if (!timeStr) return 0;

  // Convert string to lowercase and trim whitespace
  timeStr = timeStr.toLowerCase().trim();

  // Check if this is a time with hours, minutes, and seconds format (e.g., "6:56:25")
  const timeWithSecondsMatch = timeStr.match(/(\d+):(\d+):(\d+)/);
  if (timeWithSecondsMatch) {
    const hours = parseInt(timeWithSecondsMatch[1], 10);
    const minutes = parseInt(timeWithSecondsMatch[2], 10);
    const seconds = parseInt(timeWithSecondsMatch[3], 10);

    return hours + minutes / 60 + seconds / 3600;
  }

  // Check if this is a 24-hour format (e.g., "14:30")
  const twentyFourHourMatch = timeStr.match(/^(\d+):(\d+)$/);
  if (twentyFourHourMatch) {
    const hours = parseInt(twentyFourHourMatch[1], 10);
    const minutes = parseInt(twentyFourHourMatch[2], 10);

    return hours + minutes / 60;
  }

  // Handle hours and minutes format (e.g., "2h 30m")
  let hours = 0;

  // Match hours pattern (e.g., "2h" in "2h 30m")
  const hoursMatch = timeStr.match(/(\d+)\s*h/);
  if (hoursMatch && hoursMatch[1]) {
    hours += parseInt(hoursMatch[1], 10);
  }

  // Match minutes pattern (e.g., "30m" in "2h 30m")
  const minutesMatch = timeStr.match(/(\d+)\s*m/);
  if (minutesMatch && minutesMatch[1]) {
    hours += parseInt(minutesMatch[1], 10) / 60;
  }

  return hours;
}

module.exports = {
  parseTimeToHours,
  parseTimeRange,
  parseSingleTime,
  calculateTimeDifference,
};
