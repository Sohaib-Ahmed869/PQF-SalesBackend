// utils/taskUploadMiddleware.js
const { uploadToS3 } = require("./s3Upload");
const multer = require("multer");

// Create middleware for task creation with optional attachment
const handleTaskAttachment = (req, res, next) => {
  console.log(
    "Handling task attachment with content-type:",
    req.headers["content-type"]
  );

  // Use the upload middleware to parse the multipart form data
  // This will populate req.body with the text fields and req.file with the file if present
  const upload = uploadToS3.single("attachment");

  upload(req, res, (err) => {
    if (err) {
      console.error("Error in upload middleware:", err);
      return res.status(400).json({
        success: false,
        message: err.message || "Error processing form data",
        error: err.message,
      });
    }

    console.log("Form data processed, req.body:", req.body);
    console.log("File uploaded?", !!req.file);
    if (req.file) {
      console.log("File details:", {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });
    }

    next();
  });
};

module.exports = { handleTaskAttachment };
