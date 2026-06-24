// Client-side image compression (canvas-based, no npm dependency) — shared by
// anywhere in the app a photo gets uploaded to Supabase Storage. Originally
// lived only in src/routes/inventory.tsx; extracted here so the onboarding
// wizard's "add one inventory item" step can reuse the exact same behaviour
// instead of duplicating it.
// Target: max ~200KB per photo. At 900px / 0.72 quality a typical photo
// compresses to 100-200KB, well within Supabase free-tier storage limits.
const MAX_PHOTO_DIMENSION = 900;
const PHOTO_JPEG_QUALITY = 0.72;

export function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(file); return; }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(width, height));
      const targetW = Math.round(width * scale);
      const targetH = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], newName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        PHOTO_JPEG_QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}
