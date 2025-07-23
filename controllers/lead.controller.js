// controllers/lead.controller.js
const Lead = require("../models/Lead");
const Task = require("../models/Task");
const User = require("../models/User");

/**
 * Get all leads
 */
exports.getLeads = async (req, res) => {
  try {
    const { status, tags, assignedTo, search } = req.query;
    const query = {};

    // Apply filters
    if (status) query.status = status;

    if (tags) {
      if (Array.isArray(tags)) {
        query.tags = { $in: tags };
      } else {
        query.tags = tags;
      }
    }

    if (assignedTo) query.assignedTo = assignedTo;

    // Search
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { company: { $regex: search, $options: "i" } },
      ];
    }

    // Role-based access control
    if (req.user.role === "sales_agent") {
      // Sales agents can only see leads assigned to them
      query.assignedTo = req.user._id;
    } else if (req.user.role === "sales_manager") {
      // Sales managers can see their own leads and leads assigned to their team
      const salesAgents = await User.find({
        role: "sales_agent",
        manager: req.user._id,
      }).select("_id");

      const agentIds = salesAgents.map((agent) => agent._id);
      agentIds.push(req.user._id); // Include the manager's own leads

      query.assignedTo = { $in: agentIds };
    }
    // Admins can see all leads

    // Get leads
    const leads = await Lead.find(query)
      .populate("assignedTo", "firstName lastName email")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: leads,
    });
  } catch (error) {
    console.error("Error fetching leads:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching leads",
      error: error.message,
    });
  }
};

/**
 * Get lead by ID
 */
exports.getLeadById = async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findById(id)
      .populate("assignedTo", "firstName lastName email")
      .populate({
        path: "tasks",
        select: "title description dueDate status priority type",
        options: { sort: { dueDate: 1 } },
      })
      .lean();

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Role-based permissions check
    if (
      req.user.role === "sales_agent" &&
      lead.assignedTo._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this lead",
      });
    } else if (req.user.role === "sales_manager") {
      // Manager can view if it's their lead or assigned to their team
      const isOwnLead =
        lead.assignedTo._id.toString() === req.user._id.toString();

      if (!isOwnLead) {
        const agent = await User.findById(lead.assignedTo._id);
        const isTeamMember =
          agent &&
          agent.manager &&
          agent.manager.toString() === req.user._id.toString();

        if (!isTeamMember) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to view this lead",
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: lead,
    });
  } catch (error) {
    console.error(`Error fetching lead ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      message: "Error fetching lead",
      error: error.message,
    });
  }
};

/**
 * Create a new lead
 */
// Update in createLead function
exports.createLead = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phoneNumber,
      company,
      status,
      tags,
      assignedTo,
      notes,
    } = req.body;

    // Validate required fields
    if (!fullName) {
      console.log('here');
      return res.status(400).json({
        success: false,
        message: "Full name is required",
      });
    }

    // Validate assigned agent if provided
    if (assignedTo) {
      const agent = await User.findById(assignedTo);

      if (
        !agent ||
        (agent.role !== "sales_agent" && agent.role !== "sales_manager")
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid sales agent or manager ID",
        });
      }
    }

    // Create new lead
    const newLead = new Lead({
      fullName,
      email,
      phoneNumber,
      company,
      status: status || "new",
      tags: tags || [],
      assignedTo: assignedTo || req.user._id, // Default to current user
      notes,
      createdAt: Date.now(),
    });

    await newLead.save();

    console.log("New lead created:", newLead);  

    // Automatically create a task for the new lead
    const taskAssignee = assignedTo || req.user._id;
    const newTask = new Task({
      leadId: newLead._id,
      title: `New lead: ${fullName} - Initial Contact`,
      description: `A new lead (${fullName}) has been added to the system. Please review their information and make initial contact.`,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Due date is tomorrow
      priority: "medium",
      type: "follow-up",
      status: "pending",
      assignedTo: taskAssignee,
      createdBy: req.user._id,
    });

    await newTask.save();

    // Add task to lead's tasks array
    newLead.tasks = [newTask._id];
    newLead.nextFollowUp = newTask.dueDate;
    await newLead.save();

    // Return the created lead with populated fields
    const createdLead = await Lead.findById(newLead._id).populate(
      "assignedTo",
      "firstName lastName email"
    );

    res.status(201).json({
      success: true,
      message: "Lead created successfully",
      data: createdLead,
    });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({
      success: false,
      message: "Error creating lead",
      error: error.message,
    });
  }
};

/**
 * Update a lead
 */
exports.updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = { ...req.body };

    // Find lead
    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Check permissions - only assigned agent, their manager, or admin can update
    if (
      req.user.role === "sales_agent" &&
      lead.assignedTo.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update this lead",
      });
    } else if (req.user.role === "sales_manager") {
      const isOwnLead = lead.assignedTo.toString() === req.user._id.toString();

      if (!isOwnLead) {
        const agent = await User.findById(lead.assignedTo);
        const isTeamMember =
          agent &&
          agent.manager &&
          agent.manager.toString() === req.user._id.toString();

        if (!isTeamMember) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to update this lead",
          });
        }
      }
    }

    // Update lead
    const updatedLead = await Lead.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).populate("assignedTo", "firstName lastName email");

    res.json({
      success: true,
      message: "Lead updated successfully",
      data: updatedLead,
    });
  } catch (error) {
    console.error(`Error updating lead ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error updating lead",
      error: error.message,
    });
  }
};

