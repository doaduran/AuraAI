export function fitPhoto(width, height, maxSide = 1024) {
  if (!(width > 0 && height > 0)) throw new Error('Invalid photo dimensions');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareWardrobePhoto(uri, base64, mimeType, platform) {
  if (platform !== 'web') return { uri: `data:${mimeType};base64,${base64}`, base64, mimeType };
  // Expo's web picker returns original file data; quality alone does not resize it.
  const image = await new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Fotoğraf okunamadı. JPEG veya PNG olarak tekrar dene.'));
    img.src = uri;
  });
  const size = fitPhoto(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#FAF8F5';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);
  const result = canvas.toDataURL('image/jpeg', 0.78);
  canvas.width = canvas.height = 0;
  return { uri: result, base64: result.split(',')[1], mimeType: 'image/jpeg' };
}

export function createPhotoQueue(processPhoto, onCount = () => {}) {
  let running = false;
  const pending = [];
  return {
    get count() { return pending.length + Number(running); },
    add(photos) {
      pending.push(...photos);
      if (running) { onCount(this.count); return; }
      const drain = async () => {
        running = true;
        while (pending.length) {
          const photo = pending.shift();
          onCount(pending.length + 1);
          try { await processPhoto(photo); } catch (error) { console.log('Photo queue:', error); }
        }
        running = false;
        onCount(0);
      };
      void drain();
    },
  };
}
