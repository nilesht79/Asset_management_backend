const express = require('express');
const axios = require('axios');

const { asyncHandler } = require('../../middleware/error-handler');
const { sendSuccess, sendError } = require('../../utils/response');

const router = express.Router();

// GET /masters/pincode-lookup/:pincode - Lookup pincode details
router.get('/:pincode',
  asyncHandler(async (req, res) => {
    const { pincode } = req.params;

    // Validate pincode format (6 digits)
    if (!/^\d{6}$/.test(pincode)) {
      return sendError(res, 'Invalid pincode format. Pincode must be 6 digits.', 400);
    }

    try {
      // Call India Post API for pincode lookup
      const response = await axios.get(`http://www.postalpincode.in/api/pincode/${pincode}`, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Asset-Management-System'
        }
      });

      const data = response.data;

      // Check if API returned valid data
      if (data.Status === 'Error' || !data.PostOffice || data.PostOffice.length === 0) {
        return sendError(res, 'No data found for this pincode', 404);
      }

      // Extract unique city and state from post office data
      const postOffices = data.PostOffice;
      const uniqueStates = [...new Set(postOffices.map(office => office.State))];
      const uniqueDistricts = [...new Set(postOffices.map(office => office.District))];
      
      // Get the primary post office (usually the first one)
      const primaryOffice = postOffices[0];

      const locationData = {
        pincode: pincode,
        state: primaryOffice.State,
        district: primaryOffice.District,
        city: primaryOffice.District, // Using district as city for consistency
        area: primaryOffice.Name, // Post office name as area
        postOffices: postOffices.map(office => ({
          name: office.Name,
          type: office.BranchType,
          delivery: office.DeliveryStatus,
          division: office.Division,
          region: office.Region,
          circle: office.Circle
        })),
        alternativeStates: uniqueStates,
        alternativeDistricts: uniqueDistricts
      };

      sendSuccess(res, locationData, 'Pincode details retrieved successfully');

    } catch (error) {
      console.error('Pincode lookup error:', error.message);
      
      if (error.code === 'ECONNABORTED') {
        return sendError(res, 'Request timeout. Please try again.', 408);
      }
      
      if (error.response && error.response.status === 404) {
        return sendError(res, 'No data found for this pincode', 404);
      }

      return sendError(res, 'Failed to lookup pincode. Please try again later.', 500);
    }
  })
);

module.exports = router;