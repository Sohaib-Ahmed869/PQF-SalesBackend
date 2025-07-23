const CallData = require("../models/CallData");
const axios = require("axios");

const processUnanalyzedCalls = async () => {
  try {
    const unprocessedCalls = await CallData.find({
      $or: [
        { transcript: { $exists: false } },
        { transcript: null },
        { analysis: { $exists: false } },
        { analysis: null },
      ],
      file: { $ne: null }, // Ensure there's an audio file
      totalDuration: { $gte: 20 },
      startTime: { $gte: new Date("2024-01-01") },
    });

    console.log(`Found ${unprocessedCalls.length} unanalyzed calls`);

    for (const call of unprocessedCalls) {
      const audioUrl = call.file;
      const callID = call.callID;

      try {
        const res = await axios.post("http://127.0.0.1:5001/analyze-call", {
          audio_url: audioUrl,
          call_id: callID,
        });

        const result = res.data;

        call.transcript = result.transcript;
        call.analysis = result.analysis;
        call.qualityScore = result.qualityScore;
        call.analysisTimestamp = new Date();

        if (result.structuredAnalysis) {
          call.structuredAnalysis = result.structuredAnalysis;
        }

        await call.save();
        console.log(`Analyzed call: ${callID}`);
      } catch (err) {
        console.error(`Failed to analyze call ${callID}:`, err.message);
      }
    }

    console.log("All unanalyzed calls processed.");
  } catch (err) {
    console.error("Error fetching unanalyzed calls:", err.message);
  }
};

module.exports = processUnanalyzedCalls;
