const cron = require("node-cron");
const axios = require("axios");
const dotenv = require("dotenv");
const CallData = require("../models/CallData");
const mongoose = require("mongoose");

// Load environment variables
dotenv.config();

// Ringover API configuration
const RINGOVER_API_KEY = process.env.RINGOVER_API_KEY;
const RINGOVER_API_URL = "https://public-api.ringover.com/v2/calls";
const RINGOVER_RECORDING_API_URL = "https://public-api.ringover.com/v2/calls"; // May need to be adjusted based on actual API

// Connect to MongoDB (if not already connected in your main app)
if (!mongoose.connection.readyState) {
  mongoose
    .connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.error("MongoDB connection error:", err));
}

/**
 * Formats date to ISO string and removes milliseconds
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDateForRingover(date) {
  return date.toISOString().split(".")[0] + "Z";
}

/**
 * Maps Ringover API response to CallData model format
 * @param {Object} call - Call data from Ringover API
 * @returns {Object} Formatted call data for MongoDB
 */
function mapRingoverCallToModel(call) {
  // Process tags - extract only the tag names as strings
  let tagStrings = [];
  if (call.tags && Array.isArray(call.tags)) {
    // If tags is already an array of objects, map to extract names
    tagStrings = call.tags
      .map((tag) => {
        if (typeof tag === "object" && tag.name) {
          return tag.name;
        } else if (typeof tag === "string") {
          return tag;
        }
        return "";
      })
      .filter((tag) => tag !== "");
  } else if (typeof call.tags === "string") {
    try {
      // If tags is a string representation of JSON, parse it first
      const parsedTags = JSON.parse(call.tags.replace(/'/g, '"'));
      if (Array.isArray(parsedTags)) {
        tagStrings = parsedTags
          .map((tag) => tag.name || "")
          .filter((tag) => tag !== "");
      }
    } catch (error) {
      // If parsing fails, leave tags as empty array
      console.warn(
        `Could not parse tags for call ${call.cdr_id}: ${error.message}`
      );
    }
  }

  // Handle user information
  const userName = call.user
    ? `${call.user.firstname} ${call.user.lastname}`
    : "";
  const userID = call.user ? call.user.user_id.toString() : "";

  return {
    id: call.cdr_id.toString(), // Ensure it's a string
    callID: call.call_id || "",
    channelID: call.channel_id || "",
    type: call.type || "",
    direction: call.direction || "",
    lastState: call.last_state || "",
    startTime: call.start_time ? new Date(call.start_time) : null,
    answeredTime: call.answered_time ? new Date(call.answered_time) : null,
    hangupTime: call.end_time ? new Date(call.end_time) : null,
    totalDuration: call.total_duration || 0,
    inCallDuration: call.incall_duration || 0,
    queueDuration: call.queue_duration || 0,
    holdDuration: call.hold_duration || 0,
    ringingDuration: call.ringing_duration || 0,
    afterCallDuration: call.aftercall_duration || 0, // Note field name difference
    ivrDuration: call.ivr_duration || 0,
    fromNumber: call.from_number || "",
    toNumber: call.to_number || "",
    contact: call.contact ? call.contact.contact_id.toString() : "",
    userID: userID,
    userName: userName,
    ivrID: call.ivr ? call.ivr.ivr_id : "",
    ivrName: call.ivr ? call.ivr.ivr_name : "",
    scenarioName: call.scenario_name || "",
    file: call.record || "", // Using record instead of recording_file
    note: call.note || "",
    tags: tagStrings,
    groups: call.groups || "",
    notes: call.notes || "",
    locations: call.locations || "",
    digitEntered: call.digits_entered || "",
    missed: call.is_answered ? "false" : "true", // Inverting is_answered for missed
    transcript: call.transcript || "",
    // Analysis fields are initialized with defaults and filled later by another process
  };
}

/**
 * Fetches call recordings and updates call objects with recording URLs
 * @param {Array} calls - Array of call data from Ringover API
 * @returns {Promise<Array>} - Updated array of call data with recording URLs
 */
async function fetchCallRecordings(calls) {
  console.log(`Checking recordings for ${calls.length} calls...`);
  let recordingsFound = 0;

  for (const call of calls) {
    // Only check for recordings on answered calls
    if (call.is_answered && call.incall_duration > 0) {
      try {
        // Try to fetch recording
        const recordingResponse = await axios({
          method: "GET",
          url: `${RINGOVER_RECORDING_API_URL}/${call.cdr_id}/record`,
          headers: {
            Authorization: `${RINGOVER_API_KEY}`,
            "Content-Type": "application/json",
          },
        });

        // Check if a recording URL is returned
        if (
          recordingResponse.data &&
          (recordingResponse.data.url || recordingResponse.data.record_url)
        ) {
          call.record =
            recordingResponse.data.url || recordingResponse.data.record_url;
          recordingsFound++;
          console.log(`Found recording for call ${call.cdr_id}`);
        }
      } catch (error) {
        // If 404, the recording probably doesn't exist
        if (error.response && error.response.status === 404) {
          console.log(`No recording found for call ${call.cdr_id}`);
        } else {
          console.error(
            `Error fetching recording for call ${call.cdr_id}:`,
            error.response?.data || error.message
          );
        }
      }
    }
  }

  console.log(`Found ${recordingsFound} recordings for ${calls.length} calls`);
  return calls;
}

/**
 * Fetches call data from Ringover API for a specific date range
 * @param {Date} startDate - Start date for fetching calls
 * @param {Date} endDate - End date for fetching calls
 * @returns {Promise<Array>} - Array of call data
 */
async function fetchRingoverCalls(startDate, endDate) {
  const formattedStartDate = formatDateForRingover(startDate);
  const formattedEndDate = formatDateForRingover(endDate);

  console.log(
    `Fetching Ringover calls from ${formattedStartDate} to ${formattedEndDate}`
  );

  let allCalls = [];
  let hasMore = true;
  let offset = 0;
  const limit = 1000; // Maximum allowed by API

  // Paginate through all results
  while (hasMore) {
    try {
      const response = await axios({
        method: "GET",
        url: RINGOVER_API_URL,
        headers: {
          Authorization: `${RINGOVER_API_KEY}`,
          "Content-Type": "application/json",
        },
        params: {
          start_date: formattedStartDate,
          end_date: formattedEndDate,
          limit_count: limit,
          limit_offset: offset,
        },
      });

      // Use call_list instead of calls based on response structure
      const calls = response.data?.call_list || [];

      // Log sample call data to debug
      if (calls.length > 0 && offset === 0) {
        console.log(
          `Sample call data structure: ${JSON.stringify(
            calls[0].record || "No record field"
          )}`
        );
        console.log(`Call has recording: ${calls[0].record ? "Yes" : "No"}`);
      }

      allCalls = [...allCalls, ...calls];

      // Check if we've received all calls based on total_call_count
      const totalCalls = response.data?.total_call_count || 0;

      if (calls.length < limit || allCalls.length >= totalCalls) {
        hasMore = false;
      } else {
        offset += limit;
        // API limitation: offset cannot exceed 9000
        if (offset >= 9000) {
          console.warn(
            "Reached maximum offset (9000). Some data may be missing."
          );
          hasMore = false;
        }
      }
    } catch (error) {
      console.error(
        "Error fetching Ringover calls:",
        error.response?.data || error.message
      );
      hasMore = false;
    }
  }

  // Try to fetch recordings for calls
  const callsWithRecordings = await fetchCallRecordings(allCalls);

  return callsWithRecordings;
}

/**
 * Main function to fetch yesterday's calls and save to MongoDB
 */
async function fetchAndSaveYesterdayCalls() {
  try {
    // Calculate yesterday's date range (full 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Fetch calls from Ringover API
    const calls = await fetchRingoverCalls(yesterday, endOfYesterday);
    console.log(`Retrieved ${calls.length} calls from Ringover API`);

    // Map and save each call to MongoDB
    let savedCount = 0;
    let errorCount = 0;
    let recordingsFound = 0;

    for (const call of calls) {
      try {
        const callData = mapRingoverCallToModel(call);

        // Track if we found a recording
        if (callData.file) {
          recordingsFound++;
        }

        // Use findOneAndUpdate with upsert to avoid duplicates
        await CallData.findOneAndUpdate({ id: callData.id }, callData, {
          upsert: true,
          new: true,
        });

        savedCount++;
      } catch (error) {
        console.error(`Error saving call ${call.cdr_id}:`, error.message);
        errorCount++;
      }
    }

    console.log(
      `Ringover data sync completed. Saved: ${savedCount}, Errors: ${errorCount}, Recordings found: ${recordingsFound}`
    );
  } catch (error) {
    console.error("Error in fetchAndSaveYesterdayCalls:", error);
  }
}

// // Schedule the task to run daily at 2:00 AM
// cron.schedule("0 2 * * *", async () => {
//   console.log("Running scheduled Ringover data fetch task");
//   await fetchAndSaveYesterdayCalls();
// });

// Also expose a function to manually run the job if needed
async function manuallyRunSync(daysAgo = 1) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysAgo);
  targetDate.setHours(0, 0, 0, 0);

  const endOfTargetDate = new Date(targetDate);
  endOfTargetDate.setHours(23, 59, 59, 999);

  console.log(
    `Manually running sync for date: ${targetDate.toISOString().split("T")[0]}`
  );

  const calls = await fetchRingoverCalls(targetDate, endOfTargetDate);
  console.log(`Retrieved ${calls.length} calls`);

  let savedCount = 0;
  let errorCount = 0;
  let recordingsFound = 0;

  for (const call of calls) {
    try {
      const callData = mapRingoverCallToModel(call);

      // Track recordings
      if (callData.file) {
        recordingsFound++;
      }

      await CallData.findOneAndUpdate({ id: callData.id }, callData, {
        upsert: true,
        new: true,
      });

      savedCount++;
    } catch (error) {
      console.error(`Error saving call ${call.cdr_id}:`, error.message);
      errorCount++;
    }
  }

  console.log(
    `Manual sync completed. Saved: ${savedCount}, Errors: ${errorCount}, Recordings found: ${recordingsFound}`
  );
  return { savedCount, errorCount, recordingsFound };
}

