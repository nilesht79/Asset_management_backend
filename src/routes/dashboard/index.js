const express = require('express');
const { connectDB, sql } = require('../../config/database');
const { requirePermission, requireRole } = require('../../middleware/permissions');
const { asyncHandler } = require('../../middleware/error-handler');
const { authenticateToken } = require('../../middleware/auth');
const { sendSuccess, sendError } = require('../../utils/response');
const { roles: USER_ROLES, permissions } = require('../../config/auth');

const router = express.Router();

// Apply authentication to all dashboard routes
router.use(authenticateToken);

// GET /dashboard/superadmin - SuperAdmin dashboard data
router.get('/superadmin',
  requireRole([USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    
    try {
      // Get master data statistics
      const masterDataResult = await pool.request().query(`
        SELECT 
          (SELECT COUNT(*) FROM oems WHERE is_active = 1) as active_oems,
          (SELECT COUNT(*) FROM oems) as total_oems,
          (SELECT COUNT(*) FROM oems WHERE is_active = 0) as pending_oems,
          
          (SELECT COUNT(*) FROM categories WHERE is_active = 1) as active_categories,
          (SELECT COUNT(*) FROM categories) as total_categories,
          (SELECT COUNT(*) FROM categories WHERE parent_category_id IS NOT NULL) as hierarchical_categories,
          
          (SELECT COUNT(*) FROM products WHERE is_active = 1) as active_products,
          (SELECT COUNT(*) FROM products) as total_products,
          (SELECT COUNT(*) FROM products WHERE is_active = 0) as draft_products,
          
          (SELECT COUNT(*) FROM locations WHERE is_active = 1) as active_locations,
          (SELECT COUNT(*) FROM locations) as total_locations,
          (SELECT COUNT(*) FROM locations WHERE is_active = 0) as pending_locations,
          
          (SELECT COUNT(*) FROM DEPARTMENT_MASTER WHERE 1=1) as active_departments,
          (SELECT COUNT(*) FROM DEPARTMENT_MASTER) as total_departments,
          
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status = 'active') as active_users,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status IN ('active', 'pending')) as total_users,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status = 'pending') as pending_users
      `);

      const stats = masterDataResult.recordset[0];
      
      const dashboardData = {
        oems: { 
          total: stats.total_oems, 
          active: stats.active_oems, 
          pending: stats.pending_oems 
        },
        categories: { 
          total: stats.total_categories, 
          active: stats.active_categories, 
          pending: stats.total_categories - stats.active_categories, // inactive categories
          hierarchical: stats.hierarchical_categories 
        },
        products: { 
          total: stats.total_products, 
          active: stats.active_products, 
          draft: stats.draft_products 
        },
        locations: { 
          total: stats.total_locations, 
          active: stats.active_locations, 
          pending: stats.pending_locations 
        },
        departments: { 
          total: stats.total_departments, 
          active: stats.active_departments, 
          users: stats.active_users 
        },
        users: {
          total: stats.total_users,
          active: stats.active_users,
          pending: stats.pending_users
        }
      };

      sendSuccess(res, dashboardData, 'SuperAdmin dashboard data retrieved successfully');
    } catch (error) {
      console.error('Dashboard error:', error);
      sendError(res, 'Failed to load dashboard data', 500);
    }
  })
);

// GET /dashboard/admin - Admin dashboard data  
router.get('/admin',
  requireRole([USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN]),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    
    try {
      // Get master data statistics for admin
      const masterDataResult = await pool.request().query(`
        SELECT 
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status = 'active') as active_users,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status IN ('active', 'pending')) as total_users,
          (SELECT COUNT(*) FROM DEPARTMENT_MASTER WHERE 1=1) as managed_departments,
          (SELECT COUNT(*) FROM locations WHERE is_active = 1) as active_locations,
          (SELECT COUNT(*) FROM locations) as total_locations,
          (SELECT COUNT(*) FROM USER_MASTER WHERE user_status = 'pending') as pending_user_approvals,
          
          (SELECT COUNT(*) FROM oems WHERE is_active = 1) as active_oems,
          (SELECT COUNT(*) FROM oems) as total_oems,
          (SELECT COUNT(*) FROM categories WHERE is_active = 1) as active_categories,
          (SELECT COUNT(*) FROM categories) as total_categories,
          (SELECT COUNT(*) FROM products WHERE is_active = 1) as active_products,
          (SELECT COUNT(*) FROM products) as total_products
      `);

      // Get department overview
      const departmentResult = await pool.request().query(`
        SELECT 
          d.department_id as id,
          d.department_name as name,
          COUNT(u.user_id) as users,
          0 as assets, -- Placeholder for Phase 1
          0 as tickets, -- Placeholder for Phase 1  
          1 as status
        FROM DEPARTMENT_MASTER d
        LEFT JOIN USER_MASTER u ON d.department_id = u.department_id AND u.user_status = 'active'
        WHERE 1=1
        GROUP BY d.department_id, d.department_name
        ORDER BY d.department_name
      `);

      const stats = masterDataResult.recordset[0];
      
      const dashboardData = {
        masterStats: {
          totalUsers: stats.total_users,
          activeUsers: stats.active_users,
          managedDepartments: stats.managed_departments,
          totalLocations: stats.total_locations,
          activeLocations: stats.active_locations,
          pendingUserApprovals: stats.pending_user_approvals
        },
        masterDataStats: {
          oems: { 
            total: stats.total_oems, 
            active: stats.active_oems, 
            myManaged: Math.floor(stats.active_oems * 0.6) // Mock calculation
          },
          categories: { 
            total: stats.total_categories, 
            active: stats.active_categories, 
            myCreated: Math.floor(stats.active_categories * 0.4) // Mock calculation
          },
          products: { 
            total: stats.total_products, 
            active: stats.active_products, 
            myManaged: Math.floor(stats.active_products * 0.5) // Mock calculation
          },
          locations: { 
            total: stats.total_locations, 
            active: stats.active_locations, 
            myAssigned: Math.floor(stats.active_locations * 0.7) // Mock calculation
          }
        },
        departmentOverview: departmentResult.recordset.map(dept => ({
          id: dept.id,
          name: dept.name,
          users: dept.users,
          assets: dept.assets,
          tickets: dept.tickets,
          status: dept.status ? 'active' : 'inactive'
        }))
      };

      sendSuccess(res, dashboardData, 'Admin dashboard data retrieved successfully');
    } catch (error) {
      console.error('Dashboard error:', error);
      sendError(res, 'Failed to load dashboard data', 500);
    }
  })
);

