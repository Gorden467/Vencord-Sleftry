/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, useEffect, useRef, useState } from "@webpack/common";

import { cropMedia, loadImage, mediaFromFile, verifyMedia } from "../core/media";
import { messageOf } from "../core/switcher";
import { MAX_BIO_LENGTH, Media, Preset, ProfileFields } from "../core/types";
import { validateFields } from "../core/validation";
import { activate, capture, localAction, repo } from "../service";
import { confirmAction, hex, Icon, openManaged, Preview, safely, useModel } from "./shared";

function MediaPicker({
    label,
    media,
    onChange,
    onBusy,
    disabled,
}: {
    label: "Avatar" | "Banner";
    media: Media | null;
    onChange(m: Media | null): void;
    onBusy(busy: boolean): void;
    disabled: boolean;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [error, setError] = useState<string | null>(null),
        [busy, setBusy] = useState(false);
    const alive = useRef(true);
    useEffect(
        () => () => {
            alive.current = false;
        },
        [],
    );
    async function select(file: File) {
        setBusy(true);
        onBusy(true);
        setError(null);
        try {
            const next = await mediaFromFile(file);
            if (alive.current) onChange(next);
        } catch (e) {
            if (alive.current) setError(messageOf(e));
        } finally {
            if (alive.current) {
                setBusy(false);
                onBusy(false);
            }
        }
    }
    return (
        <div className="pm-field">
            <label>{label}</label>
            <div className="pm-media-picker">
                {media ? (
                    <img
                        className={label === "Avatar" ? "pm-upload-avatar" : "pm-upload-banner"}
                        src={media.data}
                        alt={`Saved ${label.toLowerCase()}`}
                    />
                ) : (
                    <div className="pm-media-empty">
                        <Icon name="upload" />
                    </div>
                )}
                <div className="pm-media-info">
                    <strong>
                        {media
                            ? `${media.width} × ${media.height}${media.animated ? " · Animated" : ""}`
                            : `No ${label.toLowerCase()}`}
                    </strong>
                    <small>
                        {media
                            ? `${(media.bytes / 1024).toFixed(0)} KiB · ${media.mime.split("/")[1].toUpperCase()}`
                            : "PNG, JPG, GIF or WebP · Max. 8 MiB"}
                    </small>
                    <div className="pm-row">
                        <Button
                            type="button"
                            size="small"
                            variant="secondary"
                            onClick={() => input.current?.click()}
                            disabled={disabled || busy}
                        >
                            {busy ? "Reading…" : "Choose image"}
                        </Button>
                        {media && !media.animated && (
                            <Button
                                type="button"
                                size="small"
                                variant="secondary"
                                disabled={disabled || busy}
                                onClick={() =>
                                    openManaged(p => (
                                        <CropDialog
                                            {...p}
                                            media={media}
                                            aspect={label === "Avatar" ? 1 : 2.5}
                                            onSave={onChange}
                                        />
                                    ))
                                }
                            >
                                Crop
                            </Button>
                        )}
                        {media && (
                            <Button
                                type="button"
                                size="small"
                                variant="none"
                                disabled={disabled || busy}
                                onClick={() => onChange(null)}
                            >
                                Remove
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            <input
                ref={input}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (file) void select(file);
                }}
            />
            {error && (
                <p className="pm-error" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
function CropDialog({
    media,
    aspect,
    onSave,
    ...props
}: RenderModalProps & { media: Media; aspect: number; onSave(m: Media): void }) {
    const [zoom, setZoom] = useState(1),
        [x, setX] = useState(50),
        [y, setY] = useState(50),
        [busy, setBusy] = useState(false),
        [error, setError] = useState<string | null>(null);
    const alive = useRef(true);
    useEffect(
        () => () => {
            alive.current = false;
        },
        [],
    );
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let cancelled = false;
        void loadImage(media.data)
            .then(img => {
                if (cancelled || !canvas.current) return;
                const c = canvas.current,
                    ctx = c.getContext("2d");
                c.width = 600;
                c.height = 600 / aspect;
                const sw = Math.min(img.naturalWidth, img.naturalHeight * aspect) / zoom,
                    sh = sw / aspect;
                ctx?.clearRect(0, 0, c.width, c.height);
                ctx?.drawImage(
                    img,
                    ((img.naturalWidth - sw) * x) / 100,
                    ((img.naturalHeight - sh) * y) / 100,
                    sw,
                    sh,
                    0,
                    0,
                    c.width,
                    c.height,
                );
            })
            .catch(e => {
                if (!cancelled) setError(messageOf(e));
            });
        return () => {
            cancelled = true;
        };
    }, [media, aspect, zoom, x, y]);
    return (
        <Modal
            {...props}
            title="Crop image"
            size="md"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: props.onClose, disabled: busy },
                {
                    text: "Use crop",
                    variant: "primary",
                    disabled: busy,
                    loading: busy,
                    onClick: () => {
                        setBusy(true);
                        void cropMedia(media, aspect, zoom, x, y)
                            .then(m => {
                                if (alive.current) {
                                    onSave(m);
                                    props.onClose();
                                }
                            })
                            .catch(e => {
                                if (alive.current) setError(messageOf(e));
                            })
                            .finally(() => {
                                if (alive.current) setBusy(false);
                            });
                    },
                },
            ]}
        >
            <div className="pm-root pm-crop">
                <canvas ref={canvas} aria-label="Crop preview" />
                {(
                    [
                        ["Zoom", zoom, setZoom, 1, 4, 0.05],
                        ["Horizontal position", x, setX, 0, 100, 1],
                        ["Vertical position", y, setY, 0, 100, 1],
                    ] as const
                ).map(([label, value, setter, min, max, step]) => (
                    <label className="pm-field" key={label}>
                        {label}
                        <input
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            value={value}
                            onChange={e => setter(Number(e.currentTarget.value))}
                        />
                    </label>
                ))}
                {error && (
                    <p role="alert" className="pm-error">
                        {error}
                    </p>
                )}
            </div>
        </Modal>
    );
}
export function openEditor(preset?: Preset, fields?: ProfileFields) {
    openManaged(props => <Editor {...props} preset={preset} initialFields={fields} />);
}
function Editor({
    preset,
    initialFields,
    ...props
}: RenderModalProps & { preset?: Preset; initialFields?: ProfileFields }) {
    const model = useModel(),
        owner = useRef(model.doc?.accountId),
        savedId = useRef(preset?.id);
    const [name, setName] = useState(preset?.name ?? ""),
        [fields, setFields] = useState<ProfileFields>(
            preset?.fields ??
                initialFields ?? {
                    avatar: null,
                    banner: null,
                    accentColor: null,
                    themeColors: null,
                    bio: "",
                    pronouns: "",
                },
        );
    const [busy, setBusy] = useState(false),
        [error, setError] = useState<string | null>(null),
        [dirty, setDirty] = useState(false),
        [mediaBusy, setMediaBusy] = useState(false);
    const alive = useRef(true);
    useEffect(
        () => () => {
            alive.current = false;
        },
        [],
    );
    const accountChanged = owner.current !== model.doc?.accountId;
    const disabled = busy || mediaBusy || model.progress.busy || accountChanged;
    function update(update: Partial<ProfileFields>) {
        setFields(old => ({ ...old, ...update }));
        setDirty(true);
    }
    async function save(apply: boolean) {
        setBusy(true);
        setError(null);
        try {
            const clean = validateFields(fields);
            await Promise.all([verifyMedia(clean.avatar), verifyMedia(clean.banner)]);
            let saved!: Preset;
            await localAction(async id => {
                if (id !== owner.current) throw new Error("Account changed; reopen the editor.");
                saved = await repo.save(id, name, clean, savedId.current);
            }, "Preset saved locally.");
            savedId.current = saved.id;
            setDirty(false);
            if (apply) await activate(saved.id);
            props.onClose();
        } catch (e) {
            if (alive.current) setError(messageOf(e));
        } finally {
            if (alive.current) setBusy(false);
        }
    }
    const close = () => {
        if (busy) return;
        if (dirty)
            confirmAction("Discard preset changes?", "Your unsaved local changes will be discarded.", async () =>
                props.onClose(),
            );
        else props.onClose();
    };
    return (
        <Modal
            {...props}
            onClose={close}
            title={preset ? `Edit ${preset.name}` : "Create Profile"}
            subtitle="Saving a preset only changes this device. Activate publishes it to your Discord profile."
            size="xxl"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: close, disabled: busy },
                {
                    text: "Save Preset",
                    variant: "secondary",
                    onClick: () => void save(false),
                    disabled: disabled || !name.trim(),
                    loading: busy,
                },
                {
                    text: "Save & Activate",
                    variant: "primary",
                    onClick: () => void save(true),
                    disabled: disabled || !name.trim(),
                },
            ]}
        >
            <div className="pm-root pm-editor" data-pmpro-root="editor">
                <div className="pm-editor-fields">
                    {accountChanged && (
                        <p className="pm-error" role="alert">
                            Account changed. Close this editor and reopen it on the intended account.
                        </p>
                    )}
                    <label className="pm-field">
                        Preset name
                        <input
                            autoFocus
                            maxLength={80}
                            value={name}
                            disabled={disabled}
                            onChange={e => {
                                setName(e.currentTarget.value);
                                setDirty(true);
                            }}
                            placeholder="e.g. Dark, White, Racing"
                        />
                    </label>
                    <Button
                        type="button"
                        size="small"
                        variant="secondary"
                        disabled={disabled}
                        onClick={() =>
                            safely(async () => {
                                setBusy(true);
                                try {
                                    const current = await capture();
                                    if (alive.current) {
                                        setFields(current);
                                        setDirty(true);
                                    }
                                } finally {
                                    if (alive.current) setBusy(false);
                                }
                            })
                        }
                    >
                        <Icon name="download" /> Copy current Discord profile
                    </Button>
                    <MediaPicker
                        label="Avatar"
                        onBusy={setMediaBusy}
                        media={fields.avatar}
                        onChange={avatar => update({ avatar })}
                        disabled={disabled}
                    />
                    <MediaPicker
                        label="Banner"
                        onBusy={setMediaBusy}
                        media={fields.banner}
                        onChange={banner => update({ banner })}
                        disabled={disabled}
                    />
                    <div className="pm-field">
                        <label className="pm-check">
                            <input
                                type="checkbox"
                                checked={fields.themeColors !== null}
                                disabled={disabled}
                                onChange={e =>
                                    update({ themeColors: e.currentTarget.checked ? [0x232428, 0x111214] : null })
                                }
                            />{" "}
                            Custom profile theme · Nitro
                        </label>
                        {fields.themeColors && (
                            <div className="pm-colors">
                                {[0, 1].map(i => (
                                    <label key={i}>
                                        {i === 0 ? "Primary" : "Secondary"}
                                        <input
                                            type="color"
                                            value={hex(fields.themeColors![i])}
                                            disabled={disabled}
                                            onChange={e => {
                                                const next: [number, number] = [...fields.themeColors!];
                                                next[i] = parseInt(e.currentTarget.value.slice(1), 16);
                                                update({ themeColors: next });
                                            }}
                                        />
                                        <code>{hex(fields.themeColors![i]).toUpperCase()}</code>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="pm-field">
                        <label className="pm-check">
                            <input
                                type="checkbox"
                                checked={fields.accentColor !== null}
                                disabled={disabled}
                                onChange={e => update({ accentColor: e.currentTarget.checked ? 0x5865f2 : null })}
                            />{" "}
                            Custom banner accent color
                        </label>
                        {fields.accentColor !== null && (
                            <input
                                type="color"
                                value={hex(fields.accentColor)}
                                disabled={disabled}
                                onChange={e => update({ accentColor: parseInt(e.currentTarget.value.slice(1), 16) })}
                            />
                        )}
                    </div>
                    <label className="pm-field">
                        About me <span className="pm-muted">{fields.bio.length}/{MAX_BIO_LENGTH}</span>
                        <textarea
                            maxLength={MAX_BIO_LENGTH}
                            rows={5}
                            value={fields.bio}
                            disabled={disabled}
                            onChange={e => update({ bio: e.currentTarget.value })}
                        />
                    </label>
                    <label className="pm-field">
                        Pronouns
                        <input
                            maxLength={40}
                            value={fields.pronouns}
                            disabled={disabled}
                            onChange={e => update({ pronouns: e.currentTarget.value })}
                        />
                    </label>
                    <div className="pm-field">
                        <label className="pm-check">
                            <input
                                type="checkbox"
                                checked={fields.globalName !== undefined}
                                disabled={disabled}
                                onChange={e => update({ globalName: e.currentTarget.checked ? null : undefined })}
                            />{" "}
                            Include display name
                        </label>
                        {fields.globalName !== undefined && (
                            <input
                                maxLength={32}
                                placeholder="Empty = use username"
                                value={fields.globalName ?? ""}
                                disabled={disabled}
                                onChange={e => update({ globalName: e.currentTarget.value || null })}
                            />
                        )}
                        <small>
                            Display name changes have additional Discord limits. Username, email and password are never
                            changed.
                        </small>
                    </div>
                    {error && (
                        <p className="pm-error" role="alert">
                            {error}
                        </p>
                    )}
                </div>
                <aside className="pm-editor-preview">
                    <span className="pm-eyebrow">LIVE PREVIEW</span>
                    <Preview fields={fields} name={name || "New profile"} />
                    <p className="pm-muted">
                        Preview uses your saved images and colors. Discord controls final rendering, animation playback
                        and entitlement checks.
                    </p>
                </aside>
            </div>
        </Modal>
    );
}
