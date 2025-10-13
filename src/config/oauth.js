require('dotenv').config();

module.exports = {
  // OAuth 2.0 Server Configuration
  server: {
    accessTokenLifetime: 60 * 60, // 1 hour in seconds
    refreshTokenLifetime: 60 * 60 * 24 * 7, // 7 days in seconds
    authorizationCodeLifetime: 60 * 10, // 10 minutes in seconds
    allowBearerTokensInQueryString: false,
    allowEmptyState: false,
    allowExtendedTokenAttributes: true,
    requireClientAuthentication: {
      authorization_code: true,
      client_credentials: true,
      refresh_token: true,
      password: false
    }
  },

  // Role-based token lifetimes (in seconds)
  roleBasedTokenLifetime: {
    superadmin: 60 * 60 * 24, // 24 hours
    admin: 60 * 60 * 12, // 12 hours
    department_head: 60 * 60 * 8, // 8 hours
    coordinator: 60 * 60 * 8, // 8 hours
    department_coordinator: 60 * 60 * 8, // 8 hours
    engineer: 60 * 60 * 6, // 6 hours
    employee: 60 * 60 * 6 // 6 hours
  },

  // Default OAuth 2.0 scopes
  scopes: {
    READ: 'read',
    WRITE: 'write',
    DELETE: 'delete',
    ADMIN: 'admin'
  },

  // Role-based scope mapping
  roleScopeMapping: {
    superadmin: ['read', 'write', 'delete', 'admin'],
    admin: ['read', 'write', 'delete'],
    department_head: ['read', 'write'],
    coordinator: ['read', 'write'],
    department_coordinator: ['read', 'write'],
    engineer: ['read', 'write'],
    employee: ['read']
  },

  // Grant types supported
  supportedGrantTypes: [
    'authorization_code',
    'refresh_token',
    'password', // Resource Owner Password Credentials
    'client_credentials'
  ],

  // Response types supported
  supportedResponseTypes: [
    'code', // Authorization Code flow
    'token' // Implicit flow (if needed)
  ],

  // Default client configuration for Asset Management System
  defaultClients: [
    {
      clientId: 'asset-management-web',
      clientSecret: process.env.OAUTH_CLIENT_SECRET_WEB || 'web-client-secret-change-me',
      name: 'Asset Management Web Application',
      grants: 'authorization_code,refresh_token,password',
      redirectUris: [
        'http://localhost:3000/auth/callback',
        'https://your-domain.com/auth/callback'
      ].join(','),
      scope: 'read write'
    },
    {
      clientId: 'asset-management-mobile',
      clientSecret: process.env.OAUTH_CLIENT_SECRET_MOBILE || 'mobile-client-secret-change-me',
      name: 'Asset Management Mobile Application',
      grants: 'authorization_code,refresh_token',
      redirectUris: [
        'assetapp://auth/callback'
      ].join(','),
      scope: 'read write'
    },
    {
      clientId: 'asset-management-api',
      clientSecret: process.env.OAUTH_CLIENT_SECRET_API || 'api-client-secret-change-me',
      name: 'Asset Management API Client',
      grants: 'client_credentials',
      redirectUris: '',
      scope: 'read write delete admin'
    }
  ],

  // Security settings
  security: {
    tokenLength: 32, // Length of generated tokens
    codeLength: 16, // Length of authorization codes
    allowInsecureRedirectUris: process.env.NODE_ENV !== 'production',
    enforceHttps: process.env.NODE_ENV === 'production',
    maxTokensPerUser: 10, // Maximum active tokens per user
    maxCodesPerUser: 5 // Maximum active authorization codes per user
  }
};