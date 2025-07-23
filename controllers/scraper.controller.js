const axios = require("axios");
const ScraperJob = require("../models/scraperJob");

// Configuration for the Python scraper API
const SCRAPER_API_URL =
  process.env.SCRAPER_API_URL || "http://127.0.0.1:5004/api";

/**
 * Start a new scraping job
 */
exports.startJob = async (req, res) => {
  try {
    const {
      region,
      scrolls = 10,
      getDetails = true,
      detailLimit,
      maxWorkers = 2,
      exportCsv = false,
    } = req.body;

    // Validate required fields
    if (!region) {
      return res
        .status(400)
        .json({ success: false, message: "Region is required" });
    }

    // Request payload for Python API (map to snake_case for Python)
    const payload = {
      region,
      scrolls,
      get_details: getDetails,
      max_workers: maxWorkers,
      export_csv: exportCsv,
    };

    // Add detail_limit if provided
    if (detailLimit !== undefined) {
      payload.detail_limit = detailLimit;
    }

    // Start the scraping job via Python API
    const response = await axios.post(`${SCRAPER_API_URL}/scrape`, payload);
    const jobData = response.data;

    // Create job record in MongoDB
    const newJob = new ScraperJob({
      jobId: jobData.job_id,
      region,
      status: "running",
      scrolls,
      getDetails,
      detailLimit,
      maxWorkers,
      exportCsv,
      startTime: new Date(),
      settings: jobData.settings || {},
    });

    await newJob.save();

    return res.status(202).json({
      success: true,
      message: "Scraping job started successfully",
      job: {
        id: newJob._id,
        jobId: newJob.jobId,
        region: newJob.region,
        status: newJob.status,
        settings: newJob.settings,
      },
    });
  } catch (error) {
    console.error("Error starting scraper job:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to start scraping job",
      error: error.message,
    });
  }
};

/**
 * Get all scraping jobs
 */
exports.getJobs = async (req, res) => {
  try {
    // Query options
    const options = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
      sort: { createdAt: -1 },
    };

    // Build query based on filters
    const query = {};

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.region) {
      query.region = new RegExp(req.query.region, "i");
    }

    // Get jobs without restaurant data (for list view)
    const jobs = await ScraperJob.find(query, { restaurants: 0, rawData: 0 })
      .sort(options.sort)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit);

    const total = await ScraperJob.countDocuments(query);

    // Also check Python API for active jobs that might not be in our database
    try {
      const pythonJobsResponse = await axios.get(`${SCRAPER_API_URL}/jobs`);
      const pythonJobs = pythonJobsResponse.data.jobs || {};

      // Check if any Python jobs are missing from our database
      const ourJobIds = jobs.map((job) => job.jobId);
      const missingJobs = Object.keys(pythonJobs).filter(
        (jobId) =>
          !ourJobIds.includes(jobId) && pythonJobs[jobId].status === "running"
      );

      if (missingJobs.length > 0) {
        // Just add a note in the response, we could sync these if needed
        return res.status(200).json({
          success: true,
          data: {
            jobs,
            pagination: {
              total,
              page: options.page,
              limit: options.limit,
              pages: Math.ceil(total / options.limit),
            },
            note: `Found ${missingJobs.length} active jobs in Python API that are not in the database.`,
          },
        });
      }
    } catch (apiError) {
      console.warn(
        "Could not check Python API for missing jobs:",
        apiError.message
      );
      // Continue with the regular response
    }

    return res.status(200).json({
      success: true,
      data: {
        jobs,
        pagination: {
          total,
          page: options.page,
          limit: options.limit,
          pages: Math.ceil(total / options.limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching scraper jobs:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch scraping jobs",
      error: error.message,
    });
  }
};

/**
 * Get a specific job by ID
 */
exports.getJobById = async (req, res) => {
  try {
    const { id } = req.params;

    // First try to find by MongoDB _id
    let job = await ScraperJob.findById(id);

    // If not found, try to find by jobId
    if (!job) {
      job = await ScraperJob.findOne({ jobId: id });
    }

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Scraping job not found",
      });
    }

    // Check if detailed results are requested
    const excludeResults = req.query.results === "false";

    // If job is running or pending, check with Python API for status updates
    if (job.status === "running" || job.status === "pending") {
      try {
        const statusResponse = await axios.get(
          `${SCRAPER_API_URL}/jobs/${job.jobId}`
        );
        const pythonStatus = statusResponse.data;

        // Update job status if changed
        if (pythonStatus.status && pythonStatus.status !== job.status) {
          job.status = mapPythonStatus(pythonStatus.status);

          // Update progress info if available
          if (pythonStatus.progress) {
            job.progress = pythonStatus.progress;
          }

          // Update restaurant count if available
          if (pythonStatus.restaurants_count) {
            job.restaurantCount = pythonStatus.restaurants_count;
          }

          // Check for file information
          if (pythonStatus.result_file) {
            job.resultFile = pythonStatus.result_file;
          }

          if (pythonStatus.csv_file) {
            job.csvFile = pythonStatus.csv_file;
          }

          // If completed, fetch the results
          if (job.status === "completed" && !excludeResults) {
            // Include data parameter to control whether full data is included
            const resultsResponse = await axios.get(
              `${SCRAPER_API_URL}/results/${
                job.jobId
              }?include_data=${!excludeResults}`
            );
            const resultsData = resultsResponse.data;

            // Update job with results data
            if (resultsData.completion_time) {
              job.completionTime = new Date(resultsData.completion_time * 1000);
            }

            job.restaurantCount =
              resultsData.count || resultsData.data_size || 0;

            // Only update restaurants if include_data was true
            if (resultsData.data) {
              job.restaurants = resultsData.data;
            }

            job.rawData = resultsData;
          }

          // If failed or error, update error message
          if (job.status === "failed" || job.status === "error") {
            job.error = pythonStatus.error || "Unknown error occurred";
          }

          await job.save();
        }
      } catch (apiError) {
        console.error("Error fetching job status from Python API:", apiError);
        // Don't fail the request if Python API is down, just continue with DB data
      }
    }

    // Return job without large data fields if requested
    if (excludeResults) {
      const { restaurants, rawData, ...jobData } = job.toObject();
      return res.status(200).json({
        success: true,
        data: jobData,
      });
    }

    return res.status(200).json({
      success: true,
      data: job,
    });
  } catch (error) {
    console.error("Error fetching scraper job:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch scraping job",
      error: error.message,
    });
  }
};