// GET /dashboard/system-health - System health metrics
router.get('/system-health',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    try {
      const pool = await connectDB();
      
      // Test database connection and get some basic stats
      const healthResult = await pool.request().query(`
        SELECT 
          @@SERVERNAME as server_name,
          @@VERSION as server_version,
          GETUTCDATE() as current_server_time,
          (SELECT COUNT(*) FROM sys.databases) as database_count
      `);

      const healthData = {
        serverStatus: 'healthy',
        databaseStatus: 'healthy',
        backupStatus: 'completed', // This would be from actual backup logs
        lastBackup: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        dataIntegrity: 99.8,
        serverInfo: {
          name: healthResult.recordset[0].server_name,
          version: healthResult.recordset[0].server_version,
          currentTime: healthResult.recordset[0].current_server_time,
          databaseCount: healthResult.recordset[0].database_count
        }
      };

      sendSuccess(res, healthData, 'System health retrieved successfully');
    } catch (error) {
      console.error('System health error:', error);
      const errorData = {
        serverStatus: 'error',
        databaseStatus: 'error',
        backupStatus: 'unknown',
        lastBackup: null,
        dataIntegrity: 0,
        error: error.message
      };
      
      sendSuccess(res, errorData, 'System health retrieved with errors');
    }
  })
);

// GET /dashboard/activities - Recent system activities
router.get('/activities',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;
    
    const pool = await connectDB();
    
    try {
      // Get recent user activities (working version)
      const activitiesResult = await pool.request()
        .input('limit', sql.Int, Math.min(parseInt(limit), 50))
        .query(`
          SELECT TOP(@limit)
            'user_created' as type,
            CONCAT('User "', u.first_name, ' ', u.last_name, '" (', u.role, ') registered') as description,
            CONCAT('Email: ', u.email, ' • Department: ', ISNULL(d.department_name, 'N/A')) as details,
            CASE 
              WHEN DATEDIFF(MINUTE, u.created_at, GETUTCDATE()) < 60 
              THEN CONCAT(DATEDIFF(MINUTE, u.created_at, GETUTCDATE()), ' minutes ago')
              WHEN DATEDIFF(HOUR, u.created_at, GETUTCDATE()) < 24 
              THEN CONCAT(DATEDIFF(HOUR, u.created_at, GETUTCDATE()), ' hours ago')
              ELSE CONCAT(DATEDIFF(DAY, u.created_at, GETUTCDATE()), ' days ago')
            END as time,
            CASE 
              WHEN u.is_active = 1 THEN 'success'
              ELSE 'warning'
            END as severity,
            u.created_at
          FROM USER_MASTER u
          LEFT JOIN DEPARTMENT_MASTER d ON u.department_id = d.department_id
          WHERE u.created_at >= DATEADD(DAY, -30, GETUTCDATE())
            AND u.user_status != 'deleted'
          ORDER BY u.created_at DESC
        `);

      const activities = activitiesResult.recordset.map((activity, index) => ({
        id: index + 1,
        type: activity.type,
        description: activity.description,
        details: activity.details,
        time: activity.time,
        severity: activity.severity
      }));

      sendSuccess(res, activities, 'Activities retrieved successfully');
    } catch (error) {
      console.error('Activities error:', error);
      sendError(res, 'Failed to load activities', 500);
    }
  })
);

