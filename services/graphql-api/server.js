const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/lib/use/ws');
const { ApolloServer, gql } = require('apollo-server-express');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { ApolloServerPluginDrainHttpServer } = require('apollo-server-core');
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

// In-memory data store
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
    tasks: () => tasks,
    task: (_, { id }) => tasks.find(task => task.id === id),
    myTeamTasks: (_, { teamId }) => tasks.filter(task => task.teamId === teamId),
  },

  Mutation: {
    createTask: (_, { title, description, status, assignedTo, teamId }) => {
      const newTask = {
        id: uuidv4(),
        title,
        description: description || '',
        status: status || 'TODO',
        assignedTo: assignedTo || null,
        teamId,
        createdAt: new Date().toISOString(),
      };
      tasks.push(newTask);
      pubsub.publish('TASK_CREATED', { taskCreated: newTask });
      return newTask;
    },

    updateTask: (_, { id, title, description, status, assignedTo }) => {
      const taskIndex = tasks.findIndex(task => task.id === id);
      if (taskIndex === -1) throw new Error('Task not found');

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

    deleteTask: (_, { id }, context) => {
      // Cek Role dari JWT Token
      if (!context.user || context.user.role !== 'admin') {
        throw new Error('Unauthorized! Only admins can delete tasks.');
      }
    
      const taskIndex = tasks.findIndex(task => task.id === id);
      if (taskIndex === -1) return false;

      tasks.splice(taskIndex, 1);
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
  const app = express();
  const httpServer = createServer(app);

  app.use(cors({
    origin: [
       'http://localhost:3000', 'http://localhost:3002',
       'http://api-gateway:3000', 'http://frontend-app:3002'
    ],
    credentials: true
  }));

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql',
  });
  const serverCleanup = useServer({ schema }, wsServer);

  const server = new ApolloServer({
    schema,
    // ==========================================================
    // INI ADALAH PERBAIKANNYA:
    // ==========================================================
    context: ({ req }) => {
      // Baca data user dari header kustom yang dikirim Gateway
      const userDataHeader = req.headers['x-user-data'];
      if (userDataHeader) {
        try {
          const user = JSON.parse(userDataHeader);
          return { user };
        } catch (error) {
          console.error('Error parsing x-user-data header:', error);
          return {};
        }
      }
      return {};
    },
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
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
  httpServer.listen(PORT, () => {
    console.log(`🚀 Task Service (GraphQL) running on port ${PORT}`);
    console.log(`📡 Subscriptions ready at ws://localhost:${PORT}/graphql`);
  });
}

startServer().catch(err => console.error('Failed to start server:', err));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'graphql-api',
    timestamp: new Date().toISOString(),
    data: {
      tasks: tasks.length
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