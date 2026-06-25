/**
 * HIPAA-Compliant Security Headers Template
 *
 * HTTP security headers configuration for healthcare applications handling PHI.
 * Implements defense-in-depth security controls for HIPAA compliance.
 *
 * Usage:
 * - Express.js: Use as middleware
 * - Next.js: Add to next.config.js headers configuration
 * - AWS Lambda: Apply in response headers
 * - Nginx: Configure in server block
 */

// =============================================================================
// Express.js Middleware Implementation
// =============================================================================

const helmet = require('helmet');

/**
 * HIPAA-compliant security headers middleware for Express.js
 * Implements strict security controls for healthcare applications
 */
const hipaaSecurityHeaders = (req, res, next) => {
  // Core Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); // Prevent clickjacking
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HTTPS Enforcement (Critical for PHI transmission)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Content Security Policy - Strict for healthcare apps
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://apis.google.com", // Minimal allowed sources
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:", // Allow data URLs for inline images
    "connect-src 'self' https://api.health-platform.com wss://api.health-platform.com", // Replace with your API domains
    "media-src 'self'",
    "object-src 'none'", // Block plugins
    "base-uri 'self'",
    "form-action 'self'", // Only allow forms to submit to same origin
    "frame-ancestors 'none'", // Prevent embedding
    "upgrade-insecure-requests", // Force HTTPS
    "block-all-mixed-content" // Block mixed content
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);

  // Permission Policy (formerly Feature Policy)
  const permissionsPolicy = [
    'camera=self', // Allow camera only for same origin (telemedicine)
    'microphone=self', // Allow microphone for same origin
    'geolocation=self', // Location for health tracking
    'payment=self', // Payment processing
    'usb=none', // No USB access
    'bluetooth=none', // No Bluetooth access
    'magnetometer=none',
    'gyroscope=none',
    'accelerometer=self', // For fitness tracking
    'ambient-light-sensor=none',
    'autoplay=none',
    'encrypted-media=none',
    'fullscreen=self',
    'picture-in-picture=none'
  ].join(', ');

  res.setHeader('Permissions-Policy', permissionsPolicy);

  // Cache Control for PHI
  if (req.path.includes('/api/') || req.path.includes('/patient/') || req.path.includes('/user/')) {
    // No caching for API endpoints or user data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  // Custom security headers for healthcare
  res.setHeader('X-Health-Data-Protection', 'enabled');
  res.setHeader('X-HIPAA-Compliant', 'true');

  next();
};

// =============================================================================
// Helmet.js Configuration (Alternative approach)
// =============================================================================

const hipaaHelmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.health-platform.com", "wss://api.health-platform.com"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
      blockAllMixedContent: []
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: {
    camera: ["self"],
    microphone: ["self"],
    geolocation: ["self"],
    payment: ["self"],
    usb: [],
    bluetooth: [],
    accelerometer: ["self"],
    gyroscope: [],
    magnetometer: [],
    ambientLightSensor: [],
    autoplay: [],
    encryptedMedia: [],
    fullscreen: ["self"],
    pictureInPicture: []
  }
};

const applyHipaaHelmet = helmet(hipaaHelmetConfig);

// =============================================================================
// Next.js Configuration
// =============================================================================

/**
 * Next.js security headers configuration for HIPAA compliance
 * Add this to your next.config.js file
 */
const nextjsSecurityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js requires unsafe-eval in dev
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests"
    ].join('; ')
  },
  {
    key: 'Permissions-Policy',
    value: [
      'camera=self',
      'microphone=self',
      'geolocation=self',
      'payment=self',
      'usb=none',
      'bluetooth=none'
    ].join(', ')
  }
];

// =============================================================================
// AWS Lambda Response Headers
// =============================================================================

/**
 * Apply HIPAA-compliant security headers to AWS Lambda response
 * @param {Object} response - Lambda response object
 * @returns {Object} - Response with security headers
 */
const applyLambdaSecurityHeaders = (response) => {
  const securityHeaders = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=self, microphone=self, geolocation=self, payment=self',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  return {
    ...response,
    headers: {
      ...response.headers,
      ...securityHeaders
    }
  };
};

