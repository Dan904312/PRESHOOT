'use strict';

const withImages = require('next-images');

module.exports = withImages({
  // Enabling image optimization
  inlineImageLimit: 8192,
  // Enabling React Strict Mode
  reactStrictMode: true,
  // Defining environment variables
  env: {
    CUSTOM_API_URL: process.env.CUSTOM_API_URL || 'https://api.preshot.com',
    NODE_ENV: process.env.NODE_ENV || 'development',
  },
});