/**
 * Sync job data with Python API
 */
exports.syncJob = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the job
    let job = await ScraperJob.findOne({
      $or: [{ _id: id }, { jobId: id }],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Scraping job not found",
      });
    }

    // Get status from Python API
    const statusResponse = await axios.get(
      `${SCRAPER_API_URL}/jobs/${job.jobId}`
    );
    const pythonStatus = statusResponse.data;

    // Update status
    job.status = mapPythonStatus(pythonStatus.status);

    // Update file information if available
    if (pythonStatus.result_file) {
      job.resultFile = pythonStatus.result_file;
    }

    if (pythonStatus.csv_file) {
      job.csvFile = pythonStatus.csv_file;
    }

    // If completed, get results
    if (job.status === "completed") {
      // Get results with full data
      const resultsResponse = await axios.get(
        `${SCRAPER_API_URL}/results/${job.jobId}`
      );
      const resultsData = resultsResponse.data;

      if (resultsData.completion_time) {
        job.completionTime = new Date(resultsData.completion_time * 1000);
      }

      job.restaurantCount = resultsData.count || 0;

      // Only update if we have data
      if (resultsData.data) {
        job.restaurants = resultsData.data;
      }

      job.rawData = resultsData;
    } else if (job.status === "failed" || job.status === "error") {
      job.error = pythonStatus.error || "Unknown error occurred";
    }

    await job.save();

    return res.status(200).json({
      success: true,
      message: "Job synchronized successfully",
      data: job,
    });
  } catch (error) {
    console.error("Error syncing job:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sync job with Python API",
      error: error.message,
    });
  }
};

/**
 * Delete a job
 */
