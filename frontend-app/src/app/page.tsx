'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useSubscription, gql } from '@apollo/client';
import axios from 'axios';

// --- DEFINISI GRAPHQL (Sesuai Backend Baru) ---
const GET_TASKS = gql`
  query GetTasks {
    tasks {
      id
      title
      status
      teamId
    }
  }
`;

const CREATE_TASK = gql`
  mutation CreateTask($title: String!, $teamId: String!) {
    createTask(title: $title, teamId: $teamId) {
      id
      title
      status
    }
  }
`;

// Subscription untuk notifikasi real-time
const TASK_CREATED_SUB = gql`
  subscription OnTaskCreated {
    taskCreated {
      id
      title
      status
    }
  }
`;

export default function Home() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('john@example.com');
  const [password, setPassword] = useState('adminpassword');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [user, setUser] = useState<any>(null);

  // --- TAMBAHAN BARU ---
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  // ---------------------

  // Cek apakah sudah login saat buka web
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) setToken(savedToken);
  }, []);

  // GraphQL Hooks
  const { data: taskData, loading, refetch } = useQuery(GET_TASKS, {
    skip: !token, // Jangan query kalau belum punya token (nanti error 401)
  });

  const [createTask] = useMutation(CREATE_TASK);

  // Langsung listen subscription
  useSubscription(TASK_CREATED_SUB, {
    onData: ({ data }) => {
      const newTask = data.data.taskCreated;
      alert(`⚡ New Task Created: ${newTask.title}`);
      refetch(); // Refresh data otomatis
    }
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Tembak ke API Gateway -> REST Service
      const res = await axios.post('http://localhost:3000/api/users/login', {
        email,
        password
      });
      
      const receivedToken = res.data.token;
      localStorage.setItem('token', receivedToken); // Simpan token di browser
      setToken(receivedToken);
      setUser(res.data.user);
      alert('Login Berhasil!');
      window.location.reload(); // Refresh agar Apollo Client pakai token baru
    } catch (err) {
      alert('Login Gagal! Cek email/password.');
      console.error(err);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setUser(null);
    window.location.reload();
  };

  // --- FUNGSI BARU ---
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:3000/api/users/register', { 
        name, 
        email, 
        password 
      });
      
      alert('Registrasi Berhasil! Silakan login.');
      // Kembalikan ke mode login
      setIsRegistering(false);
      setPassword('');
    } catch (err: any) {
      alert('Registrasi Gagal! ' + (err.response?.data?.message || 'Error tidak diketahui'));
      console.error(err);
    }
  };
  // -------------------

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle) return;
    try {
      await createTask({
        variables: {
          title: newTaskTitle,
          teamId: user?.teamId || 'team-A'
        }
      });
      setNewTaskTitle('');
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Gagal buat task. Pastikan token valid.');
    }
  };

  // --- TAMPILAN KALO BELUM LOGIN (SUDAH DIMODIFIKASI) ---
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded shadow-md w-96">
          
          {/* --- JUDUL BERGANTI --- */}
          <h1 className="text-2xl font-bold mb-6 text-center">
            {isRegistering ? 'Register Akun Baru' : 'Login UTS'}
          </h1>

          {/* --- FORM BERGANTI --- */}
          <form onSubmit={isRegistering ? handleRegister : handleLogin} className="space-y-4">
            
            {/* Field Nama (hanya muncul saat register) */}
            {isRegistering && (
              <input
                className="w-full border p-2 rounded"
                type="text"
                placeholder="Nama Lengkap"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            )}

            <input
              className="w-full border p-2 rounded"
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <input
              className="w-full border p-2 rounded"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />

            {/* Tombol BERGANTI */}
            <button className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
              {isRegistering ? 'Register' : 'Login (Dapat Token)'}
            </button>
          </form>

          {/* --- TOMBOL TOGGLE --- */}
          <div className="text-center mt-4">
            <button 
              onClick={() => setIsRegistering(!isRegistering)} 
              className="text-sm text-blue-500 hover:underline"
            >
              {isRegistering ? 'Sudah punya akun? Login' : 'Belum punya akun? Register'}
            </button>
          </div>

        </div>
      </div>
    );
  }

  // --- TAMPILAN KALO SUDAH LOGIN (TASK MANAGER) ---
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Task Manager UTS 🚀</h1>
          <button onClick={handleLogout} className="bg-red-500 text-white px-4 py-2 rounded">
            Logout
          </button>
        </div>

        {/* Form Tambah Task */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-semibold mb-4">Create New Task</h2>
          <form onSubmit={handleCreateTask} className="flex gap-4">
            <input
              type="text"
              placeholder="Task title..."
              className="flex-1 border p-2 rounded"
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
            />
            <button typeD="submit" className="bg-green-500 text-white px-6 py-2 rounded hover:bg-green-600">
              Add Task
            </button>
          </form>
        </div>

        {/* Daftar Task */}
        <div className="grid gap-4">
          {loading ? (
            <p>Loading tasks...</p>
          ) : (
            taskData?.tasks.map((task: any) => (
              <div key={task.id} className="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg">{task.title}</h3>
                  <p className="text-sm text-gray-500">Status: {task.status} • Team: {task.teamId}</p>
                </div>
                <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                  {task.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}