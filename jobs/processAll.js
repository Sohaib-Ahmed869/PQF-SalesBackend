const mongoose = require("mongoose");
const processUnanalyzedCalls = require("../services/processUnanalyzedCalls");

require("dotenv").config();
require("../models/CallData");

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

mongoose.connection.once("open", async () => {
  await processUnanalyzedCalls();
  mongoose.disconnect();
});
