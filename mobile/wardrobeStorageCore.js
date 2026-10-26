// Serialize snapshots so a slower old save cannot overwrite a newer wardrobe.
export function createWardrobeStorage(legacy, store) {
  const key = 'aura_wardrobe';
  let writes = Promise.resolve();
  return {
    async getItem() {
      const current = await store.get(key);
      if (current != null) return current;
      const previous = await legacy.getItem(key);
      if (previous != null) {
        JSON.parse(previous); // Never replace a broken record with an empty wardrobe.
        await store.set(key, previous);
        await legacy.removeItem(key);
      }
      return previous;
    },
    setItem(value) {
      const next = writes.catch(() => {}).then(() => store.set(key, value));
      writes = next;
      return next;
    },
  };
}
