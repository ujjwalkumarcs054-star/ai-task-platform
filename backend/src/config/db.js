const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/ai_task_platform';
  try {
    await mongoose.connect(uri);
    console.log('[db] MongoDB connected');
  } catch (err) {
    console.error('[db] MongoDB connection error:', err.message);
    // Retry after delay instead of crashing immediately — useful in k8s
    // where mongo may still be starting up.
    setTimeout(connectDB, 5000);
  }
}

module.exports = connectDB;
