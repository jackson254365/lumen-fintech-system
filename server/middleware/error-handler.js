// ============================================================================
// Standardized RFC-7807 Safe Error Handler
// ============================================================================

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  if (statusCode >= 500) {
    console.error(`[ERROR 500] ${req.method} ${req.url}:`, err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      type: err.name || 'Error',
      message: message,
      code: err.code || 'FINTECH_API_ERROR',
      statusCode
    }
  });
}

module.exports = {
  errorHandler
};
