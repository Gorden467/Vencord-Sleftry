/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { createRoot, UserProfileSettingsStore } from "@webpack/common";
import type { Root } from "react-dom/client";

import { QuickButton } from "./ui/Manager";

let observer: MutationObserver | undefined,
    frame = 0,
    root: Root | undefined,
    host: HTMLDivElement | undefined;
function remove() {
    root?.unmount();
    root = undefined;
    host?.remove();
    host = undefined;
}
/**
 * Additive DOM mount, with no Discord source patch. The semantic bio/pronouns
 * controls must both exist in the same global-profile form. On UI changes this
 * fails closed; Settings and Toolbox remain available.
 */
function reconcile() {
    frame = 0;
    try {
        mountRecognizedForm();
    } catch {
        // A changed native form must never break Discord's editor.
        observer?.disconnect();
        observer = undefined;
        remove();
    }
}
function mountRecognizedForm() {
    if (host && !host.isConnected) remove();
    if (UserProfileSettingsStore.selectedGuildId != null) {
        remove();
        return;
    }
    const bio = [...document.querySelectorAll<HTMLTextAreaElement>('textarea[maxlength="190"]')].find(
        n => !n.closest("[data-pmpro-root]") && n.getClientRects().length > 0,
    );
    if (!bio) {
        remove();
        return;
    }
    let container: HTMLElement | null = bio.parentElement;
    let anchor: HTMLElement | null = null;
    for (let depth = 0; container && depth < 9; depth++, container = container.parentElement) {
        if (container === document.body || container.getAttribute("role") === "dialog") break;
        if (
            container.querySelector('input[maxlength="40"],textarea[maxlength="40"]') &&
            !container.closest("[data-pmpro-root]")
        ) {
            anchor = container;
            break;
        }
    }
    if (!anchor) {
        remove();
        return;
    }
    if (host?.parentElement === anchor) return;
    remove();
    host = document.createElement("div");
    host.dataset.pmproRoot = "native-host";
    anchor.prepend(host);
    root = createRoot(host);
    root.render(
        <ErrorBoundary noop>
            <QuickButton />
        </ErrorBoundary>,
    );
}
export function startIntegration() {
    if (observer) return;
    observer = new MutationObserver(() => {
        if (!frame) frame = requestAnimationFrame(reconcile);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    frame = requestAnimationFrame(reconcile);
}
export function stopIntegration() {
    observer?.disconnect();
    observer = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    remove();
}
