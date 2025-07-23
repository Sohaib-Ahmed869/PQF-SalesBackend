const bcrypt = require("bcryptjs");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const XLSX = require("xlsx");

const SalesOrder = require("../models/SalesOrder");
const User = require("../models/User");

const mongoose = require("mongoose");

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";
// Set up multer for file upload
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
  fileFilter: (req, file, cb) => {
    // Accept only Excel files
    if (
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xls")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed"));
    }
  },
}).single("file");

// Login controller
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Find user by email
    const user = await User.findOne({ email, deactivated: false });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Update last login
    user.lastLogin = Date.now();
    await user.save();

    // Create token
    const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    // Return user data without password
    const userData = user.toObject();
    delete userData.password;

    res.json({
      message: "Login successful",
      token,
      user: userData,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.registerAdmin = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !password || !role) {
      return res
        .status(400)
        .json({ message: "All required fields must be provided" });
    }

    // Check if email already exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role,
    });

    // Save user
    await newUser.save();

    // Return user data without password
    const userData = newUser.toObject();

    res.status(201).json({
      message: "User registered successfully",
      user: userData,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Register user controller
exports.register = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      hubspotId,
      target,
      managerId,
    } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !password || !role) {
      return res
        .status(400)
        .json({ message: "All required fields must be provided" });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Role-based permission checks
    const currentUserRole = req.user.role;

    // Admin can create sales_manager and sales_agent
    if (currentUserRole === "admin") {
      if (role !== "sales_manager" && role !== "sales_agent") {
        return res.status(403).json({
          message: "Admin can only create sales manager or sales agent",
        });
      }
    }
    // Sales manager can only create sales_agent
    else if (currentUserRole === "sales_manager") {
      if (role !== "sales_agent") {
        return res
          .status(403)
          .json({ message: "Sales manager can only create sales agent" });
      }
    }
    // Sales agent cannot create users
    else {
      return res
        .status(403)
        .json({ message: "You don't have permission to register new users" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role,
      createdBy: req.user._id,
    });

    // Add role-specific fields
    if (role === "sales_agent") {
      if (hubspotId) newUser.hubspotId = hubspotId;
      if (target) newUser.target = target;

      // Set manager
      if (currentUserRole === "admin" && managerId) {
        // Admin specified a manager
        const manager = await User.findById(managerId);
        if (!manager || manager.role !== "sales_manager") {
          return res.status(400).json({ message: "Invalid manager ID" });
        }
        newUser.manager = managerId;
      } else if (currentUserRole === "sales_manager") {
        // Sales manager is creating - they are the manager
        newUser.manager = req.user._id;
      } else {
        return res
          .status(400)
          .json({ message: "Manager ID is required for sales agent" });
      }
    }

    // Save user
    await newUser.save();

    // Return user data without password
    const userData = newUser.toObject();
    delete userData.password;

    res.status(201).json({
      message: "User registered successfully",
      user: userData,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get current user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("-password")
      .populate("createdBy", "firstName lastName email")
      .populate("manager", "firstName lastName email");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update current user profile
exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const updatedFields = {};

    if (firstName) updatedFields.firstName = firstName;
    if (lastName) updatedFields.lastName = lastName;
    if (email) updatedFields.email = email;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updatedFields },
      { new: true, runValidators: true }
    ).select("-password");

    res.json({
      message: "Profile updated successfully",
      user,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new passwords are required" });
    }

    const user = await User.findById(req.user._id);

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    user.password = hashedPassword;
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get users by role
exports.getUsers = async (req, res) => {
  try {
    const { role } = req.query;
    console.log(role);
    const query = {};

    // Filter by role if provided
    if (role) {
      query.role = role;
    }

    // Apply role-based filtering
    if (req.user.role === "admin" || req.user.role === "sales_agent") {
      // Admin can see all users (no additional filtering)
    } else if (req.user.role === "sales_manager") {
      // Sales manager can only see their own team members (sales agents assigned to them)
      if (role === "sales_agent" || !role) {
        query.manager = req.user._id;
      } else {
        // If requesting other roles (like sales_manager), return empty array
        return res.json([]);
      }
    } else {
      // Other roles should not access this endpoint
      return res.status(403).json({ message: "Access denied" });
    }

    const users = await User.find(query)
      .select("-password")
      .populate("createdBy", "firstName lastName email")
      .populate("manager", "firstName lastName email");

    res.json(users);
  } catch (error) {
    console.error("User fetch error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    let user;

    // Check permissions
    if (req.user.role === "admin") {
      // Admin can see any user
      user = await User.findById(id)
        .select("-password")
        .populate("createdBy", "firstName lastName email")
        .populate("manager", "firstName lastName email");
    } else if (req.user.role === "sales_manager") {
      // Sales manager can only see their sales agents
      user = await User.findOne({
        _id: id,
        role: "sales_agent",
        createdBy: req.user._id,
      })
        .select("-password")
        .populate("createdBy", "firstName lastName email")
        .populate("manager", "firstName lastName email");
    } else {
      // Sales agents can only see themselves
      if (id !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }

      user = await User.findById(id)
        .select("-password")
        .populate("createdBy", "firstName lastName email")
        .populate("manager", "firstName lastName email");
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("User fetch error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update user
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      firstName,
      lastName,
      email,
      hubspotId,
      target,
      deactivated,
      managerId,
    } = req.body;

    // Check if user exists
    const userToUpdate = await User.findById(id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "User not found" });
    }

    // Permission check
    if (req.user.role === "admin") {
      // Admin can update any user
    } else if (req.user.role === "sales_manager") {
      // Sales manager can only update their sales agents
    } else {
      // Sales agents cannot update other users
      return res.status(403).json({ message: "Access denied" });
    }

    // Build update object
    const updatedFields = {};
    if (firstName) updatedFields.firstName = firstName;
    if (lastName) updatedFields.lastName = lastName;
    if (email) updatedFields.email = email;
    if (deactivated !== undefined) updatedFields.deactivated = deactivated;

    // Role-specific updates
    if (userToUpdate.role === "sales_agent") {
      if (hubspotId !== undefined) updatedFields.hubspotId = hubspotId;
      if (target !== undefined) updatedFields.target = target;

      // Manager update (admin only)
      if (req.user.role === "admin" && managerId !== undefined) {
        const manager = await User.findById(managerId);
        if (!manager || manager.role !== "sales_manager") {
          return res.status(400).json({ message: "Invalid manager ID" });
        }
        updatedFields.manager = managerId;
      }
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updatedFields },
      { new: true, runValidators: true }
    )
      .select("-password")
      .populate("createdBy", "firstName lastName email")
      .populate("manager", "firstName lastName email");

    console.log(updatedUser);
    res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("User update error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Reset user password
exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ message: "New password is required" });
    }

    // Check if user exists
    const userToUpdate = await User.findById(id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "User not found" });
    }

    // Permission check
    if (req.user.role === "admin") {
      // Admin can reset any user's password
    } else if (req.user.role === "sales_manager") {
      // Sales manager can only reset their sales agents' passwords
      if (
        userToUpdate.role !== "sales_agent" ||
        userToUpdate.createdBy.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          message: "You can only reset passwords for sales agents you created",
        });
      }
    } else {
      // Sales agents cannot reset other users' passwords
      return res.status(403).json({ message: "Access denied" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    userToUpdate.password = hashedPassword;
    await userToUpdate.save();

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.importSalesAgents = async (req, res) => {
  // Use multer to handle file upload
  upload(req, res, async (err) => {
    try {
      if (err) {
        return res.status(400).json({ message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Please upload an Excel file" });
      }

      // Role-based permission check
      const currentUserRole = req.user.role;
      if (currentUserRole !== "admin" && currentUserRole !== "sales_manager") {
        return res.status(403).json({
          message: "Only admins and sales managers can import sales agents",
        });
      }

      // Initialize results tracking
      const results = {
        total: 0,
        success: 0,
        failed: 0,
        errors: [],
      };

      // Read the Excel file
      const workbook = XLSX.readFile(req.file.path, {
        cellDates: true, // Properly parse date values
      });

      // Get the first sheet
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        raw: false, // Convert all cells to strings
        defval: "", // Default to empty string for empty cells
      });

      results.total = jsonData.length;
      const agents = [];

      // Process each row
      for (const row of jsonData) {
        // Normalize field names (handle variations in column names)
        const agent = {
          firstName:
            row["First Name"] ||
            row["FirstName"] ||
            row["First_Name"] ||
            row["first_name"] ||
            row["firstname"],
          lastName:
            row["Last Name"] ||
            row["LastName"] ||
            row["Last_Name"] ||
            row["last_name"] ||
            row["lastname"],
          email: row["Email"] || row["email"],
          hubspotId:
            row["User ID"] ||
            row["UserID"] ||
            row["User_ID"] ||
            row["user_id"] ||
            row["userid"] ||
            row["HubSpot ID"] ||
            row["hubspot_id"] ||
            row["hubspotId"],
        };

        // Skip rows without required fields
        if (!agent.firstName || !agent.lastName || !agent.email) {
          results.failed++;
          results.errors.push(
            `Missing required fields for row: ${JSON.stringify(row)}`
          );
          continue;
        }

        try {
          // Check if user already exists
          const existingUser = await User.findOne({ email: agent.email });
          if (existingUser) {
            results.failed++;
            results.errors.push(
              `User with email ${agent.email} already exists`
            );
            continue;
          }

          // Generate a random password (8 characters)
          const tempPassword = Math.random().toString(36).slice(-8);

          // Hash password
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(tempPassword, salt);

          // Create new user object
          const newUser = new User({
            firstName: agent.firstName,
            lastName: agent.lastName,
            email: agent.email.trim().toLowerCase(),
            password: hashedPassword,
            role: "sales_agent",
            createdBy: req.user._id,
            hubspotId: agent.hubspotId || undefined,
            target: 0, // Default target
          });

          // Set manager based on current user role
          if (currentUserRole === "sales_manager") {
            // If sales manager is creating, they are the manager
            newUser.manager = req.user._id;
          } else if (currentUserRole === "admin") {
            // For admin, we would ideally have a manager ID in the Excel
            // For now, we'll just set it to the admin (can be updated later)
            newUser.manager = req.user._id;
          }

          // Save user
          await newUser.save();

          // Add password to agent for the response
          agent.tempPassword = tempPassword;
          agents.push(agent);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push(
            `Error creating ${agent.email}: ${error.message}`
          );
        }
      }

      // Clean up the uploaded file
      fs.unlinkSync(req.file.path);

      // Return results
      res.json({
        message: "Import completed",
        results: {
          total: results.total,
          success: results.success,
          failed: results.failed,
        },
        agents: agents.map((a) => ({
          firstName: a.firstName,
          lastName: a.lastName,
          email: a.email,
          tempPassword: a.tempPassword,
        })),
        errors: results.errors,
      });
    } catch (error) {
      console.error("Import error:", error);

      // Clean up the uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({ message: "Server error", error: error.message });
    }
  });
};

exports.setTarget = async (req, res) => {
  try {
    const { target } = req.body;
    const { id } = req.params;

    // Check if user exists
    const userToUpdate = await User.findById(id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "User not found" });
    }

    // Permission check
    if (req.user.role === "admin") {
      // Admin can update any user
    } else if (req.user.role === "sales_manager") {
      // Sales manager can only update their sales agents
      if (userToUpdate.manager?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }
    } else {
      return res.status(403).json({ message: "Access denied" });
    }

    // Update the base target (this can be used as default for new CustomerTargets)
    userToUpdate.target = target;
    await userToUpdate.save();

    res.json({
      message:
        "Base target updated successfully. Create specific customer targets for detailed tracking.",
      user: {
        id: userToUpdate._id,
        firstName: userToUpdate.firstName,
        lastName: userToUpdate.lastName,
        target: userToUpdate.target,
      },
    });
  } catch (error) {
    console.error("User update error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
exports.getSalesPerformance = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    // Permission checks
    if (req.user.role === "sales_agent" && req.user._id.toString() !== id) {
      return res.status(403).json({ message: "Access denied" });
    }

    const user = await User.findById(id);
    if (!user || user.role !== "sales_agent") {
      return res.status(404).json({ message: "Sales agent not found" });
    }

    // Import CustomerTarget model
    const CustomerTarget = require("../models/CustomerTarget");

    // Get customer targets for this agent
    const targets = await CustomerTarget.find({ salesAgent: id })
      .populate("salesAgent", "firstName lastName")
      .sort({ currentPeriodEnd: -1 });

    // Calculate achievements for each target
    const {
      calculateTargetAchievement,
    } = require("./customerTarget.controller");

    const targetsWithAchievements = await Promise.all(
      targets.map(async (target) => {
        const achievement = await calculateTargetAchievement(target);
        return {
          ...target.toObject(),
          achievedAmount: achievement.achievedAmount,
          achievementRate: achievement.achievementRate,
          invoiceCount: achievement.invoiceCount,
        };
      })
    );

    // Calculate overall performance
    const totalTargetAmount = targetsWithAchievements.reduce(
      (sum, t) => sum + t.targetAmount,
      0
    );
    const totalAchievedAmount = targetsWithAchievements.reduce(
      (sum, t) => sum + t.achievedAmount,
      0
    );
    const overallAchievementRate =
      totalTargetAmount > 0
        ? (totalAchievedAmount / totalTargetAmount) * 100
        : 0;

    res.json({
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        baseTarget: user.target,
      },
      performance: {
        totalTargets: targetsWithAchievements.length,
        totalTargetAmount,
        totalAchievedAmount,
        overallAchievementRate: parseFloat(overallAchievementRate.toFixed(2)),
      },
      targets: targetsWithAchievements,
    });
  } catch (error) {
    console.error("Error fetching sales performance:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getTargetHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { year, period } = req.query;

    // Permission checks
    if (req.user.role === "sales_agent" && req.user._id.toString() !== id) {
      return res.status(403).json({ message: "Access denied" });
    }

    const agent = await User.findById(id).select("-password");
    if (!agent || agent.role !== "sales_agent") {
      return res.status(404).json({ message: "Sales agent not found" });
    }

    const CustomerTarget = require("../models/CustomerTarget");

    // Build query
    const query = { salesAgent: id };
    if (year) {
      const yearInt = parseInt(year);
      query.$or = [
        {
          currentPeriodStart: {
            $gte: new Date(yearInt, 0, 1),
            $lt: new Date(yearInt + 1, 0, 1),
          },
        },
        {
          currentPeriodEnd: {
            $gte: new Date(yearInt, 0, 1),
            $lt: new Date(yearInt + 1, 0, 1),
          },
        },
      ];
    }
    if (period) {
      query.period = period;
    }

    const targets = await CustomerTarget.find(query).sort({
      currentPeriodStart: -1,
    });

    // Calculate achievements
    const {
      calculateTargetAchievement,
    } = require("./customerTarget.controller");

    const targetsWithAchievements = await Promise.all(
      targets.map(async (target) => {
        const achievement = await calculateTargetAchievement(target);
        return {
          id: target._id,
          customer: target.cardName,
          period: target.period,
          targetAmount: target.targetAmount,
          achievedAmount: achievement.achievedAmount,
          achievementRate: achievement.achievementRate,
          periodStart: target.currentPeriodStart,
          periodEnd: target.currentPeriodEnd,
          status: target.status,
          isRecurring: target.isRecurring,
        };
      })
    );

    res.json({
      agent: {
        _id: agent._id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        email: agent.email,
        baseTarget: agent.target,
      },
      targetHistory: targetsWithAchievements,
    });
  } catch (error) {
    console.error("Error fetching target history:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.setMonthlyTarget = async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year, target } = req.body;

    if (!month || !year || target === undefined) {
      return res
        .status(400)
        .json({ message: "Month, year and target are required" });
    }

    // Permission checks...

    const user = await User.findById(id);
    if (!user || user.role !== "sales_agent") {
      return res.status(404).json({ message: "Sales agent not found" });
    }

    // Set monthly target
    let targetEntry = user.targetHistory.find(
      (entry) => entry.month === month && entry.year === parseInt(year)
    );

    if (!targetEntry) {
      // Create new entry
      user.targetHistory.push({
        month,
        year: parseInt(year),
        target,
        achieved: 0,
        achievementRate: 0,
      });
    } else {
      // Update existing entry
      targetEntry.target = target;
      targetEntry.achievementRate =
        targetEntry.achieved > 0 ? (targetEntry.achieved / target) * 100 : 0;
    }

    // Update overall target
    user.target = target;

    await user.save();

    res.json({
      message: "Monthly target set successfully",
      target: {
        month,
        year,
        target,
        user: {
          id: user._id,
          name: `${user.firstName} ${user.lastName}`,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getSalesDashboard = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Permission checks based on user role
    const query = { role: "sales_agent" };

    // If sales manager, only show their agents
    if (req.user.role === "sales_manager") {
      query.manager = req.user._id;
    }

    const salesAgents = await User.find(query)
      .select("firstName lastName email target")
      .populate("manager", "firstName lastName email");

    const CustomerTarget = require("../models/CustomerTarget");
    const {
      calculateTargetAchievement,
    } = require("./customerTarget.controller");

    // Calculate performance for each agent
    const agentPerformance = await Promise.all(
      salesAgents.map(async (agent) => {
        // Get active targets for this agent
        const targets = await CustomerTarget.find({
          salesAgent: agent._id,
          status: "active",
        });

        // Calculate total achievement across all targets
        let totalTargetAmount = 0;
        let totalAchievedAmount = 0;
        let totalTargets = targets.length;

        for (const target of targets) {
          const achievement = await calculateTargetAchievement(target);
          totalTargetAmount += target.targetAmount;
          totalAchievedAmount += achievement.achievedAmount;
        }

        const achievementRate =
          totalTargetAmount > 0
            ? (totalAchievedAmount / totalTargetAmount) * 100
            : 0;

        return {
          _id: agent._id,
          name: `${agent.firstName} ${agent.lastName}`,
          email: agent.email,
          totalTargets,
          totalTargetAmount,
          totalAchievedAmount,
          achievementRate: parseFloat(achievementRate.toFixed(2)),
          manager: agent.manager
            ? `${agent.manager.firstName} ${agent.manager.lastName}`
            : "None",
        };
      })
    );

    // Sort by achievement rate
    agentPerformance.sort((a, b) => b.achievementRate - a.achievementRate);

    // Calculate summary statistics
    const totalAgents = salesAgents.length;
    const totalTargetAmount = agentPerformance.reduce(
      (sum, agent) => sum + agent.totalTargetAmount,
      0
    );
    const totalAchievedAmount = agentPerformance.reduce(
      (sum, agent) => sum + agent.totalAchievedAmount,
      0
    );
    const avgAchievementRate =
      totalAgents > 0
        ? agentPerformance.reduce(
            (sum, agent) => sum + agent.achievementRate,
            0
          ) / totalAgents
        : 0;

    // Top and bottom performers
    const topPerformers = agentPerformance.slice(0, 5).map((agent) => ({
      name: agent.name,
      achievementRate: agent.achievementRate,
      achieved: agent.totalAchievedAmount,
    }));

    const bottomPerformers =
      totalAgents > 5
        ? agentPerformance
            .slice(-5)
            .reverse()
            .map((agent) => ({
              name: agent.name,
              achievementRate: agent.achievementRate,
              achieved: agent.totalAchievedAmount,
            }))
        : [];

    const dashboardData = {
      summary: {
        totalAgents,
        totalTargetAmount,
        totalAchievedAmount,
        avgAchievementRate: parseFloat(avgAchievementRate.toFixed(2)),
      },
      topPerformers,
      bottomPerformers,
      agentPerformance,
    };

    res.json(dashboardData);
  } catch (error) {
    console.error("Error fetching sales dashboard:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
exports.getTargetHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const { year } = req.query;

    // Permission checks
    const currentUserRole = req.user.role;

    if (currentUserRole === "sales_agent" && req.user._id.toString() !== id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Find the agent
    const agent = await User.findById(id).select("-password");

    if (!agent || agent.role !== "sales_agent") {
      return res.status(404).json({ message: "Sales agent not found" });
    }

    // Filter targetHistory by year if provided
    let targetHistory = agent.targetHistory || [];

    if (year) {
      targetHistory = targetHistory.filter(
        (entry) => entry.year === parseInt(year)
      );
    }

    res.json({
      agent: {
        _id: agent._id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        email: agent.email,
        target: agent.target,
        targetAchieved: agent.targetAchieved,
      },
      targetHistory: targetHistory,
    });
  } catch (error) {
    console.error("Error fetching target history:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Complete getSalesDashboard function
exports.getSalesDashboard = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Permission checks based on user role
    const query = { role: "sales_agent" };

    const salesAgents = await User.find(query)
      .select(
        "firstName lastName email target targetAchieved salesHistory targetHistory"
      )
      .populate("manager", "firstName lastName email");

    // Calculate aggregated statistics
    let totalSales = 0;
    let totalOrders = 0;
    let agentPerformance = [];

    // Time period filter
    const periodFilter = {};
    if (startDate) periodFilter.$gte = new Date(startDate);
    if (endDate) periodFilter.$lte = new Date(endDate);

    // Get current month/year
    const currentDate = new Date();
    const currentMonth = currentDate.toLocaleString("default", {
      month: "short",
    });
    const currentYear = currentDate.getFullYear();

    // Calculate aggregated statistics for all agents
    for (const agent of salesAgents) {
      // Get total sales and orders for this agent
      const agentTotalSales = agent.targetAchieved || 0;
      const agentOrders = agent.salesHistory.reduce(
        (sum, month) => sum + (month.orderCount || 0),
        0
      );

      totalSales += agentTotalSales;
      totalOrders += agentOrders;

      // Get current month performance
      const currentMonthData = agent.salesHistory.find(
        (entry) => entry.month === currentMonth && entry.year === currentYear
      ) || { totalValue: 0, orderCount: 0 };

      // Get target data
      const currentMonthTarget = agent.targetHistory.find(
        (entry) => entry.month === currentMonth && entry.year === currentYear
      ) || { target: agent.target || 0, achieved: 0, achievementRate: 0 };

      // Calculate achievement rate
      const achievementRate =
        agent.target > 0 ? (agent.targetAchieved / agent.target) * 100 : 0;

      // Add to agent performance array
      agentPerformance.push({
        _id: agent._id,
        name: `${agent.firstName} ${agent.lastName}`,
        email: agent.email,
        totalSales: agentTotalSales,
        totalOrders: agentOrders,
        currentMonthSales: currentMonthData.totalValue || 0,
        currentMonthOrders: currentMonthData.orderCount || 0,
        target: agent.target || 0,
        achieved: agent.targetAchieved || 0,
        achievementRate: achievementRate,
        manager: agent.manager
          ? `${agent.manager.firstName} ${agent.manager.lastName}`
          : "None",
      });
    }

    // Sort agents by performance
    agentPerformance.sort((a, b) => b.achievementRate - a.achievementRate);

    // Top performers (top 5)
    const topPerformers = agentPerformance.slice(0, 5).map((agent) => ({
      name: agent.name,
      achievementRate: agent.achievementRate,
      sales: agent.totalSales,
    }));

    // Bottom performers (bottom 5) if there are enough agents
    const bottomPerformers =
      agentPerformance.length > 5
        ? agentPerformance
            .slice(-5)
            .reverse()
            .map((agent) => ({
              name: agent.name,
              achievementRate: agent.achievementRate,
              sales: agent.totalSales,
            }))
        : [];

    // Monthly summary for overall team performance
    const monthlySummary = [];

    // Group all sales by month
    const allMonthsMap = new Map();

    // Collect all months data from all agents
    salesAgents.forEach((agent) => {
      (agent.salesHistory || []).forEach((entry) => {
        const key = `${entry.month}-${entry.year}`;
        if (!allMonthsMap.has(key)) {
          allMonthsMap.set(key, {
            month: entry.month,
            year: entry.year,
            totalSales: 0,
            totalOrders: 0,
            agents: 0,
          });
        }

        const monthData = allMonthsMap.get(key);
        monthData.totalSales += entry.totalValue || 0;
        monthData.totalOrders += entry.orderCount || 0;
        monthData.agents++;
      });
    });

    // Convert map to array and sort by date
    const monthsArray = Array.from(allMonthsMap.values());
    monthsArray.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;

      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return months.indexOf(a.month) - months.indexOf(b.month);
    });

    // Calculate average achievement rate
    const avgAchievementRate =
      salesAgents.length > 0
        ? agentPerformance.reduce(
            (sum, agent) => sum + agent.achievementRate,
            0
          ) / salesAgents.length
        : 0;

    // Build response object
    const dashboardData = {
      summary: {
        totalAgents: salesAgents.length,
        totalSales,
        totalOrders,
        avgAchievementRate: parseFloat(avgAchievementRate.toFixed(2)),
      },
      topPerformers,
      bottomPerformers,
      monthlySummary: monthsArray,
      agentPerformance,
    };

    res.json(dashboardData);
  } catch (error) {
    console.error("Error fetching sales dashboard:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get orders for a specific agent by month
exports.getAgentOrdersByMonth = async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: "Month and year are required" });
    }

    // Permission checks based on user role
    const currentUserRole = req.user.role;

    // Sales agents can only see their own data
    if (currentUserRole === "sales_agent" && req.user._id.toString() !== id) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Find the agent
    const agent = await User.findById(id);

    if (!agent || agent.role !== "sales_agent") {
      return res.status(404).json({ message: "Sales agent not found" });
    }

    // Find orders created by this agent during the specified month/year
    const startDate = new Date(`${month} 1, ${year}`);
    const endMonth = startDate.getMonth() + 1;
    const endYear =
      startDate.getMonth() === 11 ? parseInt(year) + 1 : parseInt(year);
    const endDate = new Date(`${endMonth}/1/${endYear}`);

    const orders = await SalesOrder.find({
      salesAgent: id,
    }).sort({ DocDate: -1 });

    res.json({
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("Error fetching agent orders by month:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Helper function to update sales agent stats when an order is created
async function updateSalesAgentStats(salesAgentId, order) {
  try {
    const agent = await User.findById(salesAgentId);
    if (!agent || agent.role !== "sales_agent") return;

    // Get current month and year
    const orderDate = order.DocDate;
    const month = orderDate.toLocaleString("default", { month: "short" });
    const year = orderDate.getFullYear();

    // Calculate order value
    const orderValue = order.DocTotal;

    // Find or create entry for current month/year in salesHistory
    let salesEntry = agent.salesHistory.find(
      (entry) => entry.month === month && entry.year === year
    );

    if (!salesEntry) {
      // Create new entry if it doesn't exist
      agent.salesHistory.push({
        month,
        year,
        orderCount: 1,
        totalValue: orderValue,
        orders: [order._id],
      });
    } else {
      // Update existing entry
      salesEntry.orderCount += 1;
      salesEntry.totalValue += orderValue;
      salesEntry.orders.push(order._id);
    }

    // Update target achievement
    let targetEntry = agent.targetHistory.find(
      (entry) => entry.month === month && entry.year === year
    );

    if (!targetEntry) {
      // Create new target entry with current target
      agent.targetHistory.push({
        month,
        year,
        target: agent.target,
        achieved: orderValue,
        achievementRate:
          agent.target > 0 ? (orderValue / agent.target) * 100 : 0,
      });
    } else {
      // Update existing target entry
      targetEntry.achieved += orderValue;
      targetEntry.achievementRate =
        targetEntry.target > 0
          ? (targetEntry.achieved / targetEntry.target) * 100
          : 0;
    }

    // Update overall targetAchieved
    agent.targetAchieved += orderValue;

    // Save changes
    await agent.save();
  } catch (error) {
    console.error("Error updating sales agent stats:", error);
  }
}
