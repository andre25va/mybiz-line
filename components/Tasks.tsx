'use client';
import { useState, useEffect } from 'react';
import { Plus, CheckCircle, Circle, Trash2, ClipboardList } from 'lucide-react';

export interface Task {
  id: string;
  title: string;
  notes?: string;
  business: string;
  done: boolean;
  due_date?: string;
  created_at: string;
}

const BUSINESSES = [
  { id: 'general', name: 'General', color: '#6b7280' },
  { id: 'myredeal', name: 'MyReDeal', color: '#16a34a' },
  { id: 'contractors-kc', name: 'Contractors of KC', color: '#ea580c' },
];

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', notes: '', business: 'general', due_date: '' });

  const load = async () => {
    const r = await fetch('/api/tasks');
    const d = await r.json();
    setTasks(Array.isArray(d) ? d : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addTask = async () => {
    if (!form.title.trim()) return;
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setAdding(false);
    setForm({ title: '', notes: '', business: 'general', due_date: '' });
    load();
  };

  const toggle = async (task: Task) => {
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, done: !task.done }),
    });
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, done: !t.done } : t));
  };

  const del = async (id: string) => {
    await fetch(`/api/tasks?id=${id}`, { method: 'DELETE' });
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const active = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <span className="font-semibold text-text text-base">Tasks</span>
        <button
          onClick={() => setAdding(true)}
          className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center"
        >
          <Plus size={16} className="text-white" />
        </button>
      </div>

      {adding && (
        <div className="mx-4 mb-3 bg-card border border-accent rounded-2xl p-4 space-y-3">
          <input
            autoFocus
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && addTask()}
            placeholder="Task title…"
            className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <select
              value={form.business}
              onChange={e => setForm(p => ({ ...p, business: e.target.value }))}
              className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            >
              {BUSINESSES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input
              type="date"
              value={form.due_date}
              onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
              className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>
          <input
            value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            placeholder="Notes (optional)…"
            className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text placeholder-subtext focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setAdding(false); setForm({ title: '', notes: '', business: 'general', due_date: '' }); }}
              className="flex-1 py-2 rounded-xl border border-border text-subtext text-sm"
            >
              Cancel
            </button>
            <button
              onClick={addTask}
              disabled={!form.title.trim()}
              className="flex-1 py-2 rounded-xl bg-accent text-white text-sm font-medium disabled:opacity-40"
            >
              Add Task
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="text-center py-8 text-subtext text-sm">Loading…</div>
        ) : tasks.length === 0 && !adding ? (
          <div className="text-center py-12">
            <ClipboardList size={40} className="mx-auto text-border mb-3" />
            <p className="text-subtext text-sm">No tasks yet</p>
            <button onClick={() => setAdding(true)} className="mt-3 text-accent text-sm font-medium">
              Add your first task
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {active.map(task => {
              const biz = BUSINESSES.find(b => b.id === task.business);
              return (
                <div key={task.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl">
                  <button onClick={() => toggle(task)} className="text-subtext hover:text-accent flex-shrink-0 transition-colors">
                    <Circle size={20} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text text-sm">{task.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {biz && biz.id !== 'general' && (
                        <span className="text-xs font-medium" style={{ color: biz.color }}>{biz.name}</span>
                      )}
                      {task.due_date && (
                        <span className="text-xs text-subtext">
                          {new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {task.notes && <span className="text-xs text-subtext truncate">{task.notes}</span>}
                    </div>
                  </div>
                  <button onClick={() => del(task.id)} className="text-border hover:text-red-400 transition-colors flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            {done.length > 0 && (
              <>
                <div className="text-xs text-subtext font-medium pt-3 pb-1 px-1">Completed ({done.length})</div>
                {done.map(task => (
                  <div key={task.id} className="flex items-center gap-3 p-3 bg-surface border border-border rounded-2xl opacity-60">
                    <button onClick={() => toggle(task)} className="text-accent flex-shrink-0">
                      <CheckCircle size={20} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-subtext text-sm line-through">{task.title}</div>
                    </div>
                    <button onClick={() => del(task.id)} className="text-border hover:text-red-400 transition-colors flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