exports.deleteJob = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the job first to get the jobId
    const job = await ScraperJob.findOne({
      $or: [{ _id: id }, { jobId: id }],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Scraping job not found",
      });
    }

    // Try to clean up on Python API side first
    try {
      await axios.delete(`${SCRAPER_API_URL}/cleanup/${job.jobId}`);
    } catch (apiError) {
      console.warn(
        `Could not clean up Python job ${job.jobId}:`,
        apiError.message
      );
      // Continue with deletion even if Python API cleanup fails
    }

    // Now delete from our database
    await ScraperJob.findOneAndDelete({
      _id: job._id,
    });

    return res.status(200).json({
      success: true,
      message: "Scraping job deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting job:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete scraping job",
      error: error.message,
    });
  }
};

/**
 * Get restaurants from a specific job
 */
exports.getRestaurants = async (req, res) => {
  try {
    const { id } = req.params;

    // Find the job
    const job = await ScraperJob.findOne({
      $or: [{ _id: id }, { jobId: id }],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Scraping job not found",
      });
    }

    // For completed jobs with no restaurants array but a result file in API
    if (
      job.status === "completed" &&
      (!job.restaurants || job.restaurants.length === 0) &&
      job.resultFile
    ) {
      try {
        // Try to get the results from Python API
        const resultsResponse = await axios.get(
          `${SCRAPER_API_URL}/results/${job.jobId}`
        );

        if (resultsResponse.data.data) {
          job.restaurants = resultsResponse.data.data;
          job.restaurantCount = resultsResponse.data.count;
          await job.save();
        }
      } catch (apiError) {
        console.error(
          "Failed to fetch restaurant data from Python API:",
          apiError
        );
        // Continue with existing data
      }
    }

    if (
      job.status !== "completed" ||
      !job.restaurants ||
      job.restaurants.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot get restaurants; job status is ${job.status} or no restaurants available`,
      });
    }

    // Pagination options
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // Add filter options for restaurant name or cuisine
    let filteredRestaurants = job.restaurants;

    if (req.query.name) {
      const nameRegex = new RegExp(req.query.name, "i");
      filteredRestaurants = filteredRestaurants.filter(
        (r) => r.name && nameRegex.test(r.name)
      );
    }

    if (req.query.cuisine) {
      const cuisineRegex = new RegExp(req.query.cuisine, "i");
      filteredRestaurants = filteredRestaurants.filter(
        (r) => r.cuisine && cuisineRegex.test(r.cuisine)
      );
    }

    // Simple projection for restaurant list with pagination
    const paginatedRestaurants = filteredRestaurants
      .slice((page - 1) * limit, page * limit)
      .map((r) => ({
        id: r.id,
        name: r.name,
        cuisine: r.cuisine,
        rating: r.rating,
        address: r.address,
        url: r.url,
        menuSections: r.menu ? r.menu.length : 0,
        menuItems: r.menu
          ? r.menu.reduce(
              (count, section) =>
                count + (section.items ? section.items.length : 0),
              0
            )
          : 0,
        popularItems: r.popular_items ? r.popular_items.length : 0,
      }));

    return res.status(200).json({
      success: true,
      data: {
        restaurants: paginatedRestaurants,
        pagination: {
          total: filteredRestaurants.length,
          page,
          limit,
          pages: Math.ceil(filteredRestaurants.length / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching restaurants:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch restaurants",
      error: error.message,
    });
  }
};

/**
 * Get a specific restaurant from a job
 */
exports.getRestaurantById = async (req, res) => {
  try {
    const { id, restaurantId } = req.params;

    // Find the job
    const job = await ScraperJob.findOne({
      $or: [{ _id: id }, { jobId: id }],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Scraping job not found",
      });
    }

    // For completed jobs with no restaurants array but a result file in API
    if (
      job.status === "completed" &&
      (!job.restaurants || job.restaurants.length === 0) &&
      job.resultFile
    ) {
      try {
        // Try to get the results from Python API
        const resultsResponse = await axios.get(
          `${SCRAPER_API_URL}/results/${job.jobId}`
        );

        if (resultsResponse.data.data) {
          job.restaurants = resultsResponse.data.data;
          job.restaurantCount = resultsResponse.data.count;
          await job.save();
        }
      } catch (apiError) {
        console.error(
          "Failed to fetch restaurant data from Python API:",
          apiError
        );
        // Continue with existing data
      }
    }

    // Find restaurant in the job results
    const restaurant = job.restaurants.find((r) => r.id === restaurantId);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: "Restaurant not found in job results",
      });
    }

    // Add stats to the restaurant data
    const restaurantWithStats = {
      ...restaurant,
      _stats: {
        menuSections: restaurant.menu ? restaurant.menu.length : 0,
        totalMenuItems: restaurant.menu
          ? restaurant.menu.reduce(
              (count, section) =>
                count + (section.items ? section.items.length : 0),
              0
            )
          : 0,
        popularItems: restaurant.popular_items
          ? restaurant.popular_items.length
          : 0,
      },
    };

    return res.status(200).json({
      success: true,
      data: restaurantWithStats,
    });
  } catch (error) {
    console.error("Error fetching restaurant:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch restaurant",
      error: error.message,
    });
  }
};

/**
 * Get Python API health status
 */
exports.getApiStatus = async (req, res) => {
  try {
    const response = await axios.get(`${SCRAPER_API_URL}/health`);
    return res.status(200).json({
      success: true,
      status: "connected",
      pythonApi: response.data,
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      status: "disconnected",
      error: error.message,
    });
  }
};

/**
 * Helper function to map Python API status to our status values
 */
function mapPythonStatus(pythonStatus) {
  const statusMap = {
    started: "pending",
    running: "running",
    completed: "completed",
    failed: "failed",
    error: "error",
  };

  return statusMap[pythonStatus] || pythonStatus;
}

/**
 * Analyze restaurant menu ingredients and match with your products
 * @param {string} jobId - Job ID
 * @param {string} restaurantId - Restaurant ID
 * @returns {Object} - Ingredient analysis and sales opportunities
 */
exports.analyzeRestaurantIngredients = async (req, res) => {
  try {
    const { jobId, restaurantId } = req.params;

    // Find the job
    const job = await ScraperJob.findOne({
      $or: [{ _id: jobId }, { jobId: jobId }],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Scraping job not found",
      });
    }

    // Find restaurant in the job results
    const encodedRestaurantId = encodeURIComponent(restaurantId);

    // Try to find the restaurant
    let restaurant;
    try {
      // First try direct access from database
      if (job.restaurants && job.restaurants.length > 0) {
        restaurant = job.restaurants.find((r) => r.id === restaurantId);
      }

      // If not found, try the API
      if (!restaurant) {
        const response = await api.get(
          `/scraper/jobs/${jobId}/restaurants/${encodedRestaurantId}`
        );

        if (response.data.__parentArray) {
          restaurant = response.data.__parentArray.find(
            (r) => r.id === restaurantId
          );
        } else {
          restaurant = response.data;
        }
      }

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          message: "Restaurant not found in job results",
        });
      }
    } catch (error) {
      console.error("Error finding restaurant:", error);
      return res.status(404).json({
        success: false,
        message: "Failed to retrieve restaurant data",
      });
    }

    // Extract menu items to analyze
    const menuItems = [];

    // Add menu items from sections
    if (restaurant.menu && restaurant.menu.length > 0) {
      restaurant.menu.forEach((section) => {
        if (section.items && section.items.length > 0) {
          section.items.forEach((item) => {
            menuItems.push({
              name: item.name,
              description: item.description || "",
              price: item.price || "",
            });
          });
        }
      });
    }

    // Add popular items
    if (restaurant.popular_items && restaurant.popular_items.length > 0) {
      restaurant.popular_items.forEach((item) => {
        // Avoid duplicates
        if (!menuItems.some((m) => m.name === item.name)) {
          menuItems.push({
            name: item.name,
            description: item.description || "",
            price: item.price || "",
          });
        }
      });
    }

    if (menuItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No menu items found for analysis",
      });
    }

    const openaiService = require("../services/openaiService");

    // Extract ingredients using OpenAI
    const itemsWithIngredients = await openaiService.extractIngredientsFromMenu(
      menuItems
    );

    // Match with your product catalog
    const analysisResults = await openaiService.matchIngredientsWithItems(
      itemsWithIngredients
    );

    return res.status(200).json({
      success: true,
      data: {
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          cuisine: restaurant.cuisine,
        },
        analysis: analysisResults,
      },
    });
  } catch (error) {
    console.error("Error analyzing restaurant ingredients:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to analyze restaurant ingredients",
      error: error.message,
    });
  }
};
