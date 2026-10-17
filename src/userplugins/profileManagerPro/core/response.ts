/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApiFailure } from "./switcher";

export type NativeResponse = {
    status?: number;
    ok?: boolean;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
};
function details(body: Record<string, unknown> | undefined): string {
    if (!body) return "";
    const messages: string[] = [];
    const walk = (value: unknown, path: string, depth: number) => {
        if (depth > 5 || messages.length >= 6 || !value) return;
        if (typeof value === "string") {
            messages.push(`${path}: ${value.slice(0, 180)}`);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(v => walk(v, path, depth + 1));
            return;
        }
        if (typeof value !== "object") return;
        for (const [key, entry] of Object.entries(value)) {
            if (
                [
                    "message",
                    "errors",
                    "_errors",
                    "avatar",
                    "banner",
                    "bio",
                    "pronouns",
                    "global_name",
                    "accent_color",
                    "theme_colors",
                ].includes(key)
            )
                walk(entry, key === "message" || key === "_errors" || key === "errors" ? path : key, depth + 1);
        }
    };
    walk(body, "Discord", 0);
    return messages.join("; ");
}
export function assertResponse(response: NativeResponse | undefined, operation: string): void {
    const status = response?.status ?? 0;
    if (status >= 200 && status < 300 && response?.ok !== false) return;
    const retry = Number(response?.body?.retry_after ?? response?.headers?.["retry-after"] ?? 0);
    const explanation =
        status === 429
            ? "Discord rate limit. Automatic retry is disabled."
            : status === 401 || status === 403
              ? "Discord requires authentication, permission or additional verification. Complete it in the native client."
              : status === 0
                ? "No confirmed response was received. The result may be uncertain; inspect Recovery."
                : details(response?.body);
    throw new ApiFailure(
        `${operation} failed${status ? ` (HTTP ${status})` : ""}. ${explanation || "Discord rejected the request."}`,
        status,
        Number.isFinite(retry) ? Math.max(0, retry * 1000) : 0,
    );
}