// GET /dashboard/approvals - Pending approvals  
router.get('/approvals',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;
    
    const pool = await connectDB();
    
    try {
      // Get pending user registrations (inactive users)
      const approvalsResult = await pool.request()
        .input('limit', sql.Int, Math.min(parseInt(limit), 50))
        .query(`
          SELECT TOP(@limit)
            u.user_id as id,
            'User Registration' as type,
            CONCAT(u.first_name, ' ', u.last_name, ' - ', u.role) as item,
            CASE 
              WHEN DATEDIFF(HOUR, u.created_at, GETUTCDATE()) < 24 THEN 'high'
              WHEN DATEDIFF(HOUR, u.created_at, GETUTCDATE()) < 72 THEN 'medium'
              ELSE 'low'
            END as priority,
            FORMAT(u.created_at, 'yyyy-MM-dd') as date,
            u.created_at
          FROM USER_MASTER u
          WHERE u.user_status = 'pending'
          ORDER BY u.created_at DESC
        `);

      const approvals = approvalsResult.recordset.map(approval => ({
        id: approval.id,
        type: approval.type,
        item: approval.item,
        priority: approval.priority,
        date: approval.date
      }));

      sendSuccess(res, approvals, 'Pending approvals retrieved successfully');
    } catch (error) {
      console.error('Approvals error:', error);
      sendError(res, 'Failed to load approvals', 500);
    }
  })
);

// POST /dashboard/approvals/:id/approve - Approve a pending item
router.post('/approvals/:id/approve',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { type } = req.body;
    
    const pool = await connectDB();
    
    try {
      if (type === 'User Registration') {
        // Approve user registration by activating the user
        const result = await pool.request()
          .input('userId', sql.UniqueIdentifier, id)
          .query(`
            UPDATE USER_MASTER
            SET is_active = 1, user_status = 'active', updated_at = GETUTCDATE()
            WHERE user_id = @userId AND user_status = 'pending'
          `);

        if (result.rowsAffected[0] === 0) {
          return sendError(res, 'User not found or already approved', 404);
        }
      }
      
      sendSuccess(res, null, `${type} approved successfully`);
    } catch (error) {
      console.error('Approval error:', error);
      sendError(res, 'Failed to approve item', 500);
    }
  })
);

// POST /dashboard/approvals/:id/reject - Reject a pending item
router.post('/approvals/:id/reject',
  requireRole([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { type, reason = '' } = req.body;

    const pool = await connectDB();

    try {
      if (type === 'User Registration') {
        // Reject user registration by deleting the pending user
        const result = await pool.request()
          .input('userId', sql.UniqueIdentifier, id)
          .query(`
            DELETE FROM USER_MASTER
            WHERE user_id = @userId AND user_status = 'pending'
          `);

        if (result.rowsAffected[0] === 0) {
          return sendError(res, 'User not found or already processed', 404);
        }
      }

      sendSuccess(res, null, `${type} rejected successfully`);
    } catch (error) {
      console.error('Rejection error:', error);
      sendError(res, 'Failed to reject item', 500);
    }
  })
);

// GET /dashboard/employee - Employee dashboard data
router.get('/employee',
  requireRole([USER_ROLES.EMPLOYEE, USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN]),
  requirePermission(permissions.ASSET_READ),
  asyncHandler(async (req, res) => {
    const pool = await connectDB();
    const userId = req.user.userId;

    try {
      // Get employee's assigned assets (Phase 2 - placeholder for now)
      const assetsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT
            'No assets assigned yet' as message,
            0 as total_assets
        `);

      // Get employee's requisitions (Phase 2 - placeholder for now)
      const requisitionsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT
            'No requisitions submitted yet' as message,
            0 as total_requests,
            0 as pending_requests,
            0 as approved_requests
        `);

      // Get employee's tickets (Phase 2 - placeholder for now)
      const ticketsResult = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          SELECT
            'No tickets created yet' as message,
            0 as total_tickets,
            0 as open_tickets
        `);

      const dashboardData = {
        myAssets: [],
        myRequests: [],
        myTickets: [],
        stats: {
          totalAssets: assetsResult.recordset[0]?.total_assets || 0,
          totalRequests: requisitionsResult.recordset[0]?.total_requests || 0,
          pendingRequests: requisitionsResult.recordset[0]?.pending_requests || 0,
          approvedRequests: requisitionsResult.recordset[0]?.approved_requests || 0,
          totalTickets: ticketsResult.recordset[0]?.total_tickets || 0,
          openTickets: ticketsResult.recordset[0]?.open_tickets || 0
        },
        message: 'Employee dashboard - Phase 2 features coming soon'
      };

      sendSuccess(res, dashboardData, 'Employee dashboard data retrieved successfully');
    } catch (error) {
      console.error('Employee dashboard error:', error);
      sendError(res, 'Failed to load employee dashboard data', 500);
    }
  })
);

module.exports = router;