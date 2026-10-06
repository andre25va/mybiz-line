const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // your existing config here
};

module.exports = withSentryConfig(nextConfig, {
  org: 'avt-capital-llc',
  project: 'mybiz-line',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});
