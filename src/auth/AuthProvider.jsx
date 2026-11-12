import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firebaseEnabled, signInWithGoogle, signOutUser } from '../firebase/client.js';

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

  useEffect(() => {
    if (!firebaseEnabled) return undefined;
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    demoMode: !firebaseEnabled,
    signIn: signInWithGoogle,
    signOut: signOutUser,
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
