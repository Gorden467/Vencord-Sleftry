/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MAX_MEDIA_BYTES, Media, MediaMime } from "./types";
import { validateMedia } from "./validation";

export function identify(bytes: Uint8Array): { mime: MediaMime; animated: boolean } {
    const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
    if (ascii(0, 3) === "GIF" && ["87a", "89a"].includes(ascii(3, 3))) {
        if (bytes.length < 14) throw new Error("Malformed GIF.");
        let offset = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0),
            frames = 0;
        const skipBlocks = () => {
            while (offset < bytes.length) {
                const length = bytes[offset++];
                if (length === 0) return;
                offset += length;
                if (offset > bytes.length) throw new Error("Malformed GIF data block.");
            }
            throw new Error("Incomplete GIF.");
        };
        while (offset < bytes.length) {
            const marker = bytes[offset++];
            if (marker === 0x3b) break;
            if (marker === 0x21) {
                offset++;
                skipBlocks();
                continue;
            }
            if (marker !== 0x2c || offset + 9 > bytes.length) throw new Error("Malformed GIF frame.");
            const packed = bytes[offset + 8];
            offset += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
            offset++; // LZW minimum code size.
            skipBlocks();
            frames++;
        }
        if (!frames) throw new Error("GIF contains no image frames.");
        return { mime: "image/gif", animated: frames > 1 };
    }
    if (bytes[0] === 0x89 && ascii(1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10) {
        let offset = 8,
            animated = false;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        while (offset + 12 <= bytes.length) {
            const type = ascii(offset + 4, 4),
                length = view.getUint32(offset);
            if (type === "acTL") animated = true;
            if (length > bytes.length - offset - 12) throw new Error("Malformed PNG.");
            offset += length + 12;
        }
        return { mime: "image/png", animated };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", animated: false };
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
        let offset = 12,
            animated = false;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        while (offset + 8 <= bytes.length) {
            const type = ascii(offset, 4),
                length = view.getUint32(offset + 4, true);
            if (type === "ANIM" || type === "ANMF") animated = true;
            if (length > bytes.length - offset - 8) throw new Error("Malformed WebP.");
            offset += 8 + length + (length % 2);
        }
        return { mime: "image/webp", animated };
    }
    throw new Error("Choose a PNG, JPEG, GIF or WebP image. SVG and executable files are not accepted.");
}
export async function sha256(bytes: Uint8Array): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
function bytesToData(bytes: Uint8Array, mime: MediaMime): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${mime};base64,${btoa(binary)}`;
}
export function decodeData(media: Media): Uint8Array {
    const binary = atob(media.data.slice(media.data.indexOf(",") + 1));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export async function loadImage(data: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image could not be decoded."));
        img.src = data;
    });
}
export async function mediaFromBytes(bytes: Uint8Array): Promise<Media> {
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error("Images must be smaller than 8 MiB.");
    const kind = identify(bytes);
    const data = bytesToData(bytes, kind.mime);
    const img = await loadImage(data);
    return validateMedia({
        ...kind,
        data,
        sha256: await sha256(bytes),
        bytes: bytes.length,
        width: img.naturalWidth,
        height: img.naturalHeight,
    })!;
}
export async function mediaFromFile(file: File): Promise<Media> {
    if (file.size > MAX_MEDIA_BYTES) throw new Error("Image exceeds the 8 MiB limit.");
    return mediaFromBytes(new Uint8Array(await file.arrayBuffer()));
}
export async function verifyMedia(media: Media | null): Promise<void> {
    if (!media) return;
    validateMedia(media);
    const bytes = decodeData(media),
        kind = identify(bytes);
    if (kind.mime !== media.mime || kind.animated !== media.animated || (await sha256(bytes)) !== media.sha256)
        throw new Error("Image data or animation metadata is corrupted.");
    const img = await loadImage(media.data);
    if (img.naturalWidth !== media.width || img.naturalHeight !== media.height)
        throw new Error("Image dimensions do not match the saved metadata.");
}
export async function downloadDiscordMedia(
    accountId: string,
    hash: string | null,
    type: "avatars" | "banners",
): Promise<Media | null> {
    if (!hash) return null;
    if (!/^\d{5,22}$/.test(accountId) || !/^(a_)?[a-f0-9]{16,128}$/i.test(hash))
        throw new Error("Invalid Discord image identifier.");
    const url = `https://cdn.discordapp.com/${type}/${accountId}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=4096`;
    const response = await fetch(url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
        throw new Error(
            `Could not save ${type === "avatars" ? "avatar" : "banner"}: Discord CDN returned HTTP ${response.status}. No incomplete preset was saved.`,
        );
    const claimed = Number(response.headers.get("content-length"));
    if (claimed > MAX_MEDIA_BYTES) throw new Error("Discord image exceeds 8 MiB. Use a smaller original file.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Discord CDN returned no image data.");
    const parts: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > MAX_MEDIA_BYTES) {
            await reader.cancel();
            throw new Error("Discord image exceeds 8 MiB.");
        }
        parts.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return mediaFromBytes(bytes);
}
/** Animated originals are never flattened by the crop tool. */
export async function cropMedia(media: Media, aspect: number, zoom: number, x: number, y: number): Promise<Media> {
    if (media.animated) throw new Error("Cropping animated images is disabled to preserve every frame.");
    const img = await loadImage(media.data);
    const baseW = Math.min(img.naturalWidth, img.naturalHeight * aspect);
    const baseH = baseW / aspect;
    const sw = baseW / zoom,
        sh = baseH / zoom;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(aspect === 1 ? 1024 : 1800, Math.max(1, Math.round(sw)));
    canvas.height = Math.max(1, Math.round(canvas.width / aspect));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image cropping is not available.");
    ctx.drawImage(
        img,
        ((img.naturalWidth - sw) * x) / 100,
        ((img.naturalHeight - sh) * y) / 100,
        sw,
        sh,
        0,
        0,
        canvas.width,
        canvas.height,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Could not crop image."))), "image/png"),
    );
    return mediaFromBytes(new Uint8Array(await blob.arrayBuffer()));
}
