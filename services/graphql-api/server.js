const express = require('express');
const { createServer } = require('http'); // BARU: Untuk bikin HTTP Server manual
const { WebSocketServer } = require('ws'); // BARU: Untuk server realtime
const { useServer } = require('graphql-ws/lib/use/ws'); // BARU: Library penghubung GraphQL ke WS
const { ApolloServer, gql } = require('apollo-server-express');
const { makeExecutableSchema } = require('@graphql-tools/schema'); // BARU: Untuk menyatukan TypeDefs & Resolvers
const { ApolloServerPluginDrainHttpServer } = require('apollo-server-core'); // BARU: Plugin agar server mati dengan rapi
const { PubSub } = require('graphql-subscriptions');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const pubsub = new PubSub();

// Enable CORS
app.use(cors({
  origin: [
    'http://localhost:3000', // API Gateway
    'http://localhost:3002', // Frontend
    'http://api-gateway:3000', // Docker container name
    'http://frontend-app:3002' // Docker container name
  ],
  credentials: true
}));

// In-memory data store (replace with real database in production)
// Data dummy untuk Tasks
let tasks = [
  {
    id: '1',
    title: 'Bikin Laporan UTS',
    description: 'Laporan harus selesai hari Jumat',
    status: 'IN_PROGRESS',
    assignedTo: '1', // ID User (misal: John Doe)
    teamId: 'team-A',
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Fix Bug GraphQL',
    description: 'Subscription masih error nih',
    status: 'TODO',
    assignedTo: '2', // ID User (misal: Jane)
    teamId: 'team-A',
    createdAt: new Date().toISOString(),
  }
];



const typeDefs = gql`
  type Task {
    id: ID!
    title: String!
    description: String
    status: String!
    assignedTo: String
    teamId: String
    createdAt: String!
  }

  type Query {
    tasks: [Task!]!
    task(id: ID!): Task
    myTeamTasks(teamId: String!): [Task!]!
  }

  type Mutation {
    createTask(title: String!, description: String, status: String, assignedTo: String, teamId: String!): Task!
    updateTask(id: ID!, title: String, description: String, status: String, assignedTo: String): Task!
    deleteTask(id: ID!): Boolean!
  }
  
  type Subscription {
    taskCreated: Task!
    taskUpdated: Task!
    taskDeleted: ID!
  }
`;

// GraphQL resolvers
const resolvers = {
  Query: {
    // Kalau frontend minta 'tasks', kasih semua data tasks
    tasks: () => tasks,
    // Kalau minta satu task berdasarkan ID
    task: (_, { id }) => tasks.find(task => task.id === id),
    // Kalau minta task khusus tim tertentu
    myTeamTasks: (_, { teamId }) => tasks.filter(task => task.teamId === teamId),
  },

  Mutation: {
    // Logika untuk membuat task baru
    createTask: (_, { title, description, status, assignedTo, teamId }) => {
      const newTask = {
        id: uuidv4(), // Generate ID unik baru
        title,
        description: description || '',
        status: status || 'TODO',
        assignedTo: assignedTo || null,
        teamId,
        createdAt: new Date().toISOString(),
      };
      tasks.push(newTask); // Masukkan ke array In-Memory
      pubsub.publish('TASK_CREATED', { taskCreated: newTask });
      return newTask;
    },

    // Logika update task
    updateTask: (_, { id, title, description, status, assignedTo }) => {
      const taskIndex = tasks.findIndex(task => task.id === id);
      if (taskIndex === -1) throw new Error('Task not found');

      // Update hanya field yang dikirim saja
      const updatedTask = {
        ...tasks[taskIndex],
        ...(title && { title }),
        ...(description && { description }),
        ...(status && { status }),
        ...(assignedTo && { assignedTo }),
      };
      tasks[taskIndex] = updatedTask;
      pubsub.publish('TASK_UPDATED', { taskUpdated: updatedTask });
      return updatedTask;
    },

    // Logika hapus task
    deleteTask: (_, { id }) => {
      const taskIndex = tasks.findIndex(task => task.id === id);
      if (taskIndex === -1) return false;

      tasks.splice(taskIndex, 1); // Hapus dari array
      pubsub.publish('TASK_DELETED', { taskDeleted: id });
      return true;
    },
  },
  Subscription: {
    taskCreated: {
      subscribe: () => pubsub.asyncIterator(['TASK_CREATED']),
    },
    taskUpdated: {
      subscribe: () => pubsub.asyncIterator(['TASK_UPDATED']),
    },
    taskDeleted: {
      subscribe: () => pubsub.asyncIterator(['TASK_DELETED']),
    },
  },
};

async function startServer() {
  // Setup Express dan HTTP Server
  const app = express();
  const httpServer = createServer(app);

  // Setup CORS agar bisa diakses dari mana saja
  app.use(cors({
    origin: [
       'http://localhost:3000', 'http://localhost:3002',
       'http://api-gateway:3000', 'http://frontend-app:3002'
    ],
    credentials: true
  }));

  // Buat Schema GraphQL (gabungan typeDefs dan resolvers)
  const schema = makeExecutableSchema({ typeDefs, resolvers });

  // Setup WebSocket Server untuk Subscriptions (Jantung Real-time)
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });
  // Aktifkan server WebSocket menggunakan schema kita
  const serverCleanup = useServer({ schema }, wsServer);

  // Setup Apollo Server dengan plugin agar shutdown rapi
  const server = new ApolloServer({
    schema,
    plugins: [
      // Plugin untuk menutup HTTP server saat dimatikan
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        // Plugin untuk menutup WebSocket server saat dimatikan
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  const PORT = process.env.PORT || 4000;
  // PENTING: Gunakan httpServer.listen, BUKAN app.listen
  httpServer.listen(PORT, () => {
    console.log(`🚀 Task Service (GraphQL) running on port ${PORT}`);
    console.log(`📡 Subscriptions ready at ws://localhost:${PORT}/graphql`);
  });
}

// Jalankan mesinnya!
startServer().catch(err => console.error('Failed to start server:', err));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'graphql-api',
    timestamp: new Date().toISOString(),
    data: {
      posts: posts.length,
      comments: comments.length
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('GraphQL API Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

startServer().catch(error => {
  console.error('Failed to start GraphQL server:', error);
  process.exit(1);
});