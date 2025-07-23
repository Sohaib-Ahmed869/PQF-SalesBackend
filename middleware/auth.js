const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Environment variables should be properly set up
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

// Verify token middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({
      _id: decoded.userId,
      deactivated: false,
    });

    if (!user) {
      return res.status(401).json({ message: "User not found or deactivated" });
    }

    req.token = token;
    req.user = user;

  //console.log("User authenticated: ", user);
    next();
  } catch (error) {
    res
      .status(401)
      .json({ message: "Authentication failed", error: error.message });
  }
};



// Check role middleware
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message:
          "Access denied. You don't have permission to perform this action",
      });
    }

    next();
  };
};

// Check if user can manage a specific user
// Admin can manage all users
// Sales manager can only manage sales agents created by them
const canManageUser = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const targetUserId = req.params.id;

    // Admin can manage all users
    if (req.user.role === "admin") {
      return next();
    }

    // Sales manager can only manage sales agents they created
    if (req.user.role === "sales_manager") {
      const targetUser = await User.findById(targetUserId);

      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      if (
        targetUser.role !== "sales_agent" ||
        targetUser.createdBy.toString() !== req.user._id.toString()
      ) {
        return res
          .status(403)
          .json({ message: "You can only manage sales agents you created" });
      }

      return next();
    }

    // Sales agents cannot manage other users
    return res.status(403).json({ message: "Access denied" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Check if user can manage a specific customer
const canManageCustomer = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const customerId = req.params.id;

    // Admin and sales manager can manage all customers
    if (["admin", "sales_manager"].includes(req.user.role)) {
      return next();
    }

    // Sales agent can only manage assigned customers
    if (req.user.role === "sales_agent") {
      const customer = await require("../models/Customer").findById(customerId);

      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      if (
        !customer.assignedTo ||
        customer.assignedTo.toString() !== req.user._id.toString()
      ) {
        return res
          .status(403)
          .json({ message: "You can only manage customers assigned to you" });
      }

      return next();
    }

    return res.status(403).json({ message: "Access denied" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

// Update last login middleware
const updateLastLogin = async (req, res, next) => {
  try {
    if (req.user) {
      req.user.lastLogin = Date.now();
      await req.user.save();
    }
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  auth,
  checkRole,
  canManageUser,
  canManageCustomer,
  updateLastLogin,
};