/**
 * Delete a lead
 */
exports.deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    // Find lead
    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Check permissions - only admin or the manager of the assigned agent can delete
    if (req.user.role === "sales_agent") {
      return res.status(403).json({
        success: false,
        message: "Sales agents cannot delete leads",
      });
    } else if (req.user.role === "sales_manager") {
      const isOwnLead = lead.assignedTo.toString() === req.user._id.toString();

      if (!isOwnLead) {
        const agent = await User.findById(lead.assignedTo);
        const isTeamMember =
          agent &&
          agent.manager &&
          agent.manager.toString() === req.user._id.toString();

        if (!isTeamMember) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to delete this lead",
          });
        }
      }
    }

    // Delete related tasks
    if (lead.tasks && lead.tasks.length > 0) {
      await Task.deleteMany({
        _id: { $in: lead.tasks },
      });
    }

    // Delete the lead
    await Lead.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Lead and related tasks deleted successfully",
    });
  } catch (error) {
    console.error(`Error deleting lead ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error deleting lead",
      error: error.message,
    });
  }
};

/**
 * Assign a lead to an agent
 */
exports.assignLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;

    if (!assignedTo) {
      return res.status(400).json({
        success: false,
        message: "Assigned agent ID is required",
      });
    }

    // Find lead
    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Check permissions
    if (req.user.role === "sales_agent") {
      return res.status(403).json({
        success: false,
        message: "Sales agents cannot reassign leads",
      });
    }

    // For managers, check if they manage the lead's current agent and the new agent
    if (req.user.role === "sales_manager") {
      // Check if manager owns the lead
      const isOwnLead = lead.assignedTo.toString() === req.user._id.toString();

      if (!isOwnLead) {
        // Check if manager manages the current agent
        const currentAgent = await User.findById(lead.assignedTo);
        const managesCurrentAgent =
          currentAgent &&
          currentAgent.manager &&
          currentAgent.manager.toString() === req.user._id.toString();

        if (!managesCurrentAgent) {
          return res.status(403).json({
            success: false,
            message: "You do not have permission to reassign this lead",
          });
        }
      }

      // Check if manager manages the new agent
      const newAgent = await User.findById(assignedTo);
      if (!newAgent) {
        return res.status(404).json({
          success: false,
          message: "Assigned agent not found",
        });
      }

      const managesNewAgent =
        newAgent._id.toString() === req.user._id.toString() ||
        (newAgent.manager &&
          newAgent.manager.toString() === req.user._id.toString());

      if (!managesNewAgent) {
        return res.status(403).json({
          success: false,
          message: "You can only assign leads to yourself or your team members",
        });
      }
    }

    // Admin can assign to any agent - no additional checks needed

    // Update the lead
    lead.assignedTo = assignedTo;
    await lead.save();

    // Return the updated lead
    const updatedLead = await Lead.findById(id).populate(
      "assignedTo",
      "firstName lastName email"
    );

    res.json({
      success: true,
      message: "Lead assigned successfully",
      data: updatedLead,
    });
  } catch (error) {
    console.error(`Error assigning lead ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error assigning lead",
      error: error.message,
    });
  }
};

