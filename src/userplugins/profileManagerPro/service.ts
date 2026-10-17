/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showToast } from "@webpack/common";

import { verifyMedia } from "./core/media";
import { Repository } from "./core/repository";
import { messageOf, sameRemote, Switcher } from "./core/switcher";
import {
    AccountDocument,
    Backup,
    MAX_BACKUP_BYTES,
    MIN_ROTATION_MINUTES,
    ProfileFields,
    SwitchProgress,
} from "./core/types";
import { parseBackup } from "./core/validation";
import { discord } from "./discord";

interface State {
    doc: AccountDocument | null;
    error: string | null;
    loading: boolean;
    rotationRunning: boolean;
    nextRotationAt: number | null;
    progress: SwitchProgress;
}
let state: State = {
    doc: null,
    error: null,
    loading: true,
    rotationRunning: false,
    nextRotationAt: null,
    progress: { busy: false, presetId: null, label: "", completed: [], error: null },
};
const listeners = new Set<() => void>();
export const repo = new Repository(DataStore);
let epoch = 0,
    running = false,
    rotationTimer: ReturnType<typeof setTimeout> | undefined;
function patch(update: Partial<State>) {
    state = { ...state, ...update };
    listeners.forEach(listener => listener());
}
export const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
export const getState = () => state;
export const switcher = new Switcher(repo, discord, {
    verifyMedia: async f => {
        await Promise.all([verifyMedia(f.avatar), verifyMedia(f.banner)]);
    },
    changed: () => {
        void refresh();
    },
    progress: p => {
        patch({ progress: p });
    },
    async exclusive(accountId, run) {
        if (!navigator.locks)
            throw new Error("Your Discord runtime lacks Web Locks. Update Discord before switching profiles safely.");
        return navigator.locks.request(`ProfileManagerPro:${accountId}`, { ifAvailable: true }, lock => {
            if (!lock) throw new Error("Another Discord window is switching this account's profile.");
            return run();
        });
    },
});
export function toast(message: string, failed = false) {
    showToast({ text: message, variant: failed ? "critical" : "success" });
}
export async function refresh() {
    const ownEpoch = epoch;
    try {
        const id = discord.accountId();
        const doc = await repo.load(id);
        if (ownEpoch === epoch && running && discord.accountId() === id) patch({ doc, loading: false, error: null });
    } catch (error) {
        if (ownEpoch === epoch && running) patch({ doc: null, loading: false, error: messageOf(error) });
    }
}
export async function verifyActive() {
    const id = discord.accountId(),
        ownEpoch = epoch;
    const remote = await discord.read();
    if (ownEpoch !== epoch || discord.accountId() !== id) return;
    await repo.change(id, d => {
        if (d.activePresetId && !sameRemote(d.activeRemote, remote)) {
            d.activePresetId = null;
            d.activeRemote = null;
        }
    });
    await refresh();
}
export function startService() {
    running = true;
    switcher.start();
    accountChanged();
}
export function stopService() {
    running = false;
    epoch++;
    stopRotation();
    switcher.stop();
    patch({ doc: null, loading: false });
}
export function accountChanged() {
    epoch++;
    switcher.cancelForAccountChange();
    stopRotation();
    patch({
        doc: null,
        error: null,
        loading: true,
        progress: switcher.isBusy
            ? state.progress
            : { busy: false, presetId: null, label: "", completed: [], error: null },
    });
    if (running) void refresh();
}
export async function localAction(action: (accountId: string) => Promise<unknown>, success?: string) {
    const id = discord.accountId();
    if (!running || state.doc?.accountId !== id) throw new Error("Account data is still loading.");
    if (switcher.isBusy) throw new Error("Wait for the current activation to finish.");
    await action(id);
    if (discord.accountId() !== id)
        throw new Error("The account changed. Changes were saved only to the original account.");
    await refresh();
    if (success) toast(success);
}
export async function capture(): Promise<ProfileFields> {
    const id = discord.accountId();
    if (!running || switcher.isBusy) throw new Error("Wait for the current activation to finish.");
    if (state.doc?.accountId !== id) throw new Error("Account data is still loading.");
    const fields = await discord.snapshot(await discord.read());
    if (discord.accountId() !== id) throw new Error("Account changed during profile capture.");
    return fields;
}
export async function activate(id: string) {
    try {
        await switcher.activate(id);
        toast("Global profile activated and verified.");
    } catch (error) {
        stopRotation();
        await refresh();
        throw error;
    }
}
export async function importBackup(text: string): Promise<void> {
    const backup = parseBackup(text);
    for (const p of backup.presets) await Promise.all([verifyMedia(p.fields.avatar), verifyMedia(p.fields.banner)]);
    await localAction(
        id => repo.import(id, backup),
        `${backup.presets.length} profiles imported. Existing profiles were kept.`,
    );
}
export function saveDownload(name: string, value: Backup) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    if (blob.size > MAX_BACKUP_BYTES)
        throw new Error("Backup exceeds 100 MiB. Export individual profiles from their More actions menu.");
    const url = URL.createObjectURL(blob),
        a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function exportBackup(ids?: string[]) {
    const b = await repo.backup(discord.accountId(), ids);
    saveDownload(`ProfileManagerPRO-${new Date().toISOString().slice(0, 10)}.json`, b);
    toast("Backup download started. It contains your profile text and images.");
}
export function stopRotation() {
    clearTimeout(rotationTimer);
    rotationTimer = undefined;
    patch({ rotationRunning: false, nextRotationAt: null });
}
export async function startRotation() {
    const id = discord.accountId(),
        requestEpoch = epoch;
    const d = await repo.load(id);
    if (!running || requestEpoch !== epoch || discord.accountId() !== id)
        throw new Error("Client state changed before starting rotation.");
    if (d.rotation.presetIds.length < 2) throw new Error("Choose at least two profiles for rotation.");
    if (d.recovery) throw new Error("Resolve the recovery report before starting rotation.");
    if (switcher.isBusy) throw new Error("Wait for activation to finish.");
    stopRotation();
    const ownEpoch = epoch;
    const schedule = () => {
        if (!running || ownEpoch !== epoch) return;
        const delay = Math.max(MIN_ROTATION_MINUTES, d.rotation.minutes) * 60_000;
        patch({ rotationRunning: true, nextRotationAt: Date.now() + delay });
        rotationTimer = setTimeout(async () => {
            if (!running || ownEpoch !== epoch || discord.accountId() !== id) return stopRotation();
            try {
                const current = await repo.load(id);
                const ids = current.rotation.presetIds.filter(pid => current.presets.some(p => p.id === pid));
                if (ids.length < 2) throw new Error("Rotation needs at least two existing profiles.");
                const index = ids.indexOf(current.activePresetId ?? "");
                await activate(ids[(index + 1) % ids.length]);
                if (state.rotationRunning && ownEpoch === epoch) schedule();
            } catch (error) {
                stopRotation();
                toast(`Rotation stopped: ${messageOf(error)}`, true);
            }
        }, delay);
    };
    schedule();
}
