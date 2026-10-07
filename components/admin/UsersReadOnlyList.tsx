'use client';

import React from 'react';

export type AdminUserRecord = {
  id: string;
  name: string;
  phone: string;
  is_admin: boolean | null;
  is_active: boolean | null;
  created_at: string | null;
  last_login: string | null;
};

export function flagLabel(value: boolean | null, whenTrue: string, whenFalse: string): string {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return 'Unknown';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

export function parseAdminUsers(body: unknown): AdminUserRecord[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const users = (body as { users?: unknown }).users;
  if (!Array.isArray(users)) return null;
  const parsed: AdminUserRecord[] = [];
  for (const row of users) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.phone !== 'string') return null;
    if (!isNullableBoolean(record.is_admin) || !isNullableBoolean(record.is_active)) return null;
    if (!isNullableString(record.created_at) || !isNullableString(record.last_login)) return null;
    const keys = Object.keys(record);
    if (keys.some(key => !['id', 'name', 'phone', 'is_admin', 'is_active', 'created_at', 'last_login'].includes(key))) return null;
    parsed.push({
      id: record.id,
      name: record.name,
      phone: record.phone,
      is_admin: record.is_admin,
      is_active: record.is_active,
      created_at: record.created_at,
      last_login: record.last_login,
    });
  }
  return parsed;
}

function formatWhen(value: string | null): string {
  if (!value) return 'Unknown';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : 'Unknown';
}

export function UsersReadOnlyList({ users }: { users: AdminUserRecord[] }) {
  if (users.length === 0) {
    return <p className="text-center py-12 text-gray-400 font-medium">No accounts to show</p>;
  }
  return (
    <div className="space-y-3">
      {users.map(user => (
        <div key={user.id} className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${user.is_admin === true ? 'bg-purple-600' : 'bg-blue-600'}`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-gray-900 flex items-center gap-2">
                {user.name}
                <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                  {flagLabel(user.is_admin, 'Admin', 'Not admin')}
                </span>
                <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                  {flagLabel(user.is_active, 'Active', 'Inactive')}
                </span>
              </div>
              <div className="text-sm text-gray-500">{user.phone}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-400">
            Created {formatWhen(user.created_at)} · Last login {formatWhen(user.last_login)}
          </div>
        </div>
      ))}
    </div>
  );
}