import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import TaskForm from '../components/TaskForm.jsx';
import TaskList from '../components/TaskList.jsx';

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const data = await api.listTasks();
      setTasks(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Poll every 1.5s so running tasks visibly progress through each stage
    const interval = setInterval(refresh, 1500);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleCreate(payload) {
    const task = await api.createTask(payload);
    await api.runTask(task._id);
    await refresh();
  }

  async function handleRun(id) {
    await api.runTask(id);
    await refresh();
  }

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>AI Task Processing Platform</h1>
        <button className="logout-btn" onClick={logout}>Log out</button>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="dashboard-body">
        <TaskForm onCreate={handleCreate} />
        <TaskList tasks={tasks} onRun={handleRun} />
      </div>
    </div>
  );
}
