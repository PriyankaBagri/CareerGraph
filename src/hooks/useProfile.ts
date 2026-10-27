import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

// Current user + profile from AuthContext (null until both exist).
export function useProfile() {
  const { user, profile } = useAuth();
  return useMemo(() => (user && profile ? { user, profile } : null), [user, profile]);
}
