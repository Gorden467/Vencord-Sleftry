/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import type { RenderModalProps } from "@vencord/discord-types";
import { ContextMenuApi, Menu, Modal, useEffect, useRef, useState } from "@webpack/common";
import type { MouseEvent } from "react";

import { messageOf } from "../core/switcher";
import { MAX_BACKUP_BYTES, Preset } from "../core/types";
import {
    activate,
    capture,
    exportBackup,
    importBackup,
    localAction,
    refresh,
    repo,
    startRotation,
    stopRotation,
    switcher,
    verifyActive,
} from "../service";
import { openEditor } from "./Editor";
import {
    Avatar,
    confirmAction,
    hex,
    Icon,
    IconButton,
    openManaged,
    Preview,
    safely,
    sorted,
    Swatches,
    useModel,
} from "./shared";

export function openManager() {
    openManaged(props => <Manager {...props} />);
    safely(verifyActive);
}
function rename(p: Preset) {
    openManaged(props => <RenameDialog {...props} preset={p} />);
}
function RenameDialog({ preset, ...props }: RenderModalProps & { preset: Preset }) {
    const [name, setName] = useState(preset.name),
        [error, setError] = useState<string | null>(null),
        [busy, setBusy] = useState(false),
        model = useModel();
    const owner = useRef(model.doc?.accountId);
    return (
        <Modal
            {...props}
            title="Rename Profile"
            size="sm"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: props.onClose, disabled: busy },
                {
                    text: "Rename",
                    variant: "primary",
                    loading: busy,
                    disabled: busy || !name.trim() || owner.current !== model.doc?.accountId,
                    onClick: () => {
                        setBusy(true);
                        void localAction(id => repo.rename(id, preset.id, name), "Profile renamed.")
                            .then(props.onClose)
                            .catch(e => setError(messageOf(e)))
                            .finally(() => setBusy(false));
                    },
                },
            ]}
        >
            <label className="pm-root pm-field">
                Preset name
                <input
                    autoFocus
                    maxLength={80}
                    value={name}
                    onChange={e => setName(e.currentTarget.value)}
                    disabled={busy}
                />
                {error && (
                    <p className="pm-error" role="alert">
                        {error}
                    </p>
                )}
            </label>
        </Modal>
    );
}
function menu(event: MouseEvent, p: Preset, presets: Preset[]) {
    const group = presets.filter(i => i.favorite === p.favorite),
        index = group.findIndex(i => i.id === p.id);
    ContextMenuApi.openContextMenu(event, () => (
        <Menu.Menu
            navId="profile-manager-pro-preset"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Profile actions"
        >
            <Menu.MenuItem
                id="pm-preview"
                label="Preview"
                action={() =>
                    openManaged(props => (
                        <Modal {...props} title={p.name} size="sm">
                            <div className="pm-root pm-preview-modal">
                                <Preview fields={p.fields} name={p.name} />
                            </div>
                        </Modal>
                    ))
                }
            />
            <Menu.MenuItem id="pm-edit" label="Edit preset" action={() => openEditor(p)} />
            <Menu.MenuItem id="pm-rename" label="Rename" action={() => rename(p)} />
            <Menu.MenuItem
                id="pm-duplicate"
                label="Duplicate"
                action={() => safely(() => localAction(id => repo.duplicate(id, p.id), "Profile duplicated."))}
            />
            <Menu.MenuItem
                id="pm-favorite"
                label={p.favorite ? "Remove favorite" : "Add favorite"}
                action={() => safely(() => localAction(id => repo.favorite(id, p.id)))}
            />
            <Menu.MenuItem
                id="pm-update"
                label="Update from current Discord profile"
                action={() =>
                    confirmAction(
                        `Update ${p.name}?`,
                        "Replace this preset's saved images, colors and text with your current published Discord profile? This only updates the local preset.",
                        async () => {
                            const fields = await capture();
                            await localAction(
                                id => repo.save(id, p.name, fields, p.id),
                                "Preset updated from your current profile.",
                            );
                        },
                    )
                }
            />
            <Menu.MenuItem
                id="pm-export-one"
                label="Export this preset"
                action={() => safely(() => exportBackup([p.id]))}
            />
            <Menu.MenuItem
                id="pm-up"
                label="Move up"
                disabled={index <= 0}
                action={() => safely(() => localAction(id => repo.move(id, p.id, group[index - 1].id)))}
            />
            <Menu.MenuItem
                id="pm-down"
                label="Move down"
                disabled={index >= group.length - 1}
                action={() => safely(() => localAction(id => repo.move(id, p.id, group[index + 1].id)))}
            />
            <Menu.MenuItem
                id="pm-delete"
                label="Delete preset"
                color="danger"
                action={() =>
                    confirmAction(
                        `Delete ${p.name}?`,
                        "This permanently deletes the local preset and its embedded images. Your public Discord profile is not changed.",
                        () => localAction(id => repo.remove(id, p.id), "Profile deleted."),
                        true,
                    )
                }
            />
        </Menu.Menu>
    ));
}
function ProfileCard({
    preset: p,
    presets,
    active,
    disabled,
    activationBlocked,
    compact,
    onDrop,
}: {
    preset: Preset;
    presets: Preset[];
    active: boolean;
    disabled: boolean;
    activationBlocked: boolean;
    compact: boolean;
    onDrop(id: string, target: string): void;
}) {
    const model = useModel();
    const applying = model.progress.busy && model.progress.presetId === p.id;
    return (
        <article
            className={`pm-card ${active ? "pm-card-active" : ""} ${compact ? "pm-card-list" : ""}`}
            draggable={!disabled}
            onDragStart={e => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("application/x-pmpro-preset", p.id);
            }}
            onDragOver={e => {
                if (e.dataTransfer.types.includes("application/x-pmpro-preset")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                }
            }}
            onDrop={e => {
                e.preventDefault();
                const id = e.dataTransfer.getData("application/x-pmpro-preset");
                if (id && id !== p.id && !disabled) onDrop(id, p.id);
            }}
        >
            <div
                className="pm-card-banner"
                style={{
                    background: p.fields.themeColors
                        ? `linear-gradient(120deg,${hex(p.fields.themeColors[0])},${hex(p.fields.themeColors[1])})`
                        : hex(p.fields.accentColor),
                }}
            >
                {p.fields.banner && <img src={p.fields.banner.data} alt="" draggable={false} />}
            </div>
            <div className="pm-card-content">
                <div className="pm-card-top">
                    <Avatar fields={p.fields} />
                    <div className="pm-card-badges">
                        {p.favorite && <Icon name="star" size={14} />}
                        {active && (
                            <span className="pm-active">
                                <Icon name="check" size={12} />
                                Active
                            </span>
                        )}
                    </div>
                </div>
                <div className="pm-card-title">
                    <h3 title={p.name}>{p.name}</h3>
                    <Swatches fields={p.fields} />
                </div>
                <p className="pm-card-bio">{p.fields.bio || "No bio set"}</p>
                <small className="pm-card-date" title={`Created ${new Date(p.createdAt).toLocaleString()}`}>
                    Updated {new Date(p.updatedAt).toLocaleDateString()}
                </small>
                <div className="pm-card-actions">
                    <Button
                        type="button"
                        disabled={disabled || activationBlocked}
                        className="pm-activate"
                        variant={active ? "secondary" : "primary"}
                        onClick={() => safely(() => activate(p.id))}
                    >
                        {applying ? (
                            <>
                                <span className="pm-spinner" /> Applying…
                            </>
                        ) : active ? (
                            "Activate again"
                        ) : (
                            "Activate"
                        )}
                    </Button>
                    <IconButton
                        name="edit"
                        label={`Edit ${p.name}`}
                        onClick={() => openEditor(p)}
                        disabled={disabled}
                    />
                    <Button
                        type="button"
                        variant="none"
                        size="iconOnly"
                        className="pm-icon"
                        aria-label={`More actions for ${p.name}`}
                        disabled={disabled}
                        onClick={e => menu(e, p, presets)}
                    >
                        <Icon name="more" />
                    </Button>
                </div>
            </div>
        </article>
    );
}
function RotationPanel() {
    const model = useModel(),
        d = model.doc;
    if (!d) return null;
    const selected = d.rotation.presetIds;
    const save = (presetIds: string[], minutes = d.rotation.minutes) =>
        safely(async () => {
            stopRotation();
            await localAction(id =>
                repo.change(id, d => {
                    d.rotation = { presetIds, minutes };
                }),
            );
        });
    return (
        <details className="pm-rotation">
            <summary>
                <Icon name="refresh" />
                Automatic rotation{" "}
                <span className={`pm-tag ${model.rotationRunning ? "pm-tag-running" : ""}`}>
                    {model.rotationRunning ? "Running" : "Off"}
                </span>
            </summary>
            <p className="pm-muted">
                Runs only in this open client. At least 60 minutes between scheduled changes. Stops on any error,
                account change or restart.
            </p>
            <div className="pm-row">
                <label className="pm-field">
                    Interval
                    <select
                        value={d.rotation.minutes}
                        disabled={model.progress.busy}
                        onChange={e => save(selected, Number(e.currentTarget.value))}
                    >
                        {[60, 120, 360, 720, 1440].map(m => (
                            <option key={m} value={m}>
                                {m >= 60 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`}
                            </option>
                        ))}
                    </select>
                </label>
                <Button
                    type="button"
                    variant={model.rotationRunning ? "dangerSecondary" : "secondary"}
                    disabled={!model.rotationRunning && (model.progress.busy || selected.length < 2 || !!d.recovery)}
                    onClick={() => (model.rotationRunning ? stopRotation() : safely(startRotation))}
                >
                    <Icon name={model.rotationRunning ? "stop" : "play"} />
                    {model.rotationRunning ? "Stop rotation" : "Start rotation"}
                </Button>
            </div>
            <div className="pm-rotation-choices">
                {sorted(d.presets).map(p => (
                    <label className="pm-check" key={p.id}>
                        <input
                            type="checkbox"
                            disabled={model.progress.busy}
                            checked={selected.includes(p.id)}
                            onChange={e =>
                                save(
                                    e.currentTarget.checked
                                        ? [...selected, p.id]
                                        : selected.filter(id => id !== p.id),
                                )
                            }
                        />
                        <Avatar fields={p.fields} small />
                        {p.name}
                    </label>
                ))}
            </div>
            <ol className="pm-rotation-order">
                {selected.map((id, i) => (
                    <li key={id}>
                        <span>{d.presets.find(p => p.id === id)?.name}</span>
                        <IconButton
                            name="up"
                            label="Earlier in rotation"
                            disabled={i === 0 || model.progress.busy}
                            onClick={() => {
                                const ids = [...selected];
                                [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                                save(ids);
                            }}
                        />
                        <IconButton
                            name="down"
                            label="Later in rotation"
                            disabled={i === selected.length - 1 || model.progress.busy}
                            onClick={() => {
                                const ids = [...selected];
                                [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
                                save(ids);
                            }}
                        />
                    </li>
                ))}
            </ol>
            {model.nextRotationAt && (
                <p className="pm-muted">Next change at {new Date(model.nextRotationAt).toLocaleTimeString()}</p>
            )}
        </details>
    );
}
function RecoveryPanel() {
    const { doc, progress } = useModel(),
        r = doc?.recovery;
    if (!r) return null;
    return (
        <section className="pm-recovery" role="alert">
            <strong>Recovery available · {r.targetName}</strong>
            <p>{r.message ?? "An activation was interrupted. Review the profile before continuing."}</p>
            <p>
                Confirmed:{" "}
                {r.completed.length
                    ? r.completed
                          .map(s => (s === "account" ? "avatar / display name" : "banner / colors / bio / pronouns"))
                          .join(", ")
                    : "no acknowledged changes"}
                .
                {r.inFlight && ` ${r.inFlight === "account" ? "Account" : "Profile"} request outcome may be uncertain.`}
            </p>
            <div className="pm-row">
                <Button
                    type="button"
                    variant="secondary"
                    disabled={progress.busy}
                    onClick={() =>
                        confirmAction(
                            "Restore the previous profile?",
                            "Restore the saved avatar, banner, colors and text from before the interrupted activation? Discord cooldowns still apply. Any later manual profile edits will be replaced.",
                            async () => {
                                await switcher.restore();
                                await refresh();
                            },
                        )
                    }
                >
                    Restore previous profile
                </Button>
                <Button
                    type="button"
                    variant="none"
                    disabled={progress.busy}
                    onClick={() =>
                        confirmAction(
                            "Keep current Discord profile?",
                            "Keep all current public changes and discard the recovery snapshot? This enables future activations.",
                            () =>
                                localAction(
                                    id =>
                                        repo.change(id, d => {
                                            d.recovery = null;
                                        }),
                                    "Recovery dismissed.",
                                ),
                        )
                    }
                >
                    Keep current changes
                </Button>
            </div>
        </section>
    );
}
function Manager(props: RenderModalProps) {
    const model = useModel(),
        [view, setView] = useState<"grid" | "list">("grid"),
        [search, setSearch] = useState(""),
        [busy, setBusy] = useState(false),
        [clock, setClock] = useState(Date.now());
    const importInput = useRef<HTMLInputElement>(null),
        alive = useRef(true);
    useEffect(() => {
        const t = setInterval(() => setClock(Date.now()), 1000);
        return () => {
            alive.current = false;
            clearInterval(t);
        };
    }, []);
    const disabled = busy || model.progress.busy || !model.doc;
    const profiles = sorted(model.doc?.presets ?? []),
        visible = profiles.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    const cooldown = Math.max(0, Math.ceil(((model.doc?.nextAllowedAt ?? 0) - clock) / 1000));
    async function saveCurrent() {
        setBusy(true);
        try {
            const f = await capture();
            if (alive.current) openEditor(undefined, f);
        } finally {
            if (alive.current) setBusy(false);
        }
    }
    return (
        <Modal
            {...props}
            title={
                <span className="pm-modal-title">
                    ProfileManager <span className="pm-pro">PRO</span>
                </span>
            }
            subtitle="Create, save and switch between your Discord profiles."
            size="xxl"
        >
            <div className="pm-root pm-manager" data-pmpro-root="manager">
                <div className="pm-toolbar">
                    <div>
                        <span className="pm-eyebrow">YOUR GLOBAL PROFILES</span>
                        <p className="pm-muted">{profiles.length} saved · Stored on this device</p>
                    </div>
                    <div className="pm-row">
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={disabled}
                            onClick={() => safely(saveCurrent)}
                        >
                            <Icon name="download" />
                            {busy ? "Reading profile…" : "Save Current Profile"}
                        </Button>
                        <Button type="button" disabled={disabled} onClick={() => openEditor()}>
                            <Icon name="plus" />
                            Create Profile
                        </Button>
                    </div>
                </div>
                {model.error && (
                    <div className="pm-error" role="alert">
                        {model.error}
                        <Button type="button" variant="secondary" size="small" onClick={() => safely(refresh)}>
                            Try loading again
                        </Button>
                    </div>
                )}
                <RecoveryPanel />
                {model.progress.busy && (
                    <div className="pm-progress" role="status">
                        <span className="pm-spinner" />
                        {model.progress.label}
                        <progress aria-label="Profile activation progress" />
                    </div>
                )}
                {model.progress.error && (
                    <p className="pm-error" role="alert">
                        {model.progress.error}
                    </p>
                )}
                <div className="pm-filterbar">
                    <label className="pm-search">
                        <Icon name="search" />
                        <input
                            type="search"
                            placeholder="Search profiles"
                            value={search}
                            onChange={e => setSearch(e.currentTarget.value)}
                            aria-label="Search saved profiles"
                        />
                    </label>
                    <div className="pm-row">
                        <IconButton
                            name="grid"
                            label="Card view"
                            active={view === "grid"}
                            onClick={() => setView("grid")}
                        />
                        <IconButton
                            name="list"
                            label="List view"
                            active={view === "list"}
                            onClick={() => setView("list")}
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            size="small"
                            disabled={disabled}
                            onClick={() => importInput.current?.click()}
                        >
                            <Icon name="upload" size={16} />
                            Import
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="small"
                            disabled={disabled || !profiles.length}
                            onClick={() => safely(() => exportBackup())}
                        >
                            <Icon name="download" size={16} />
                            Export all
                        </Button>
                    </div>
                </div>
                <input
                    ref={importInput}
                    type="file"
                    hidden
                    accept="application/json,.json"
                    onChange={e => {
                        const f = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (!f) return;
                        safely(async () => {
                            if (f.size > MAX_BACKUP_BYTES) throw new Error("Backup exceeds 100 MiB.");
                            setBusy(true);
                            try {
                                await importBackup(await f.text());
                            } finally {
                                if (alive.current) setBusy(false);
                            }
                        });
                    }}
                />
                {model.loading && (
                    <p className="pm-empty" role="status">
                        Loading saved profiles…
                    </p>
                )}
                {!model.loading && model.doc && !profiles.length && (
                    <div className="pm-empty">
                        <div className="pm-empty-icon">
                            <Icon name="user" size={32} />
                        </div>
                        <h2>Your profiles, ready when you are.</h2>
                        <p>Save your current look or create a new profile. Images are kept with every preset.</p>
                        <Button type="button" onClick={() => safely(saveCurrent)} disabled={disabled}>
                            Save your first profile
                        </Button>
                    </div>
                )}
                {!!profiles.length && (
                    <div className={`pm-grid ${view === "list" ? "pm-list" : ""}`}>
                        {visible.map(p => (
                            <ProfileCard
                                key={p.id}
                                preset={p}
                                presets={profiles}
                                active={model.doc?.activePresetId === p.id}
                                disabled={disabled}
                                activationBlocked={!!model.doc?.recovery || cooldown > 0}
                                compact={view === "list"}
                                onDrop={(id, target) =>
                                    safely(() => localAction(accountId => repo.move(accountId, id, target)))
                                }
                            />
                        ))}
                    </div>
                )}
                {!!profiles.length && !visible.length && <p className="pm-empty">No profiles match your search.</p>}
                {cooldown > 0 && (
                    <p className="pm-muted" role="status">
                        Profile changes available in {cooldown}s. Discord may impose additional limits.
                    </p>
                )}
                <RotationPanel />
                <footer className="pm-footer">
                    <span>Global profile · One Discord account</span>
                    <span>Drag profiles to reorder within each group. Favorites stay first.</span>
                </footer>
            </div>
        </Modal>
    );
}
export function openQuickSwitcher() {
    openManaged(props => <QuickSwitcher {...props} />);
    safely(verifyActive);
}
export function QuickButton() {
    const model = useModel();
    return (
        <div className="pm-root pm-native-panel" data-pmpro-root="quick">
            <div>
                <strong>Profile presets</strong>
                <span className="pm-muted">Switch your saved global profile.</span>
            </div>
            <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={openQuickSwitcher}
                disabled={!model.doc || model.progress.busy}
            >
                <Icon name="refresh" size={16} />
                Switch profile
            </Button>
        </div>
    );
}
function QuickSwitcher(props: RenderModalProps) {
    const model = useModel(),
        [search, setSearch] = useState("");
    return (
        <Modal {...props} title="Switch Profile" subtitle="Changes your public global Discord profile." size="sm">
            <div className="pm-root pm-quick" data-pmpro-root="quick-modal">
                <label className="pm-search">
                    <Icon name="search" />
                    <input
                        type="search"
                        autoFocus
                        value={search}
                        placeholder="Find a profile"
                        aria-label="Find a profile"
                        onChange={e => setSearch(e.currentTarget.value)}
                    />
                </label>
                {sorted(model.doc?.presets ?? [])
                    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
                    .map(p => (
                        <button
                            type="button"
                            className="pm-quick-item"
                            key={p.id}
                            disabled={model.progress.busy || !!model.doc?.recovery}
                            onClick={() =>
                                safely(async () => {
                                    await activate(p.id);
                                    props.onClose();
                                })
                            }
                        >
                            <Avatar fields={p.fields} small />
                            <span>
                                {p.name}
                                {model.doc?.activePresetId === p.id && <small>Active</small>}
                            </span>
                            <Swatches fields={p.fields} />
                        </button>
                    ))}
                {!model.doc?.presets.length && <p className="pm-muted">No saved profiles yet.</p>}
                {model.progress.busy && <p role="status">{model.progress.label}</p>}
                {model.progress.error && (
                    <p className="pm-error" role="alert">
                        {model.progress.error}
                    </p>
                )}
                <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                        props.onClose();
                        openManager();
                    }}
                >
                    Open ProfileManager PRO
                </Button>
            </div>
        </Modal>
    );
}
