const express = require('express');
const { authenticateToken } = require('../../middleware/auth');
const { requireDynamicPermission } = require('../../middleware/permissions');

// Import master route modules
const oemRoutes = require('./oem');
const categoryRoutes = require('./categories');
const subcategoryRoutes = require('./subcategories');
const productRoutes = require('./products');
const locationRoutes = require('./locations');
const locationTypesRoutes = require('./location-types');
const clientsRoutes = require('./clients');
const productTypeRoutes = require('./product-types');
const productSeriesRoutes = require('./product-series');
const pincodeLookupRoutes = require('./pincode-lookup');
const componentFieldTemplatesRoutes = require('./componentFieldTemplates');

const router = express.Router();

// Apply authentication to all master routes
router.use(authenticateToken);

// Mount route modules
router.use('/oem', oemRoutes);
router.use('/categories', categoryRoutes);
router.use('/subcategories', subcategoryRoutes);
router.use('/products', productRoutes);
router.use('/locations', locationRoutes);
router.use('/location-types', locationTypesRoutes);
router.use('/clients', clientsRoutes);
router.use('/product-types', productTypeRoutes);
router.use('/product-series', productSeriesRoutes);
router.use('/pincode-lookup', pincodeLookupRoutes);
router.use('/component-field-templates', componentFieldTemplatesRoutes);

// Master data overview endpoint
router.get('/', 
  requireDynamicPermission(),
  async (req, res) => {
    try {
      res.status(200).json({
        success: true,
        message: 'Master data endpoints',
        data: {
          endpoints: {
            oem: '/masters/oem',
            categories: '/masters/categories',
            subcategories: '/masters/subcategories',
            products: '/masters/products',
            locations: '/masters/locations',
            locationTypes: '/masters/location-types',
            clients: '/masters/clients',
            productTypes: '/masters/product-types',
            productSeries: '/masters/product-series',
            pincodeLookup: '/masters/pincode-lookup',
            componentFieldTemplates: '/masters/component-field-templates'
          },
          description: 'Master data management endpoints for the Asset Management System'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve master data information',
        timestamp: new Date().toISOString()
      });
    }
  }
);

module.exports = router;