import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWardrobeStorage } from './wardrobeStorageCore';

let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('aura-closet', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('wardrobe');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Photo storage is blocked. Close other Aura tabs and retry.'));
    request.onsuccess = () => resolve(request.result);
  }).catch(error => { database = null; throw error; });
  return database;
}

async function transaction(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('wardrobe', mode);
    const request = action(tx.objectStore('wardrobe'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Photo storage failed'));
    tx.onerror = () => reject(tx.error || request.error);
  });
}

export default createWardrobeStorage(AsyncStorage, {
  get: key => transaction('readonly', store => store.get(key)),
  set: (key, value) => transaction('readwrite', store => store.put(value, key)),
});
