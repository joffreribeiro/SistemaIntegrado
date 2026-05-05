// firebase-init.js
// Inicializa Firebase, autenticação (Email/Password) e funções de load/save para Firestore

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, getIdTokenResult } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC3euGrayxErDKDJvHT5WN6ixkeqTwwp8M",
  authDomain: "ponto-68b4a.firebaseapp.com",
  projectId: "ponto-68b4a",
  storageBucket: "ponto-68b4a.firebasestorage.app",
  messagingSenderId: "516394911771",
  appId: "1:516394911771:web:89c861d000cb95a594d0be"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Controle de debug: por padrão falso. Para ativar em runtime, defina
// `window.__FIREBASE_DEBUG__ = true` antes de carregar o módulo.
const FIREBASE_DEBUG = (typeof window !== 'undefined' && !!window.__FIREBASE_DEBUG__) || false;

// State interno para aguardar auth
let _user = null;
onAuthStateChanged(auth, async (user) => {
  _user = user;
  // atualizar estado síncrono exposto para permitir checagens rápidas
  try {
    if (!window.FirebaseSync) window.FirebaseSync = {};
    window.FirebaseSync._currentUserSync = user || null;
    if (user) {
      // buscar claims
      try {
        const idRes = await getIdTokenResult(user);
        const isAdmin = !!(idRes && idRes.claims && idRes.claims.admin);
        window.FirebaseSync._isAdminSync = isAdmin;
      } catch (e) {
        window.FirebaseSync._isAdminSync = false;
      }
    } else {
      window.FirebaseSync._isAdminSync = false;
    }
  } catch (e) {
    if (FIREBASE_DEBUG) console.warn('Erro ao atualizar estado síncrono FirebaseSync:', e);
  }
});

// Login anônimo removido — o projeto exige login explícito (Email/Password).
// O usuário deve efetuar login pelo modal para obter acesso de escrita.

// Expor helpers adicionais de autenticação
async function signIn(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Após login, forçar refresh do token para obter claims atualizadas (ex.: admin)
    if (cred && cred.user) {
      try {
        await cred.user.getIdToken(true);
        const idRes = await getIdTokenResult(cred.user);
        const isAdmin = !!(idRes && idRes.claims && idRes.claims.admin);
        if (window.FirebaseSync) {
          window.FirebaseSync._isAdminSync = isAdmin;
          window.FirebaseSync._currentUserSync = cred.user;
        }
      } catch (_) { /* token refresh best-effort */ }
    }
    return cred;
  } catch (e) {
    // Traduzir erros comuns para mensagens amigáveis
    if (e && e.code === 'auth/admin-restricted-operation') {
      throw new Error('Cadastro de novos usuários está desabilitado. Peça ao administrador para criar sua conta.');
    }
    if (e && e.code === 'auth/wrong-password') {
      throw new Error('Senha incorreta.');
    }
    if (e && e.code === 'auth/user-not-found') {
      throw new Error('Usuário não encontrado. Verifique o email.');
    }
    if (e && e.code === 'auth/invalid-credential') {
      throw new Error('Email ou senha inválidos.');
    }
    throw e;
  }
}

async function doSignOut() {
  return signOut(auth);
}

async function getCurrentUser() {
  return auth.currentUser || null;
}

// Versão síncrona útil para checagens rápidas no código que não é async
function getCurrentUserSync() {
  return auth.currentUser || null;
}

// Lança erro se não houver usuário autenticado (síncrono)
function requireAuthSync() {
  const u = getCurrentUserSync();
  if (!u) throw new Error('Usuário não autenticado');
  return u;
}

function getIsAdminSync() {
  try {
    if (window.FirebaseSync && typeof window.FirebaseSync._isAdminSync !== 'undefined') return !!window.FirebaseSync._isAdminSync;
    // fallback: false
    return false;
  } catch (e) { return false; }
}

function requireAdminSync() {
  const u = getCurrentUserSync();
  if (!u) throw new Error('Usuário não autenticado');
  if (!getIsAdminSync()) throw new Error('Ação restrita: usuário não é admin');
  return true;
}

async function getClaims() {
  if (!auth.currentUser) return null;
  const idRes = await getIdTokenResult(auth.currentUser);
  return idRes ? idRes.claims : null;
}

// Helper: aguardar usuário autenticado (máx 8s)
function waitForUser(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (auth.currentUser) return resolve(auth.currentUser);
    let waited = 0;
    const interval = 200;
    const t = setInterval(() => {
      if (auth.currentUser) {
        clearInterval(t);
        return resolve(auth.currentUser);
      }
      waited += interval;
      if (waited >= timeoutMs) {
        clearInterval(t);
        return reject(new Error('Timeout aguardando autenticação Firebase'));
      }
    }, interval);
  });
}

// Carrega dados do Firestore doc 'ponto/{uid}'. Retorna objeto de dados ou null
export async function loadFromFirestore() {
  await waitForUser();
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário Firebase não autenticado');
  const docRef = doc(db, 'ponto', user.uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  return data.dados || null;
}

// Salva dados no Firestore (merge)
export async function saveToFirestore(dados) {
  await waitForUser();
  const user = auth.currentUser;
  if (!user) throw new Error('Usuário Firebase não autenticado');
  const docRef = doc(db, 'ponto', user.uid);
  await setDoc(docRef, { dados }, { merge: true });
}

// Utilitário para sincronizar dados com o Firestore (apenas cloud, sem salvar local — evita loop)
export async function syncToCloud(dados) {
  try {
    await saveToFirestore(dados);
    return { ok: true };
  } catch (e) {
    if (FIREBASE_DEBUG) console.warn('Falha ao salvar no Firestore:', e);
    return { ok: false, error: e };
  }
}

// Expor helpers no global para uso no console e no app
window.FirebaseSync = {
  loadFromFirestore,
  saveToFirestore,
  syncToCloud
};

// adicionar helpers de auth ao global
window.FirebaseSync.signIn = signIn;
window.FirebaseSync.signOut = doSignOut;
window.FirebaseSync.waitForUser = waitForUser;
window.FirebaseSync.onAuthStateChanged = function(cb) { return onAuthStateChanged(auth, cb); };
window.FirebaseSync.getCurrentUser = getCurrentUser;
window.FirebaseSync.getClaims = getClaims;
window.FirebaseSync.getCurrentUserSync = getCurrentUserSync;
window.FirebaseSync.requireAuthSync = requireAuthSync;
window.FirebaseSync.getIsAdminSync = getIsAdminSync;
window.FirebaseSync.requireAdminSync = requireAdminSync;

if (FIREBASE_DEBUG) {
  try {
    console.info('Firebase init carregado');
    console.info('FirebaseSync helpers:', Object.keys(window.FirebaseSync || {}));
  } catch (e) { /* ignore */ }
}
