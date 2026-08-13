const fs = require('fs');
const path = require('path');
const winston = require('winston');

const { combine, timestamp, printf, colorize, json } = winston.format;

const ficherLogs = path.join(process.cwd(), 'logs');
if (!fs.existsSync(ficherLogs)) {
  fs.mkdirSync(ficherLogs, { recursive: true });
}

const formatConsole = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp }) => `[${timestamp}] ${level}: ${message}`)
);

const estTest = process.env.NODE_ENV === 'test';
const estProd = process.env.NODE_ENV === 'production';

const transports = estProd
  ? [
      new winston.transports.File({ filename: path.join(ficherLogs, 'error.log'), level: 'error' }),
      new winston.transports.File({ filename: path.join(ficherLogs, 'combined.log') }),
    ]
  : [new winston.transports.Console()];

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  silent: estTest,
  format: estProd ? combine(timestamp(), json()) : formatConsole,
  transports,
});

logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
