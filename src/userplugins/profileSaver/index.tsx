/*
 * ProfileSaver - saves your Discord profile and loads it onto any account
 */

import "./styles.css";

import { plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal } from "@components/settings";
import definePlugin, { OptionType } from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import { Menu, showToast, Toasts, useState } from "@webpack/common";
import type { ComponentType, ReactNode } from "react";

import { deleteProfile, saveCurrentProfile, switchToProfile } from "./actions";
import type { SavedProfile } from "./profile";
import { getProfiles, loadStore, setProfiles, useProfiles } from "./store";

function ProfilesIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-6 15c0-3.3 2.7-5 6-5s6 1.7 6 5v1H3v-1Z" />
            <path d="M16.5 3.5a3.5 3.5 0 0 1 0 7 1 1 0 0 1 0-2 1.5 1.5 0 0 0 0-3 1 1 0 0 1 0-2ZM17 14c2.6.4 4 1.9 4 4.5V20h-3.5v-1c0-1.9-.7-3.4-1.9-4.4.4-.4.9-.6 1.4-.6Z" />
        </svg>
    );
}

function ProfilePreview({ p, active }: { p: SavedProfile; active: boolean; }) {
    const sub = p.customStatus?.text || p.pronouns || `@${p.sourceUser}`;

    return (
        <div className="vc-ps-preview" style={p.banner ? { backgroundImage: `url(${p.banner})` } : undefined}>
            <div className="vc-ps-preview-shade" />
            {p.avatar
                ? <img className="vc-ps-avatar" src={p.avatar} />
                : <div className="vc-ps-avatar" />}
            <div className="vc-ps-text">
                <div className="vc-ps-name">{p.name}{active && <span className="vc-ps-active">aktiv</span>}</div>
                <div className="vc-ps-sub">{sub}</div>
            </div>
        </div>
    );
}

function ProfilesSubmenu({ SubMenu, onClose }: { SubMenu: ComponentType<any>; onClose(): void; }) {
    const { profiles, activeId } = useProfiles();

    return (
        <SubMenu navId="vc-switch-profiles-submenu" aria-label="Switch Profiles" onClose={onClose}>
            <Menu.MenuGroup>
                {profiles.map(p => (
                    <Menu.MenuItem
                        key={p.id}
                        id={`vc-ps-${p.id}`}
                        label={<ProfilePreview p={p} active={p.id === activeId} />}
                        action={() => { onClose(); switchToProfile(p); }}
                    />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="vc-ps-save"
                    label="Aktuelles Profil speichern"
                    action={() => { onClose(); saveCurrentProfile(); }}
                />
                <Menu.MenuItem
                    id="vc-ps-manage"
                    label="Profile verwalten"
                    action={() => { onClose(); openPluginModal(plugins.ProfileSaver); }}
                />
            </Menu.MenuGroup>
        </SubMenu>
    );
}

// Item and SubMenu are Discord's own components from the account popout, so it looks like the rest
function SwitchProfilesItem({ Item, SubMenu, closePopout }: { Item: ComponentType<any>; SubMenu: ComponentType<any>; closePopout(): void; }) {
    return (
        <Item
            action="PRESS_SWITCH_PROFILES"
            icon={ProfilesIcon}
            label="Switch Profiles"
            onClick={() => { closePopout(); openPluginModal(plugins.ProfileSaver); }}
            renderSubmenu={({ closePopout: close }: { closePopout(): void; }) => (
                <ProfilesSubmenu SubMenu={SubMenu} onClose={close ?? closePopout} />
            )}
        />
    );
}

function ProfileRow({ p }: { p: SavedProfile; }) {
    const exportFile = () => {
        const fileName = p.name.replace(/[^\w-]+/g, "_") + ".profile.json";
        saveFile(new File([JSON.stringify(p)], fileName, { type: "application/json" }));
    };

    return (
        <Flex alignItems="center" gap="10px" className="vc-ps-row">
            <div style={{ flex: 1, minWidth: 0 }}>
                <ProfilePreview p={p} active={false} />
            </div>
            <Button size="small" onClick={() => switchToProfile(p)}>Laden</Button>
            <Button size="small" variant="secondary" onClick={exportFile}>Exportieren</Button>
            <Button size="small" variant="dangerSecondary" onClick={() => deleteProfile(p)}>Löschen</Button>
        </Flex>
    );
}

function ProfilePanel() {
    const { profiles } = useProfiles();
    const [name, setName] = useState("");

    const importFile = async () => {
        const file = await chooseFile("application/json,.json");
        if (!file) return;
        try {
            const p: SavedProfile = JSON.parse(await file.text());
            if (!p.name || !("avatar" in p)) throw new Error("not a profile file");
            p.id = Date.now().toString(36);
            await setProfiles([...getProfiles(), p]);
            showToast(`"${p.name}" importiert`, Toasts.Type.SUCCESS);
        } catch {
            showToast("Datei ist kein gespeichertes Profil", Toasts.Type.FAILURE);
        }
    };

    return (
        <div>
            <Flex gap="8px" alignItems="center">
                <input
                    className="vc-ps-input"
                    placeholder="Name für das Profil"
                    value={name}
                    onChange={e => setName(e.currentTarget.value)}
                />
                <Button onClick={() => saveCurrentProfile(name).then(() => setName(""))}>Aktuelles Profil speichern</Button>
                <Button variant="secondary" onClick={importFile}>Datei importieren</Button>
            </Flex>

            <div style={{ marginTop: 12 }}>
                {profiles.length
                    ? profiles.map(p => <ProfileRow key={p.id} p={p} />)
                    : <Paragraph style={{ opacity: 0.7 }}>Noch keine Profile gespeichert.</Paragraph>}
            </div>

            <Paragraph size="sm" style={{ marginTop: 12, opacity: 0.7 }}>
                Umschalten geht auch direkt über dein Profil unten links → Switch Profiles.
                Gespeicherte Profile gelten für alle Accounts in diesem Discord, für einen anderen PC exportieren und dort importieren.
                Banner und animiertes Profilbild brauchen Nitro, Deko und Profileffekt muss der Ziel-Account selbst besitzen.
            </Paragraph>
        </div>
    );
}

const settings = definePluginSettings({
    profiles: {
        type: OptionType.COMPONENT,
        component: () => (
            <ErrorBoundary>
                <ProfilePanel />
            </ErrorBoundary>
        )
    }
});

export default definePlugin({
    name: "ProfileSaver",
    description: "Profile speichern (Name, Pronomen, Info, Status, Bild, Banner, Deko) und über Switch Profiles hin und her wechseln",
    authors: [{ name: "Gorden467", id: 0n }],
    settings,

    patches: [
        {
            find: 'action:"PRESS_SWITCH_ACCOUNTS"',
            replacement: {
                match: /(\(0,(\i)\.jsx\)\((\i),\{action:"PRESS_SWITCH_ACCOUNTS".{0,80}?onClick:\(\)=>\{(\i)\(\).{0,120}?return\(0,\i\.jsx\)\((\i),\{navId:"switch-accounts-submenu".{0,200}?\}\}\))(?=,)/,
                replace: "$1,(0,$2.jsx)($self.SwitchProfilesItem,{Item:$3,SubMenu:$5,closePopout:$4})"
            }
        }
    ],

    SwitchProfilesItem: ErrorBoundary.wrap(SwitchProfilesItem, { noop: true }) as (props: any) => ReactNode,

    start() {
        loadStore();
    }
});
