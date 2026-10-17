/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import type { RenderModal } from "@vencord/discord-types";
import { closeModal, ConfirmModal, openModal, React, UserStore } from "@webpack/common";
import type { CSSProperties } from "react";

import { messageOf } from "../core/switcher";
import { Preset, ProfileFields } from "../core/types";
import { getState, subscribe, toast } from "../service";

const modalKeys = new Set<string>();
export function openManaged(render: RenderModal) {
    const key = openModal(props => <ErrorBoundary>{render(props)}</ErrorBoundary>, {
        onCloseCallback: () => modalKeys.delete(key),
    });
    modalKeys.add(key);
    return key;
}
export function closeManaged() {
    for (const key of modalKeys) closeModal(key);
    modalKeys.clear();
}
export function confirmAction(title: string, text: string, action: () => Promise<unknown>, destructive = false) {
    openManaged(props => (
        <ConfirmModal
            {...props}
            title={title}
            confirmText={destructive ? "Delete" : "Confirm"}
            variant={destructive ? "critical-primary" : "primary"}
            onConfirm={async setError => {
                try {
                    await action();
                } catch (error) {
                    setError(messageOf(error));
                    throw error;
                }
            }}
        >
            {text}
        </ConfirmModal>
    ));
}
export function safely(action: () => Promise<unknown>) {
    void action().catch(error => toast(messageOf(error), true));
}
export function useModel() {
    const state = React.useSyncExternalStore(subscribe, getState);
    const currentId = UserStore.getCurrentUser()?.id;
    return { ...state, doc: state.doc?.accountId === currentId ? state.doc : null };
}
const paths = {
    plus: "M12 5v14M5 12h14",
    close: "m6 6 12 12M18 6 6 18",
    edit: "m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z",
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
    download: "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",
    check: "m5 12 4 4L19 6",
    play: "m8 4 12 8-12 8V4Z",
    stop: "M5 5h14v14H5z",
    up: "m6 15 6-6 6 6",
    down: "m6 9 6 6 6-6",
    search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    user: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    refresh: "M20 7V3l-3 3a8 8 0 1 0 3 10M20 3h-5",
};
export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={paths[name]} />
        </svg>
    );
}
export function IconButton({
    name,
    label,
    onClick,
    disabled,
    active,
}: {
    name: keyof typeof paths;
    label: string;
    onClick(): void;
    disabled?: boolean;
    active?: boolean;
}) {
    return (
        <Button
            type="button"
            variant="none"
            size="iconOnly"
            className={`pm-icon ${active ? "pm-selected" : ""}`}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            disabled={disabled}
        >
            <Icon name={name} />
        </Button>
    );
}
export function Avatar({ fields, small = false }: { fields: ProfileFields; small?: boolean }) {
    return (
        <div className={`pm-avatar ${small ? "pm-avatar-small" : ""}`}>
            {fields.avatar ? (
                <img src={fields.avatar.data} alt="" draggable={false} />
            ) : (
                <Icon name="user" size={small ? 20 : 38} />
            )}
        </div>
    );
}
export const hex = (v: number | null | undefined) => `#${(v ?? 0x5865f2).toString(16).padStart(6, "0")}`;
export function Swatches({ fields }: { fields: ProfileFields }) {
    return (
        <span className="pm-swatches" title="Primary, secondary and accent colors">
            {(fields.themeColors ?? [fields.accentColor ?? 0x5865f2, 0x232428]).map((c, i) => (
                <span key={i} style={{ background: hex(c) }} />
            ))}
            <span style={{ background: hex(fields.accentColor) }} />
        </span>
    );
}
export function Preview({
    fields,
    name,
    compact = false,
}: {
    fields: ProfileFields;
    name?: string;
    compact?: boolean;
}) {
    const user = UserStore.getCurrentUser();
    const [primary, secondary] = fields.themeColors ?? [0x232428, 0x111214];
    const luminance = (primary >> 16) * 0.2126 + ((primary >> 8) & 255) * 0.7152 + (primary & 255) * 0.0722;
    const style = { "--pm-primary": hex(primary), "--pm-secondary": hex(secondary) } as CSSProperties;
    return (
        <article
            className={`pm-preview ${compact ? "pm-preview-compact" : ""} ${luminance > 160 ? "pm-preview-light" : ""}`}
            style={style}
            aria-label="Global profile preview"
        >
            <div className="pm-preview-inner">
                <div className="pm-banner" style={{ backgroundColor: hex(fields.accentColor ?? primary) }}>
                    {fields.banner && <img src={fields.banner.data} alt="Profile banner" draggable={false} />}
                </div>
                <div className="pm-preview-body">
                    <Avatar fields={fields} />
                    <div className="pm-preview-details">
                        <strong className="pm-display-name">
                            {fields.globalName === undefined
                                ? (user?.globalName ?? user?.username)
                                : (fields.globalName ?? user?.username)}
                        </strong>
                        <span className="pm-username">
                            {user?.username}
                            {fields.pronouns && ` · ${fields.pronouns}`}
                        </span>
                        <hr />
                        <h3>ABOUT ME</h3>
                        <p className="pm-bio">{fields.bio || "No bio set."}</p>
                        {!compact && (
                            <div className="pm-preview-label">{name ?? "Unsaved profile"} · Global profile preview</div>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}
export function sorted(presets: Preset[]) {
    return [...presets].sort((a, b) => Number(b.favorite) - Number(a.favorite));
}
