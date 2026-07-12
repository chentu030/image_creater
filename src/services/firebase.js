/**
 * Firebase 服務層
 * 負責 Firebase 初始化、Google 認證、Firestore CRUD、Storage 上傳/下載
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadString,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject
} from 'firebase/storage';

// ─── Firebase 初始化 ───
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 如果缺少必要設定，不初始化（讓 app 可以在沒有 Firebase 時仍能運作）
const hasConfig = firebaseConfig.apiKey && firebaseConfig.projectId;

let app = null;
let auth = null;
let db = null;
let storage = null;

if (hasConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

export { auth, db, storage };

// ─── 認證 ───
const provider = new GoogleAuthProvider();

export function onAuthChange(callback) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase 未初始化');
  try {
    // 先嘗試 popup（桌面端較好用）
    return await signInWithPopup(auth, provider);
  } catch (err) {
    // 如果 popup 被阻擋（手機瀏覽器常見），改用 redirect
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
      return await signInWithRedirect(auth, provider);
    }
    throw err;
  }
}

export async function checkRedirectResult() {
  if (!auth) return null;
  try {
    return await getRedirectResult(auth);
  } catch {
    return null;
  }
}

export async function signOut() {
  if (!auth) return;
  return firebaseSignOut(auth);
}

// ─── 工具函式 ───
function getUserPath(uid) {
  return `users/${uid}`;
}

// 壓縮圖片以適合 Storage（控制尺寸和品質）
function compressForStorage(dataUrl, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ─── Storage 操作 ───

/**
 * 上傳 data URL 圖片到 Firebase Storage
 * @returns {string} 下載 URL
 */
export async function uploadImageToStorage(uid, dataUrl, folder = 'reference-images') {
  if (!storage) throw new Error('Firebase Storage 未初始化');
  const compressed = await compressForStorage(dataUrl);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path = `${getUserPath(uid)}/${folder}/${fileName}`;
  const fileRef = storageRef(storage, path);
  await uploadString(fileRef, compressed, 'data_url');
  return getDownloadURL(fileRef);
}

/**
 * 將圖片 URL 或 data URL 轉為縮圖 data URL
 */
