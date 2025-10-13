const { HTTP_STATUS, MESSAGES } = require('./constants');

class ResponseFormatter {
  static success(data = null, message = MESSAGES.SUCCESS, statusCode = HTTP_STATUS.OK) {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    };
  }

  static created(data = null, message = MESSAGES.CREATED) {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    };
  }

  static error(message = MESSAGES.INTERNAL_ERROR, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, errors = null) {
    return {
      success: false,
      message,
      errors,
      timestamp: new Date().toISOString()
    };
  }

  static validationError(errors, message = MESSAGES.VALIDATION_ERROR) {
    return {
      success: false,
      message,
      errors,
      timestamp: new Date().toISOString()
    };
  }

  static unauthorizedError(message = MESSAGES.UNAUTHORIZED) {
    return {
      success: false,
      message,
      timestamp: new Date().toISOString()
    };
  }

  static forbiddenError(message = MESSAGES.FORBIDDEN) {
    return {
      success: false,
      message,
      timestamp: new Date().toISOString()
    };
  }

  static notFoundError(message = MESSAGES.NOT_FOUND) {
    return {
      success: false,
      message,
      timestamp: new Date().toISOString()
    };
  }

  static conflictError(message = 'Resource already exists') {
    return {
      success: false,
      message,
      timestamp: new Date().toISOString()
    };
  }

  static paginatedResponse(data, pagination, message = MESSAGES.SUCCESS) {
    return {
      success: true,
      message,
      data,
      pagination: {
        currentPage: pagination.currentPage,
        totalPages: pagination.totalPages,
        totalItems: pagination.totalItems,
        itemsPerPage: pagination.itemsPerPage,
        hasNextPage: pagination.hasNextPage,
        hasPrevPage: pagination.hasPrevPage
      },
      timestamp: new Date().toISOString()
    };
  }
}

const sendResponse = (res, statusCode, responseData) => {
  res.status(statusCode).json(responseData);
};

const sendSuccess = (res, data = null, message = MESSAGES.SUCCESS, statusCode = HTTP_STATUS.OK) => {
  const response = ResponseFormatter.success(data, message, statusCode);
  sendResponse(res, statusCode, response);
};

const sendCreated = (res, data = null, message = MESSAGES.CREATED) => {
  const response = ResponseFormatter.created(data, message);
  sendResponse(res, HTTP_STATUS.CREATED, response);
};

const sendError = (res, message = MESSAGES.INTERNAL_ERROR, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, errors = null) => {
  const response = ResponseFormatter.error(message, statusCode, errors);
  sendResponse(res, statusCode, response);
};

const sendValidationError = (res, errors, message = MESSAGES.VALIDATION_ERROR) => {
  const response = ResponseFormatter.validationError(errors, message);
  sendResponse(res, HTTP_STATUS.UNPROCESSABLE_ENTITY, response);
};

const sendUnauthorized = (res, message = MESSAGES.UNAUTHORIZED) => {
  const response = ResponseFormatter.unauthorizedError(message);
  sendResponse(res, HTTP_STATUS.UNAUTHORIZED, response);
};

const sendForbidden = (res, message = MESSAGES.FORBIDDEN) => {
  const response = ResponseFormatter.forbiddenError(message);
  sendResponse(res, HTTP_STATUS.FORBIDDEN, response);
};

const sendNotFound = (res, message = MESSAGES.NOT_FOUND) => {
  const response = ResponseFormatter.notFoundError(message);
  sendResponse(res, HTTP_STATUS.NOT_FOUND, response);
};

const sendConflict = (res, message = 'Resource already exists') => {
  const response = ResponseFormatter.conflictError(message);
  sendResponse(res, HTTP_STATUS.CONFLICT, response);
};

const sendPaginatedResponse = (res, data, pagination, message = MESSAGES.SUCCESS) => {
  const response = ResponseFormatter.paginatedResponse(data, pagination, message);
  sendResponse(res, HTTP_STATUS.OK, response);
};

module.exports = {
  ResponseFormatter,
  sendResponse,
  sendSuccess,
  sendCreated,
  sendError,
  sendValidationError,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendPaginatedResponse
};