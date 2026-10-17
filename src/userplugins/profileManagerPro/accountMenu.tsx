/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Menu } from "@webpack/common";
import type { ComponentType } from "react";

import { activate } from "./service";
import { openManager } from "./ui/Manager";
import { Avatar, safely, sorted, useModel } from "./ui/shared";

function ProfilesIcon({ className }: { className?: string }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-6 15c0-3.3 2.7-5 6-5s6 1.7 6 5v1H3v-1Z" />
            <path d="M16.5 3.5a3.5 3.5 0 0 1 0 7 1 1 0 0 1 0-2 1.5 1.5 0 0 0 0-3 1 1 0 0 1 0-2ZM17 14c2.6.4 4 1.9 4 4.5V20h-3.5v-1c0-1.9-.7-3.4-1.9-4.4.4-.4.9-.6 1.4-.6Z" />
        </svg>
    );
}

function PresetsSubmenu({ SubMenu, onClose }: { SubMenu: ComponentType<any>; onClose(): void }) {
    const model = useModel();
    const presets = sorted(model.doc?.presets ?? []);
    const blocked = model.progress.busy || !!model.doc?.recovery;

    return (
        <SubMenu navId="pmpro-switch-profiles-submenu" aria-label="Switch Profiles" onClose={onClose}>
            {!!presets.length && (
                <Menu.MenuGroup>
                    {presets.map(p => (
                        <Menu.MenuItem
                            key={p.id}
                            id={`pmpro-switch-${p.id}`}
                            disabled={blocked}
                            label={
                                <div
                                    className="pm-menu-preset"
                                    style={p.fields.banner ? { backgroundImage: `url(${p.fields.banner.data})` } : undefined}
                                >
                                    <Avatar fields={p.fields} small />
                                    <span className="pm-menu-preset-name">{p.name}</span>
                                    {model.doc?.activePresetId === p.id && <span className="pm-menu-active">Active</span>}
                                </div>
                            }
                            action={() => {
                                onClose();
                                safely(() => activate(p.id));
                            }}
                        />
                    ))}
                </Menu.MenuGroup>
            )}
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="pmpro-open-manager"
                    label="Open ProfileManager PRO"
                    action={() => {
                        onClose();
                        openManager();
                    }}
                />
            </Menu.MenuGroup>
        </SubMenu>
    );
}

// Item and SubMenu come from Discord's account popout, so the entry looks like Switch Accounts
export function SwitchProfilesItem({
    Item,
    SubMenu,
    closePopout,
}: {
    Item: ComponentType<any>;
    SubMenu: ComponentType<any>;
    closePopout(): void;
}) {
    return (
        <Item
            action="PRESS_SWITCH_PROFILES"
            icon={ProfilesIcon}
            label="Switch Profiles"
            onClick={() => {
                closePopout();
                openManager();
            }}
            renderSubmenu={({ closePopout: close }: { closePopout(): void }) => (
                <PresetsSubmenu SubMenu={SubMenu} onClose={close ?? closePopout} />
            )}
        />
    );
}
