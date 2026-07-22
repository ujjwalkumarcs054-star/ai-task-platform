const mongoose = require('mongoose');

const OPERATIONS = ['UPPERCASE', 'LOWERCASE', 'REVERSE', 'WORD_COUNT'];
const STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED'];

const taskSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    inputText: { type: String, required: true },
    operation: { type: String, enum: OPERATIONS, required: true },
    status: { type: String, enum: STATUSES, default: 'PENDING' },
    result: { type: String, default: null },
    logs: [{ type: String }],
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// Compound index: fetching "my tasks, most recent first" is the hottest
// query path in the app.
taskSchema.index({ userId: 1, createdAt: -1 });
// Used by the worker / dashboards to quickly count tasks by status.
taskSchema.index({ status: 1 });

module.exports = mongoose.model('Task', taskSchema);
module.exports.OPERATIONS = OPERATIONS;
module.exports.STATUSES = STATUSES;
