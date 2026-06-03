/**
 * DownloadManager - Packages a page into a ZIP (Markdown + images)
 * Uses JSZip + Data URL to avoid Blob URL revocation race conditions.
 */

import JSZip from 'jszip';

export class DownloadManager {
  constructor() {
    /** @type {AbortController|null} */
    this._controller = null;
  }

  /**
   * Pack markdown and images into a ZIP Blob
   * @param {string} pageTitle
   * @param {string} markdown
   * @param {string[]} imageUrls
   * @param {Function} onProgress (stage, current, total) => void
   * @returns {Promise<Blob>}
   */
  async pack(pageTitle, markdown, imageUrls, onProgress) {
    this._controller = new AbortController();
    const zip = new JSZip();

    // Add markdown (rewrite image URLs to relative paths)
    let md = markdown;
    const imageMap = new Map(); // url -> filename

    imageUrls.forEach((url, idx) => {
      const ext = url.split('.').pop().split('?')[0] || 'png';
      const filename = `image_${String(idx + 1).padStart(3, '0')}.${ext}`;
      imageMap.set(url, `images/${filename}`);
      md = md.replace(url, `images/${filename}`);
    });

    zip.file(`${pageTitle}.md`, md);

    // Metadata
    zip.file('metadata.json', JSON.stringify({
      source_url: '', // will be filled by caller if needed
      download_time: new Date().toISOString(),
      paragraph_count: 0, // filled by caller
      image_count: imageUrls.length,
    }, null, 2));

    const imagesFolder = zip.folder('images');

    // Fetch images with progress
    let fetched = 0;
    for (const [url, filename] of imageMap) {
      if (this._controller.signal.aborted) {
        throw new Error('Download cancelled');
      }

      try {
        const blob = await this._fetchImage(url);
        imagesFolder.file(filename, blob);
      } catch (err) {
        // no-cors fallback: keep original URL in markdown, skip binary
        console.warn(`Failed to fetch image: ${url}`, err.message);
      }

      fetched++;
      onProgress('images', fetched, imageUrls.length);
    }

    onProgress('packing', 0, 0);
    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE' },
      (meta) => {
        // JSZip progress callback not very granular; we report packing once
      }
    );

    return zipBlob;
  }

  /**
   * Convert Blob to base64 Data URL (binary-safe).
   * Uses Response+arrayBuffer (available in SW) — NOT FileReader.
   */
  async toDataUrl(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Chunked binary-safe base64 encoding
    const CHUNK = 0x8000; // 32 KB
    let base64 = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const chunk = bytes.subarray(i, i + CHUNK);
      base64 += String.fromCharCode.apply(null, chunk);
    }
    return 'data:application/zip;base64,' + btoa(base64);
  }

  /**
   * Cancel an ongoing download
   */
  cancel() {
    this._controller?.abort();
  }

  /**
   * Cleanup
   */
  dispose() {
    this.cancel();
  }

  // ------------------------------------------------------------------

  async _fetchImage(url) {
    try {
      const res = await fetch(url, { signal: this._controller?.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.blob();
    } catch (err) {
      // no-cors fallback: try opaque request
      try {
        const res = await fetch(url, { mode: 'no-cors', signal: this._controller?.signal });
        return await res.blob();
      } catch (fallbackErr) {
        throw err; // report original error
      }
    }
  }
}
