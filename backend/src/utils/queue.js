const { redisClient } = require('../config/redis');

const QUEUE_KEY = process.env.TASK_QUEUE_KEY || 'ai_tasks_queue';

async function enqueueTask(taskId) {
  await redisClient.lPush(QUEUE_KEY, taskId.toString());
}

module.exports = { enqueueTask, QUEUE_KEY };