// Example Lambda handler with security headers
const hipaaLambdaHandler = async (event, context) => {
  try {
    // Your business logic here
    const result = await processHealthData(event);

    const response = {
      statusCode: 200,
      body: JSON.stringify(result),
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // Apply HIPAA security headers
    return applyLambdaSecurityHeaders(response);

  } catch (error) {
    console.error('Health data processing error:', error);

    const errorResponse = {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Please contact support for assistance'
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    };

    return applyLambdaSecurityHeaders(errorResponse);
  }
};

// =============================================================================
// Nginx Configuration
// =============================================================================

/**
 * Nginx configuration block for HIPAA-compliant security headers
 * Add this to your nginx.conf or site configuration
 */
const nginxSecurityConfig = `
# HIPAA-Compliant Security Headers
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Content Security Policy
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests" always;

# Permissions Policy
add_header Permissions-Policy "camera=self, microphone=self, geolocation=self, payment=self, usb=none, bluetooth=none" always;

# Prevent caching of sensitive endpoints
location ~ ^/(api|patient|user)/ {
    add_header Cache-Control "no-store, no-cache, must-revalidate, private" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
}

# Hide server information
server_tokens off;
add_header X-Health-Data-Protection "enabled" always;
`;

// =============================================================================
// Security Headers Validation
// =============================================================================

/**
 * Validate that required security headers are present
 * Use this in testing or monitoring
 */
const validateSecurityHeaders = (headers) => {
  const requiredHeaders = [
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'content-security-policy',
    'referrer-policy'
  ];

  const missingHeaders = requiredHeaders.filter(
    header => !headers[header] && !headers[header.toLowerCase()]
  );

  if (missingHeaders.length > 0) {
    console.warn('Missing HIPAA security headers:', missingHeaders);
    return false;
  }

  // Validate HSTS header
  const hsts = headers['strict-transport-security'] || headers['Strict-Transport-Security'];
  if (!hsts || !hsts.includes('max-age=31536000')) {
    console.warn('HSTS header missing or insufficient max-age');
    return false;
  }

  // Validate CSP header
  const csp = headers['content-security-policy'] || headers['Content-Security-Policy'];
  if (!csp || !csp.includes("frame-ancestors 'none'")) {
    console.warn('CSP header missing or lacks frame-ancestors protection');
    return false;
  }

  return true;
};

// =============================================================================
// Testing Utilities
// =============================================================================

/**
 * Test security headers configuration
 * Use in your test suite
 */
const testSecurityHeaders = async (url) => {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const headers = response.headers;

    console.log('Security Headers Test Results:');
    console.log('================================');

    const isValid = validateSecurityHeaders(headers);

    requiredHeaders.forEach(header => {
      const value = headers.get(header);
      console.log(`${header}: ${value || 'MISSING'}`);
    });

    console.log(`\nOverall validation: ${isValid ? 'PASS' : 'FAIL'}`);

    return isValid;

  } catch (error) {
    console.error('Error testing security headers:', error);
    return false;
  }
};

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Middleware
  hipaaSecurityHeaders,
  applyHipaaHelmet,

  // Configuration
  hipaaHelmetConfig,
  nextjsSecurityHeaders,
  nginxSecurityConfig,

  // Lambda utilities
  applyLambdaSecurityHeaders,
  hipaaLambdaHandler,

  // Validation and testing
  validateSecurityHeaders,
  testSecurityHeaders
};

// =============================================================================
// Usage Examples
// =============================================================================

/*
// Express.js usage
const express = require('express');
const { hipaaSecurityHeaders } = require('./security-headers-template');

const app = express();
app.use(hipaaSecurityHeaders);

// Next.js usage (next.config.js)
module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: nextjsSecurityHeaders,
      },
    ];
  },
};

// AWS Lambda usage
exports.handler = hipaaLambdaHandler;

// Testing
testSecurityHeaders('https://your-health-app.com');
*/