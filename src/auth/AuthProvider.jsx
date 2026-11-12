import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, completeRedirectSignIn, firebaseEnabled, signInWithGoogle, signOutUser } from '../firebase/client.js';
import { friendlyAuthError } from '../firebase/authFlow.js';

const AuthContext = createContext(null);

const demoUser = {
  uid: 'demo-user',
  displayName: 'Demo Collaborator',
  email: 'demo@example.com',
  photoURL: null,
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(firebaseEnabled ? null : demoUser);
  const [loading, setLoading] = useState(firebaseEnabled);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!firebaseEnabled) return undefined;
    let active = true;
    completeRedirectSignIn().catch((problem) => { if (active) setAuthError(friendlyAuthError(problem)); });
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  async function signIn() {
    setAuthError('');
    try { return await signInWithGoogle(); }
    catch (problem) { const message = friendlyAuthError(problem); setAuthError(message); throw new Error(message); }
  }

  const value = useMemo(() => ({
    user,
    loading,
    authError,
    clearAuthError: () => setAuthError(''),
    demoMode: !firebaseEnabled,
    signIn,
    signOut: signOutUser,
  }), [user, loading, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
