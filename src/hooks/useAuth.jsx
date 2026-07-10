/**
 * Firebase Auth Context
 * 提供全局的使用者認證狀態 + 登入/登出方法
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  onAuthChange,
  signInWithGoogle,
  signOut,
  checkRedirectResult,
  isFirebaseConfigured
} from '../services/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // Firebase User object
  const [loading, setLoading] = useState(true);  // 初始化中

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }

    // 檢查 redirect 結果（手機 Google 登入回來時）
    checkRedirectResult().catch(() => {});

    // 監聽認證狀態變化
    const unsubscribe = onAuthChange((firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('登入失敗:', err);
      throw err;
    }
  };

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      uid: user?.uid || null,
      displayName: user?.displayName || null,
      photoURL: user?.photoURL || null,
      loading,
      login,
      logout,
      isConfigured: isFirebaseConfigured()
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