/**
 * Add tags to a lead
 */
exports.updateTags = async (req, res) => {
  try {
    const { id } = req.params;
    const { tags, action } = req.body;

    if (!tags || !Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        message: "Tags array is required",
      });
    }

    if (!action || !["add", "remove", "set"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Valid action (add, remove, or set) is required",
      });
    }

    // Find lead
    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Check permissions
    if (
      req.user.role === "sales_agent" &&
      lead.assignedTo.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update tags for this lead",
      });
    }

    let updateOperation;

    // Perform the requested tag operation
    switch (action) {
      case "add":
        // Add tags (avoiding duplicates)
        updateOperation = {
          $addToSet: { tags: { $each: tags } },
        };
        break;
      case "remove":
        // Remove tags
        updateOperation = {
          $pull: { tags: { $in: tags } },
        };
        break;
      case "set":
        // Replace all tags
        updateOperation = {
          $set: { tags: tags },
        };
        break;
    }

    // Update lead
    const updatedLead = await Lead.findByIdAndUpdate(id, updateOperation, {
      new: true,
      runValidators: true,
    }).populate("assignedTo", "firstName lastName email");

    res.status(200).json({
      success: true,
      message: "Tags updated successfully",
      data: updatedLead,
    });
  } catch (error) {
    console.error(`Error updating tags for lead ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: "Error updating tags",
      error: error.message,
    });
  }
};

exports.getAgentLeads = async (req, res) => {
  try {
    const agentId = req.user._id;

    // Verify this is a sales agent
    if (req.user.role !== "sales_agent") {
      return res.status(403).json({
        message: "Not authorized. This endpoint is for sales agents only.",
      });
    }

    // Build query filters
    const { status, search, sortBy, sortOrder } = req.query;
    const query = { assignedTo: agentId };

    // Filter by status if provided
    if (status && status !== "all") {
      query.status = status;
    }

    // Search filter if provided
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { company: { $regex: search, $options: "i" } },
      ];
    }

    // Sorting options
    let sort = {};
    if (sortBy) {
      sort[sortBy] = sortOrder === "desc" ? -1 : 1;
    } else {
      // Default sort by createdAt desc
      sort = { createdAt: -1 };
    }

    // Get assigned leads
    const leads = await Lead.find(query)
      .sort(sort)
      .populate("assignedTo", "firstName lastName email")
      .populate("tasks");

    // Get count of leads by status for statistics
    const statusCounts = await Lead.aggregate([
      { $match: { assignedTo: agentId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    // Format status counts
    const counts = {};
    statusCounts.forEach((status) => {
      counts[status._id] = status.count;
    });

    // Calculate total leads
    const totalLeads = leads.length;

    // Return result
    res.json({
      data: leads,
      counts: {
        total: totalLeads,
        new: counts.new || 0,
        contacted: counts.contacted || 0,
        qualified: counts.qualified || 0,
        converted: counts.converted || 0,
        lost: counts.lost || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching agent leads:", error);
    res
      .status(500)
      .json({ message: "Error fetching leads", error: error.message });
  }
};