function createThumbnail(src, maxWidth = 300, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * 上傳生成結果（圖片或影片 URL）到 Firebase Storage
 * 如果是 data URL，直接上傳；如果是遠端 URL，先下載再上傳
 * 圖片會同時生成縮圖
 * @returns {{ url: string, thumbnailUrl?: string }}
 */
export async function uploadGeneratedToStorage(uid, url, type = 'image') {
  if (!storage) throw new Error('Firebase Storage 未初始化');
  const ext = type === 'video' ? 'mp4' : 'png';
  const baseName = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${getUserPath(uid)}/generated/${baseName}.${ext}`;
  const fileRef = storageRef(storage, path);

  if (url.startsWith('data:')) {
    await uploadString(fileRef, url, 'data_url');
  } else {
    // 遠端 URL → fetch → uploadBytes
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await uploadBytes(fileRef, blob);
    } catch (e) {
      console.warn('上傳生成結果到 Storage 失敗，跳過:', e);
      return { url }; // fallback
    }
  }

  const fullUrl = await getDownloadURL(fileRef);

  // 圖片才生成縮圖
  let thumbnailUrl = null;
  if (type === 'image') {
    try {
      const thumbDataUrl = await createThumbnail(url.startsWith('data:') ? url : fullUrl);
      if (thumbDataUrl) {
        const thumbPath = `${getUserPath(uid)}/generated/thumbs/${baseName}.jpg`;
        const thumbRef = storageRef(storage, thumbPath);
        await uploadString(thumbRef, thumbDataUrl, 'data_url');
        thumbnailUrl = await getDownloadURL(thumbRef);
      }
    } catch (e) {
      console.warn('縮圖生成失敗，跳過:', e);
    }
  }

  return { url: fullUrl, thumbnailUrl };
}

/**
 * 列出使用者上傳的所有參考圖
 * @returns {Array<{url: string, path: string}>}
 */
export async function listUserReferenceImages(uid) {
  if (!storage) return [];
  const folderRef = storageRef(storage, `${getUserPath(uid)}/reference-images`);
  try {
    const result = await listAll(folderRef);
    const urls = await Promise.all(
      result.items.map(async (item) => ({
        url: await getDownloadURL(item),
        path: item.fullPath
      }))
    );
    return urls;
  } catch {
    return [];
  }
}

/**
 * 刪除 Storage 中的檔案
 */
export async function deleteFromStorage(path) {
  if (!storage) return;
  const fileRef = storageRef(storage, path);
  try {
    await deleteObject(fileRef);
  } catch (e) {
    console.warn('刪除 Storage 檔案失敗:', e);
  }
}

// ─── Firestore: 對話主題 (BrainstormHub) ───

/**
 * 儲存所有對話主題到 Firestore
 * 注意：對話訊息中的圖片（data URL）不存 Firestore（太大），
 * 改為先上傳到 Storage 再存 URL
 */
export async function saveBrainstormTopics(uid, topics) {
  if (!db) return;
  const batch = writeBatch(db);
  const colRef = collection(db, getUserPath(uid), 'brainstorm_topics');

  // 先取得現有的主題 IDs，以便刪除不在新列表中的
  const existingDocs = await getDocs(colRef);
  const existingIds = new Set(existingDocs.docs.map(d => d.id));
  const newIds = new Set(topics.map(t => t.id));

  // 刪除不在新列表中的
  for (const id of existingIds) {
    if (!newIds.has(id)) {
      batch.delete(doc(colRef, id));
    }
  }

  // 新增或更新
  for (const topic of topics) {
    // 清理訊息中的大型 data URL 圖片（避免 Firestore 1MB 限制）
    const cleanMessages = (topic.messages || []).map(msg => {
      if (msg.images && msg.images.length > 0) {
        // 只保留已經是 http URL 的圖片，data URL 太大不存
        return {
          ...msg,
          images: msg.images.filter(img => img.startsWith('http'))
        };
      }
      return msg;
    });

    // 主題圖片也只保留 http URL
    const cleanImages = (topic.images || []).filter(img => img.startsWith('http'));

    batch.set(doc(colRef, topic.id), {
      ...topic,
      messages: cleanMessages,
      images: cleanImages,
      updatedAt: topic.updatedAt || new Date().toISOString()
    });
  }

  await batch.commit();
}

/**
 * 載入所有對話主題
 */
export async function loadBrainstormTopics(uid) {
  if (!db) return [];
  const colRef = collection(db, getUserPath(uid), 'brainstorm_topics');
  const q = query(colRef, orderBy('updatedAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Firestore: 生成歷史 ───

/**
 * 新增一筆生成紀錄
 * @param record { type: 'image'|'video', model, prompt, outputUrl, referenceImages?, timestamp }
 */
export async function saveGenerationRecord(uid, record) {
  if (!db) return;
  const colRef = collection(db, getUserPath(uid), 'generation_history');
  const docRef = doc(colRef);
  await setDoc(docRef, {
    ...record,
    timestamp: record.timestamp || new Date().toISOString(),
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

/**
 * 載入生成歷史（最新 100 筆）
 */
export async function loadGenerationHistory(uid, maxCount = 100) {
  if (!db) return [];
  const colRef = collection(db, getUserPath(uid), 'generation_history');
  const q = query(colRef, orderBy('timestamp', 'desc'), limit(maxCount));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Firestore: 使用者設定 ───

/**
 * 儲存使用者設定（模型選擇、prompt 等）
 */
export async function saveUserSettings(uid, settings) {
  if (!db) return;
  const docRef = doc(db, getUserPath(uid), 'settings', 'preferences');
  await setDoc(docRef, {
    ...settings,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

/**
 * 載入使用者設定
 */
export async function loadUserSettings(uid) {
  if (!db) return null;
  const docRef = doc(db, getUserPath(uid), 'settings', 'preferences');
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

/**
 * 儲存參考圖記錄到 Firestore（含 Storage URL + 群組 ID）
 */
export async function saveReferenceImageRecord(uid, imageUrl, storagePath, groupId = null) {
  if (!db) return;
  const colRef = collection(db, getUserPath(uid), 'reference_images');
  const docRef = doc(colRef);
  await setDoc(docRef, {
    url: imageUrl,
    storagePath: storagePath || null,
    groupId: groupId || 'default',
    uploadedAt: new Date().toISOString()
  });
  return docRef.id;
}

/**
 * 載入所有參考圖記錄（可選群組篩選）
 */
export async function loadReferenceImages(uid, groupId = null) {
  if (!db) return [];
  const colRef = collection(db, getUserPath(uid), 'reference_images');
  const q = query(colRef, orderBy('uploadedAt', 'desc'));
  const snapshot = await getDocs(q);
  const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  if (groupId && groupId !== 'all') {
    return all.filter(img => (img.groupId || 'default') === groupId);
  }
  return all;
}

/**
 * 刪除參考圖記錄 + Storage 檔案
 */
export async function deleteReferenceImage(uid, docId, storagePath) {
  if (!db) return;
  await deleteDoc(doc(db, getUserPath(uid), 'reference_images', docId));
  if (storagePath) {
    await deleteFromStorage(storagePath);
  }
}

// ─── Firestore: 參考圖群組 ───

/**
 * 建立新群組
 */
export async function createRefGroup(uid, name) {
  if (!db) return null;
  const colRef = collection(db, getUserPath(uid), 'ref_groups');
  const docRef = doc(colRef);
  await setDoc(docRef, {
    name,
    createdAt: new Date().toISOString()
  });
  return { id: docRef.id, name };
}

/**
 * 載入所有群組
 */
export async function loadRefGroups(uid) {
  if (!db) return [];
  const colRef = collection(db, getUserPath(uid), 'ref_groups');
  const q = query(colRef, orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * 重命名群組
 */
export async function renameRefGroup(uid, groupId, newName) {
  if (!db) return;
  const docRef = doc(db, getUserPath(uid), 'ref_groups', groupId);
  await setDoc(docRef, { name: newName }, { merge: true });
}

/**
 * 刪除群組（群組內的圖片改歸到 default）
 */
export async function deleteRefGroup(uid, groupId) {
  if (!db) return;
  // 將該群組的圖片改為 default
  const imgColRef = collection(db, getUserPath(uid), 'reference_images');
  const snapshot = await getDocs(imgColRef);
  const batch = writeBatch(db);
  for (const d of snapshot.docs) {
    if (d.data().groupId === groupId) {
      batch.update(doc(imgColRef, d.id), { groupId: 'default' });
    }
  }
  // 刪除群組文件
  batch.delete(doc(db, getUserPath(uid), 'ref_groups', groupId));
  await batch.commit();
}

// ─── 社群創作區 (Content Creator) ───

// 角色人設
export async function saveCharactersData(uid, data) {
  if (!db) return;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'characters');
  await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadCharactersData(uid) {
  if (!db) return null;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'characters');
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

// 劇情庫
export async function saveStoriesData(uid, data) {
  if (!db) return;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'stories');
  await setDoc(docRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadStoriesData(uid) {
  if (!db) return null;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'stories');
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

// 漫畫劇情聊天記錄
export async function saveContentChatSessions(uid, sessions) {
  if (!db) return;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'chat-sessions');
  await setDoc(docRef, { sessions, updatedAt: serverTimestamp() }, { merge: true });
}

export async function loadContentChatSessions(uid) {
  if (!db) return null;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'chat-sessions');
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

// 績效數據（CSV 上傳後的解析結果）
export async function savePerformanceData(uid, data) {
  if (!db) return;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'performance');
  await setDoc(docRef, { ...data, uploadedAt: serverTimestamp() }, { merge: true });
}

export async function loadPerformanceData(uid) {
  if (!db) return null;
  const docRef = doc(db, getUserPath(uid), 'content-creator', 'performance');
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

// ─── 是否已設定 Firebase ───
export function isFirebaseConfigured() {
  return hasConfig;
}

