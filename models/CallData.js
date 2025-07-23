const mongoose = require("mongoose");

const callDataSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    callID: { type: String, required: true },
    channelID: { type: String, required: true },
    type: { type: String },
    direction: { type: String },
    lastState: { type: String },
    startTime: { type: Date },
    answeredTime: { type: Date },
    hangupTime: { type: Date },
    totalDuration: { type: Number },
    inCallDuration: { type: Number },
    queueDuration: { type: Number },
    holdDuration: { type: Number },
    ringingDuration: { type: Number },
    afterCallDuration: { type: Number },
    ivrDuration: { type: Number },
    fromNumber: { type: String },
    toNumber: { type: String },
    contact: { type: String },
    userID: { type: String },
    userName: { type: String },
    ivrID: { type: String },
    ivrName: { type: String },
    scenarioName: { type: String },
    file: { type: String },
    note: { type: String },
    tags: [{ type: String }],
    groups: { type: String },
    notes: { type: String },
    locations: { type: String },
    digitEntered: { type: String },
    missed: { type: String },
    transcript: { type: String },
    analysis: { type: String },
    qualityScore: { type: Number, default: 0 },
    analysisTimestamp: { type: Date },

    structuredAnalysis: {
      generalAnalysis: { type: String },
      speakerIdentification: {
        agentLines: { type: mongoose.Schema.Types.Mixed }, // Change from String to Mixed type
        clientLines: { type: mongoose.Schema.Types.Mixed }, // Change from String to Mixed type
        confidence: { type: String },
      },
      salesPerformance: {
        score: { type: Number },
        strengths: [{ type: String }],
        weaknesses: [{ type: String }],
        productsDiscussed: [{ type: String }],
        closingAttempts: { type: Number },
        objectionHandling: { type: String },
      },
      conversationDynamics: {
        agentTalkRatio: { type: String },
        keyMoments: [{ type: String }],
        missedOpportunities: [{ type: String }],
      },
      recommendations: [{ type: String }],
    },
  },
  {
    timestamps: true,
  }
);

const CallData = mongoose.model("CallData", callDataSchema);

module.exports = CallData;
