const winston = require('winston');

const logger = winston.createLogger({
  level: 'info', // Log only info and below by default
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' // ISO 8601 format like the previous logs
    }),
    winston.format.errors({ stack: true }), // Log stack traces for errors
    winston.format.splat(),
    winston.format.colorize(), // Add colors
    winston.format.printf(({ level, message, timestamp, stack }) => {
      // Handle displaying stack traces for errors explicitly
      if (stack) {
        return `[${timestamp}] ${level}: ${message}
${stack}`;
      }
      return `[${timestamp}] ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      level: process.env.LOG_LEVEL || 'debug', // Allow overriding level via env var, default to debug
      handleExceptions: true // Log unhandled exceptions
    })
  ],
  exitOnError: false // Do not exit on handled exceptions
});

// Add a custom debug level that is less prominent if needed, or just use 'debug'
// logger.add(new winston.transports.Console({ level: 'debug' }));

module.exports = logger; 