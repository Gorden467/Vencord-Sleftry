/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, UserStore } from "@webpack/common";
import type { ReactNode } from "react";

import { SwitchProfilesItem } from "./accountMenu";
import { startIntegration, stopIntegration } from "./integration";
import { accountChanged, startService, stopService } from "./service";
import { openManager, openQuickSwitcher } from "./ui/Manager";
import { closeManaged } from "./ui/shared";

let lastAccountId: string | undefined;
const settings = definePluginSettings({
    nativeQuickAccess: {
        type: OptionType.BOOLEAN,
        description: "Show a preset switcher in the global profile editor when its controls are recognized.",
        // off by default: it watches the whole Discord DOM, which costs performance
        default: false,
        onChange: value => (value ? startIntegration() : stopIntegration()),
    },
});
function checkAccount() {
    const id = UserStore.getCurrentUser()?.id;
    if (id !== lastAccountId) {
        lastAccountId = id;
        closeManaged();
        accountChanged();
    }
}
export default definePlugin({
    name: "ProfileManagerPro",
    description: "Create, save and switch complete global Discord profile presets with embedded local image backups.",
    authors: [{ name: "Gorden467", id: 0n }],
    enabledByDefault: true,
    settings,
    dependencies: ["ContextMenuAPI"],
    patches: [
        {
            // account popout at the bottom left, inserted right after Switch Accounts
            find: 'action:"PRESS_SWITCH_ACCOUNTS"',
            replacement: {
                match: /(\(0,(\i)\.jsx\)\((\i),\{action:"PRESS_SWITCH_ACCOUNTS".{0,80}?onClick:\(\)=>\{(\i)\(\).{0,120}?return\(0,\i\.jsx\)\((\i),\{.{0,100}?navId:"switch-accounts-submenu".{0,200}?\}\}\))(?=,)/,
                replace: "$1,(0,$2.jsx)($self.SwitchProfilesItem,{Item:$3,SubMenu:$5,closePopout:$4})",
            },
        },
    ],
    SwitchProfilesItem: ErrorBoundary.wrap(SwitchProfilesItem, { noop: true }) as (props: any) => ReactNode,
    start() {
        lastAccountId = UserStore.getCurrentUser()?.id;
        startService();
        if (settings.store.nativeQuickAccess) startIntegration();
    },
    stop() {
        stopIntegration();
        stopService();
        closeManaged();
    },
    settingsAboutComponent: () => (
        <div className="pm-root">
            <p className="pm-muted">Create, save and switch between your Discord profiles.</p>
            <div className="pm-row" style={{ marginTop: 12 }}>
                <Button type="button" onClick={openManager}>
                    Open ProfileManager PRO
                </Button>
                <Button type="button" variant="secondary" onClick={openQuickSwitcher}>
                    Quick Switcher
                </Button>
            </div>
        </div>
    ),
    toolboxActions: { "ProfileManager PRO": openManager, "Switch Profile": openQuickSwitcher },
    contextMenus: {
        "user-context": (children, props) => {
            if (props.user?.id !== UserStore.getCurrentUser()?.id) return;
            children.push(
                <Menu.MenuGroup key="pmpro">
                    <Menu.MenuItem id="pmpro-open" label="ProfileManager PRO" action={openManager} />
                    <Menu.MenuItem id="pmpro-quick" label="Switch Profile" action={openQuickSwitcher} />
                </Menu.MenuGroup>,
            );
        },
        "user-profile-overflow-menu": (children, props) => {
            if (props.user?.id !== UserStore.getCurrentUser()?.id) return;
            children.push(
                <Menu.MenuItem key="pmpro-quick" id="pmpro-quick" label="Switch Profile" action={openQuickSwitcher} />,
            );
        },
    },
    flux: {
        CONNECTION_OPEN: checkAccount,
        CURRENT_USER_UPDATE: checkAccount,
        USER_UPDATE: checkAccount,
        LOGOUT: checkAccount,
    },
});
