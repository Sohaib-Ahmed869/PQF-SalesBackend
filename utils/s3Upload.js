// utils/s3Upload.js

const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const path = require("path");

// Configure AWS S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY || "AKIA3CFVLIWQYTNLM5NG",
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const bucketName = process.env.S3_BUCKET || "halalfoodattachments";

// File type validation
const allowedFileTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

// Configure multer for S3 upload
const uploadToS3 = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: bucketName,
    acl: "public-read",
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      // Create unique file name with original extension
      const fileExt = path.extname(file.originalname);
      const uniqueFileName = `tasks/${Date.now()}-${file.originalname.replace(
        /\s+/g,
        "-"
      )}`;
      cb(null, uniqueFileName);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  },
  fileFilter: (req, file, cb) => {
    if (allowedFileTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only PDF, Word, Excel, images and text files are allowed."
        ),
        false
      );
    }
  },
});

// Generate pre-signed URL for file download
const generateSignedUrl = async (key) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL expires in 1 hour
};

// Delete object from S3
const deleteFileFromS3 = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return await s3Client.send(command);
};

module.exports = {
  s3Client,
  uploadToS3,
  generateSignedUrl,
  deleteFileFromS3,
  bucketName,
};
