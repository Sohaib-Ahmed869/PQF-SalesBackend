const mongoose = require("mongoose");
const dotenv = require("dotenv");
const CallData = require("../models/CallData"); // Adjust path as needed
const { syncDateRange } = require("./ringoverJob"); // Import from your updated job file

// Load environment variables
dotenv.config();

/**
 * Function to fetch all calls from May 2, 2025 until today
 * @param {boolean} forceRefresh - Force a refresh from the API even if data exists
 * @returns {Promise<Object>} Object with counts of calls, success, and error
 */
async function fetchCallsFromMay2UntilToday(forceRefresh = true) {
  try {
    // Connect to MongoDB if not already connected
    if (!mongoose.connection.readyState) {
      await mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("MongoDB connected");
    }

    // Define the date range - May 2, 2025 to today
    const startDate = new Date("2025-05-02T00:00:00.000Z");
    const endDate = new Date(); // Today

    console.log(
      `Fetching calls from ${startDate.toISOString()} to ${endDate.toISOString()}`
    );

    // Only check database if we're not forcing a refresh
    if (!forceRefresh) {
      // Check what data we already have in this range
      const existingCallsCount = await CallData.countDocuments({
        startTime: {
          $gte: startDate,
          $lte: endDate,
        },
      });

      console.log(
        `Found ${existingCallsCount} existing calls in the database for this period`
      );

      // Get the data directly from the database if we already have it and not forcing refresh
      if (existingCallsCount > 0) {
        console.log("Retrieving existing calls from the database...");

        const calls = await CallData.find({
          startTime: {
            $gte: startDate,
            $lte: endDate,
          },
        }).sort({ startTime: 1 });

        console.log(`Retrieved ${calls.length} calls from the database`);

        // Count calls with recordings
        const callsWithRecordings = calls.filter(
          (call) => call.file && call.file.length > 0
        );

        return {
          source: "database",
          totalCalls: calls.length,
          callsWithRecordings: callsWithRecordings.length,
          calls: calls,
        };
      }
    }

    // Fetch data from Ringover API (either because we're forcing or no data exists)
    console.log("Fetching calls from Ringover API...");

    // Use the syncDateRange function from your updated ringover job
    const result = await syncDateRange(startDate, endDate);

    console.log(
      `Completed API fetch. Saved ${result.totalSaved} calls with ${result.totalRecordings} recordings`
    );

    // Now retrieve the saved data from the database
    const calls = await CallData.find({
      startTime: {
        $gte: startDate,
        $lte: endDate,
      },
    }).sort({ startTime: 1 });

    return {
      source: "api",
      totalCalls: calls.length,
      callsWithRecordings: result.totalRecordings,
      calls: calls,
    };
  } catch (error) {
    console.error("Error fetching calls:", error);
    throw error;
  }
}

/**
 * Main function to execute and display results
 */
async function main() {
  try {
    console.log("Starting call retrieval process...");

    // Force refresh to always fetch from the API
    const result = await fetchCallsFromMay2UntilToday(true);

    console.log("===== Call Retrieval Results =====");
    console.log(`Source: ${result.source}`);
    console.log(`Total calls: ${result.totalCalls}`);
    console.log(`Calls with recordings: ${result.callsWithRecordings}`);

    // Display some sample data
    if (result.calls.length > 0) {
      console.log("\nSample Call Data:");
      const sampleCall = result.calls[0];
      console.log(`ID: ${sampleCall.id}`);
      console.log(`Direction: ${sampleCall.direction}`);
      console.log(`Start Time: ${sampleCall.startTime}`);
      console.log(`Duration: ${sampleCall.totalDuration} seconds`);
      console.log(`Has Recording: ${sampleCall.file ? "Yes" : "No"}`);

      // Display call count by direction
      const inboundCalls = result.calls.filter(
        (call) => call.direction === "in"
      ).length;
      const outboundCalls = result.calls.filter(
        (call) => call.direction === "out"
      ).length;

      console.log(`\nCall Direction Summary:`);
      console.log(`Inbound calls: ${inboundCalls}`);
      console.log(`Outbound calls: ${outboundCalls}`);

      // Display calls with longest duration
      const longestCalls = [...result.calls]
        .sort((a, b) => b.totalDuration - a.totalDuration)
        .slice(0, 5);

      console.log(`\nTop 5 Longest Calls:`);
      longestCalls.forEach((call, index) => {
        console.log(
          `${index + 1}. Call ID: ${call.id}, Duration: ${
            call.totalDuration
          } seconds, Date: ${call.startTime.toISOString().split("T")[0]}`
        );
      });
    }
  } catch (error) {
    console.error("Error in main execution:", error);
  } finally {
    // Close MongoDB connection
    if (mongoose.connection.readyState) {
      await mongoose.connection.close();
      console.log("MongoDB connection closed");
    }
  }
}

// Execute if this file is run directly
if (require.main === module) {
  main()
    .then(() => {
      console.log("Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

module.exports = {
  fetchCallsFromMay2UntilToday,
};
