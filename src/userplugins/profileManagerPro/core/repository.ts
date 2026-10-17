/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AccountDocument, Backup, Preset, ProfileFields, StoragePort } from "./types";
import { migrateDocument, validateFields, validatePreset } from "./validation";

export class Repository {
    constructor(private readonly storage: StoragePort) {}
    key(accountId: string) {
        return `ProfileManagerPro:account:${accountId}`;
    }
    async load(accountId: string): Promise<AccountDocument> {
        return migrateDocument(await this.storage.get(this.key(accountId)), accountId);
    }
    async change(accountId: string, change: (doc: AccountDocument) => void) {
        await this.storage.update<AccountDocument>(this.key(accountId), raw => {
            const doc = migrateDocument(raw, accountId);
            change(doc);
            return migrateDocument(doc, accountId);
        });
    }
    async save(accountId: string, name: string, fields: ProfileFields, existingId?: string): Promise<Preset> {
        const now = Date.now();
        let saved!: Preset;
        await this.change(accountId, d => {
            const existing = existingId ? d.presets.find(p => p.id === existingId) : undefined;
            if (existingId && !existing) throw new Error("Preset was removed. Reopen the editor.");
            saved = validatePreset({
                id: existing?.id ?? crypto.randomUUID(),
                name,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
                favorite: existing?.favorite ?? false,
                fields: validateFields(fields),
            });
            if (existing) d.presets[d.presets.indexOf(existing)] = saved;
            else d.presets.push(saved);
            if (d.activePresetId === existingId) {
                d.activePresetId = null;
                d.activeRemote = null;
            }
        });
        return saved;
    }
    async rename(accountId: string, id: string, name: string) {
        await this.change(accountId, d => {
            const p = this.require(d, id);
            p.name = validatePreset({ ...p, name }).name;
            p.updatedAt = Date.now();
        });
    }
    async duplicate(accountId: string, id: string) {
        const d = await this.load(accountId);
        const p = this.require(d, id);
        return this.save(accountId, `${p.name.slice(0, 73)} (copy)`, p.fields);
    }
    async remove(accountId: string, id: string) {
        await this.change(accountId, d => {
            this.require(d, id);
            d.presets = d.presets.filter(p => p.id !== id);
            d.rotation.presetIds = d.rotation.presetIds.filter(i => i !== id);
            if (d.activePresetId === id) {
                d.activePresetId = null;
                d.activeRemote = null;
            }
        });
    }
    async favorite(accountId: string, id: string) {
        await this.change(accountId, d => {
            const p = this.require(d, id);
            p.favorite = !p.favorite;
        });
    }
    async move(accountId: string, id: string, targetId: string) {
        await this.change(accountId, d => {
            const p = this.require(d, id),
                target = this.require(d, targetId);
            if (p.favorite !== target.favorite) throw new Error("Sort within favorites or within other profiles.");
            d.presets.splice(d.presets.indexOf(p), 1);
            d.presets.splice(d.presets.indexOf(target), 0, p);
        });
    }
    async import(accountId: string, backup: Backup): Promise<number> {
        if (backup.accountId !== accountId)
            throw new Error("This backup belongs to a different Discord account. Switch accounts before importing.");
        await this.change(accountId, d => {
            for (const item of backup.presets)
                d.presets.push({
                    ...validatePreset(item),
                    id: crypto.randomUUID(),
                    name: item.name,
                    updatedAt: Date.now(),
                });
        });
        return backup.presets.length;
    }
    async backup(accountId: string, ids?: string[]): Promise<Backup> {
        const d = await this.load(accountId);
        return {
            format: "profile-manager-pro",
            schemaVersion: 1,
            accountId,
            exportedAt: Date.now(),
            presets: ids ? d.presets.filter(p => ids.includes(p.id)) : d.presets,
        };
    }
    private require(d: AccountDocument, id: string): Preset {
        const p = d.presets.find(p => p.id === id);
        if (!p) throw new Error("Preset no longer exists.");
        return p;
    }
}