// Function to sync data for a specific date range
async function syncDateRange(startDate, endDate) {
  console.log(
    `Running sync for date range: ${startDate.toISOString().split("T")[0]} to ${
      endDate.toISOString().split("T")[0]
    }`
  );

  // The API has a 15-day limit, so we need to chunk requests
  const maxDaySpan = 15;
  let currentStart = new Date(startDate);
  let totalSaved = 0;
  let totalErrors = 0;
  let totalRecordings = 0;

  while (currentStart < endDate) {
    // Calculate the end of this chunk (either 15 days later or the end date)
    let chunkEnd = new Date(currentStart);
    chunkEnd.setDate(chunkEnd.getDate() + maxDaySpan);

    if (chunkEnd > endDate) {
      chunkEnd = new Date(endDate);
    }

    console.log(
      `Processing chunk: ${currentStart.toISOString().split("T")[0]} to ${
        chunkEnd.toISOString().split("T")[0]
      }`
    );

    const calls = await fetchRingoverCalls(currentStart, chunkEnd);
    console.log(`Retrieved ${calls.length} calls for this chunk`);

    let savedCount = 0;
    let errorCount = 0;
    let recordingsFound = 0;

    for (const call of calls) {
      try {
        const callData = mapRingoverCallToModel(call);

        // Track recordings
        if (callData.file) {
          recordingsFound++;
          totalRecordings++;
        }

        await CallData.findOneAndUpdate({ id: callData.id }, callData, {
          upsert: true,
          new: true,
        });

        savedCount++;
        totalSaved++;
      } catch (error) {
        console.error(`Error saving call ${call.cdr_id}:`, error.message);
        errorCount++;
        totalErrors++;
      }
    }

    console.log(
      `Chunk sync completed. Saved: ${savedCount}, Errors: ${errorCount}, Recordings found: ${recordingsFound}`
    );

    // Move to the next chunk
    currentStart = new Date(chunkEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  console.log(
    `Date range sync completed from ${
      startDate.toISOString().split("T")[0]
    } to ${
      endDate.toISOString().split("T")[0]
    }. Total saved: ${totalSaved}, Total errors: ${totalErrors}, Total recordings: ${totalRecordings}`
  );

  return { totalSaved, totalErrors, totalRecordings };
}

// // Initialize job
// console.log("Ringover daily data fetch scheduler initialized");

