import React from 'react';

const STATUS_CLASS = {
  PENDING: 'status pending',
  RUNNING: 'status running',
  SUCCESS: 'status success',
  FAILED: 'status failed'
};

// Maps task status to stepper node states: 'done' | 'active' | 'failed' | ''
function stepState(status, stepIndex) {
  const order = ['PENDING', 'RUNNING', 'SUCCESS'];
  if (status === 'FAILED') {
    if (stepIndex === 0) return 'done';
    if (stepIndex === 1) return 'failed';
    return '';
  }
  const currentIndex = order.indexOf(status);
  if (stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return status === 'SUCCESS' ? 'done' : 'active';
  return '';
}

function PipelineStepper({ status }) {
  const labels = ['Queued', 'Running', 'Done'];
  return (
    <div className="pipeline-stepper">
      {labels.map((label, i) => (
        <React.Fragment key={label}>
          <div className={`pipeline-step ${stepState(status, i)}`}>
            <span className="pipeline-dot" />
            <span>{label}</span>
          </div>
          {i < labels.length - 1 && (
            <span
              className={`pipeline-line ${
                stepState(status, i) === 'done' ? 'filled' : ''
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function TaskList({ tasks, onRun }) {
  if (!tasks.length) {
    return <p className="empty-state">// no tasks yet — create one to get started</p>;
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        <div className="task-card" key={task._id}>
          <div className="task-card-header">
            <div>
              <strong>{task.title}</strong>
              <p className="task-meta">{task.operation.replace('_', ' ')}</p>
            </div>
            <span className={STATUS_CLASS[task.status]}>{task.status}</span>
          </div>

          <PipelineStepper status={task.status} />

          <p className="task-input">→ {task.inputText}</p>
          {task.result !== null && <p className="task-result">✓ {task.result}</p>}

          {task.logs?.length > 0 && (
            <details>
              <summary>logs ({task.logs.length})</summary>
              <ul>
                {task.logs.map((log, i) => <li key={i}>{log}</li>)}
              </ul>
            </details>
          )}

          {(task.status === 'PENDING' || task.status === 'FAILED') && (
            <button onClick={() => onRun(task._id)}>Run task</button>
          )}
        </div>
      ))}
    </div>
  );
}
