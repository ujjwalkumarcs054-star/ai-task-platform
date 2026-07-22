import React, { useState } from 'react';

const OPERATIONS = [
  { value: 'UPPERCASE', label: 'Uppercase' },
  { value: 'LOWERCASE', label: 'Lowercase' },
  { value: 'REVERSE', label: 'Reverse String' },
  { value: 'WORD_COUNT', label: 'Word Count' }
];

export default function TaskForm({ onCreate }) {
  const [title, setTitle] = useState('');
  const [inputText, setInputText] = useState('');
  const [operation, setOperation] = useState('UPPERCASE');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onCreate({ title, inputText, operation });
      setTitle('');
      setInputText('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <h2>New task</h2>
      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Reverse the greeting" />
      <label>Input text</label>
      <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} required rows={4} />
      <label>Operation</label>
      <select value={operation} onChange={(e) => setOperation(e.target.value)}>
        {OPERATIONS.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>
      <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create & run task'}</button>
    </form>
  );
}
