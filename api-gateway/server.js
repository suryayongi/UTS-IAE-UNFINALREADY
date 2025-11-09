const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// uts
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Load Public Key untuk verifikasi token uts
const publicKey = fs.readFileSync(path.join(__dirname, 'public.key'), 'utf8');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3002', // Frontend
    'http://localhost:3000', // Gateway itself
    'http://frontend-app:3002' // Docker container name
  ],
  credentials: true
}));

// Rate limiting
// dmatiin dlu utk ngeceknya uts
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // limit each IP to 100 requests per windowMs
//   message: 'Too many requests from this IP, please try again later.'
// });
// app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    services: {
      'rest-api': process.env.REST_API_URL || 'http://localhost:3001',
      'graphql-api': process.env.GRAPHQL_API_URL || 'http://localhost:4000'
    }
  });
});



// Proxy configuration for REST API
const restApiProxy = createProxyMiddleware({
  target: process.env.REST_API_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '/api', // Keep the /api prefix
  },
  onError: (err, req, res) => {
    console.error('REST API Proxy Error:', err.message);
    res.status(500).json({ 
      error: 'REST API service unavailable',
      message: err.message 
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[REST API] ${req.method} ${req.url} -> ${proxyReq.path}`);
  }
});

// Proxy configuration for GraphQL API
const graphqlApiProxy = createProxyMiddleware({
  target: process.env.GRAPHQL_API_URL || 'http://localhost:4000',
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying for subscriptions
  onError: (err, req, res) => {
    console.error('GraphQL API Proxy Error:', err.message);
    res.status(500).json({ 
      error: 'GraphQL API service unavailable',
      message: err.message 
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[GraphQL API] ${req.method} ${req.url} -> ${proxyReq.path}`);
  }
});


// Middleware Satpam (Otentikasi JWT)
const authMiddleware = (req, res, next) => {
  // 1. Cek apakah request membawa token di header Authorization
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Kalau tidak ada token, tolak!
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Access denied. No valid token provided.'
    });
  }

  // 2. Ambil tokennya saja (buang kata 'Bearer ')
  const token = authHeader.split(' ')[1];

  try {
    // 3. Verifikasi token menggunakan Public Key
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    
    // 4. Kalau berhasil, simpan data user di request supaya bisa dipakai service lain
    req.user = decoded;
    
    // 5. Lanjut ke service berikutnya (misal: GraphQL)
    next();
  } catch (error) {
    // Kalau verifikasi gagal (token palsu/kadaluwarsa), tolak!
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or expired token.'
    });
  }
};

// Apply proxies
app.use('/api', restApiProxy);
// ngejaga yg kita buat 
app.use('/graphql', authMiddleware, graphqlApiProxy);

// Catch-all route
app.get('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    availableRoutes: [
      '/health',
      '/api/* (proxied to REST API)',
      '/graphql (proxied to GraphQL API)'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Gateway Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔄 Proxying /api/* to: ${process.env.REST_API_URL || 'http://localhost:3001'}`);
  console.log(`🔄 Proxying /graphql to: ${process.env.GRAPHQL_API_URL || 'http://localhost:4000'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

module.exports = app;