const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { validateUser, validateUserUpdate } = require('../middleware/validation');

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Load Private Key untuk tanda tangan token UTS
const privateKey = fs.readFileSync(path.join(__dirname, '../private.key'), 'utf8');

const router = express.Router();

// In-memory database (replace with real database in production)
let users = [
  {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    role: 'admin',
    // UTS
    password: 'adminpassword', 
    teamId: 'team-A',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    age: 25,
    role: 'user',
    // uts
    password: 'adminpassword', 
    teamId: 'team-b',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// GET /api/users - Get all users
router.get('/', (req, res) => {
  const { page, limit, role, search } = req.query;
  
  let filteredUsers = [...users];
  
  // Filter by role
  if (role) {
    filteredUsers = filteredUsers.filter(user => user.role === role);
  }
  
  // Search by name or email
  if (search) {
    filteredUsers = filteredUsers.filter(user => 
      user.name.toLowerCase().includes(search.toLowerCase()) ||
      user.email.toLowerCase().includes(search.toLowerCase())
    );
  }
  
  // If pagination params provided, return paginated response
  if (page && limit) {
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
    
    return res.json({
      users: paginatedUsers,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(filteredUsers.length / limit),
        totalUsers: filteredUsers.length,
        hasNext: endIndex < filteredUsers.length,
        hasPrev: startIndex > 0
      }
    });
  }
  
  // Otherwise return all users as simple array
  res.json(filteredUsers);
});

// GET /api/users/:id - Get user by ID
router.get('/:id', (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  
  if (!user) {
    return res.status(404).json({
      error: 'User not found',
      message: `User with ID ${req.params.id} does not exist`
    });
  }
  
  res.json(user);
});

// POST /api/users - Create new user
router.post('/', validateUser, (req, res) => {
  const { name, email, age, role = 'user' } = req.body;
  
  // Check if email already exists
  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    return res.status(409).json({
      error: 'Email already exists',
      message: 'A user with this email already exists'
    });
  }
  
  const newUser = {
    id: uuidv4(),
    name,
    email,
    age,
    role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  users.push(newUser);
  
  res.status(201).json({
    message: 'User created successfully',
    user: newUser
  });
});

// PUT /api/users/:id - Update user
router.put('/:id', validateUserUpdate, (req, res) => {
  const userIndex = users.findIndex(u => u.id === req.params.id);
  
  if (userIndex === -1) {
    return res.status(404).json({
      error: 'User not found',
      message: `User with ID ${req.params.id} does not exist`
    });
  }
  
  const { name, email, age, role } = req.body;
  
  // Check if email already exists (excluding current user)
  if (email) {
    const existingUser = users.find(u => u.email === email && u.id !== req.params.id);
    if (existingUser) {
      return res.status(409).json({
        error: 'Email already exists',
        message: 'A user with this email already exists'
      });
    }
  }
  
  const updatedUser = {
    ...users[userIndex],
    ...(name && { name }),
    ...(email && { email }),
    ...(age && { age }),
    ...(role && { role }),
    updatedAt: new Date().toISOString()
  };
  
  users[userIndex] = updatedUser;
  
  res.json({
    message: 'User updated successfully',
    user: updatedUser
  });
});

// DELETE /api/users/:id - Delete user
router.delete('/:id', (req, res) => {
  const userIndex = users.findIndex(u => u.id === req.params.id);
  
  if (userIndex === -1) {
    return res.status(404).json({
      error: 'User not found',
      message: `User with ID ${req.params.id} does not exist`
    });
  }
  
  const deletedUser = users.splice(userIndex, 1)[0];
  
  res.json({
    message: 'User deleted successfully',
    user: deletedUser
  });
});

// POST /api/users/login - Login user dan generate JWT UTS
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  // 1. Cari user berdasarkan email
  const user = users.find(u => u.email === email);

  // 2. Cek apakah user ada DAN password cocok
  // (Note: di production harusnya pakai hashing, ini plain text untuk demo UTS)
  if (!user || user.password !== password) {
    return res.status(401).json({
      error: 'Authentication failed',
      message: 'Invalid email or password'
    });
  }

  // 3. Buat payload untuk token (data yang disimpan dalam token)
  const tokenPayload = {
    id: user.id,
    name: user.name,
    role: user.role,
    teamId: user.teamId
  };

  // 4. Generate JWT Token dengan Private Key
  // Algoritma RS256 artinya menggunakan RSA Key Pair
  const token = jwt.sign(tokenPayload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '1h' // Token kadaluwarsa dalam 1 jam
  });

  // 5. Kirim response sukses dengan token
  res.json({
    message: 'Login successful',
    token: token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      teamId: user.teamId
    }
  });
});

module.exports = router;