/**
 * Validators for Standby Assets and Assignments
 */

const Joi = require('joi');

const standbyValidators = {
  // Validate assign standby asset request
  assignStandby: Joi.object({
    user_id: Joi.string().uuid().required()
      .messages({
        'string.guid': 'Invalid user ID format',
        'any.required': 'User ID is required'
      }),

    standby_asset_id: Joi.string().uuid().required()
      .messages({
        'string.guid': 'Invalid standby asset ID format',
        'any.required': 'Standby asset ID is required'
      }),

    original_asset_id: Joi.string().uuid().allow(null).optional()
      .messages({
        'string.guid': 'Invalid original asset ID format'
      }),

    reason: Joi.string().min(5).max(500).required()
      .messages({
        'string.min': 'Reason must be at least 5 characters',
        'string.max': 'Reason cannot exceed 500 characters',
        'any.required': 'Reason is required'
      }),

    reason_category: Joi.string().valid('repair', 'maintenance', 'lost', 'stolen', 'other').required()
      .messages({
        'any.only': 'Reason category must be one of: repair, maintenance, lost, stolen, other',
        'any.required': 'Reason category is required'
      }),

    expected_return_date: Joi.date().min('now').allow(null).optional()
      .messages({
        'date.min': 'Expected return date cannot be in the past'
      }),

    notes: Joi.string().max(1000).allow('', null).optional()
      .messages({
        'string.max': 'Notes cannot exceed 1000 characters'
      })
  }),

  // Validate return standby asset request
  returnStandby: Joi.object({
    return_notes: Joi.string().max(1000).allow('', null).optional()
      .messages({
        'string.max': 'Return notes cannot exceed 1000 characters'
      })
  }),

  // Validate make permanent request
  makePermanent: Joi.object({
    notes: Joi.string().max(1000).allow('', null).optional()
      .messages({
        'string.max': 'Notes cannot exceed 1000 characters'
      })
  }),

  // Validate query parameters for listing
  listQuery: Joi.object({
    status: Joi.string().valid('active', 'returned', 'permanent').optional(),
    user_id: Joi.string().uuid().optional(),
    reason_category: Joi.string().valid('repair', 'maintenance', 'lost', 'stolen', 'other').optional(),
    search: Joi.string().max(100).allow('', null).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    total: Joi.number().optional(),
    totalPages: Joi.number().optional()
  })
};

module.exports = standbyValidators;
