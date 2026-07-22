const express = require('express');
const Task = require('../models/Task');
const requireAuth = require('../middleware/auth');
const { enqueueTask } = require('../utils/queue');

const router = express.Router();
router.use(requireAuth);

// Create a task (status: PENDING, not yet queued)
router.post('/', async (req, res) => {
  try {
    const { title, inputText, operation } = req.body;
    if (!title || !inputText || !operation) {
      return res.status(400).json({ error: 'title, inputText and operation are required' });
    }
    if (!Task.OPERATIONS.includes(operation)) {
      return res.status(400).json({ error: `operation must be one of: ${Task.OPERATIONS.join(', ')}` });
    }

    const task = await Task.create({
      userId: req.userId,
      title,
      inputText,
      operation,
      status: 'PENDING',
      logs: ['Task created']
    });

    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task', details: err.message });
  }
});

// Run a task: push its id onto the Redis queue for the worker to pick up
router.post('/:id/run', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.userId });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (task.status === 'RUNNING') {
      return res.status(409).json({ error: 'Task is already running' });
    }

    task.status = 'PENDING';
    task.logs.push('Task queued for execution');
    await task.save();

    await enqueueTask(task._id);

    res.json({ message: 'Task queued', task });
  } catch (err) {
    res.status(500).json({ error: 'Failed to queue task', details: err.message });
  }
});

// List current user's tasks, most recent first
router.get('/', async (req, res) => {
  try {
    const tasks = await Task.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list tasks', details: err.message });
  }
});

// Get a single task's status/result/logs
router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, userId: req.userId });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch task', details: err.message });
  }
});

module.exports = router;
