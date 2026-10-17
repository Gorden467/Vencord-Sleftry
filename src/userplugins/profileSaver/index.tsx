/*
 * ProfileSaver - saves your Discord profile and loads it onto any account
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import definePlugin, { OptionType } from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import { Alerts, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";

import { applyProfile, captureProfile, SavedProfile } from "./profile";

const STORE_KEY = "ProfileSaver_profiles";

async function loadAll() {
    return (await DataStore.get<SavedProfile[]>(STORE_KEY)) ?? [];
}

async function saveAll(list: SavedProfile[]) {
    await DataStore.set(STORE_KEY, list);
}

function ProfileRow({ p, busy, onLoad, onDelete }: {
    p: SavedProfile;
    busy: boolean;
    onLoad(): void;
    onDelete(): void;
}) {
    const exportFile = () => {
        const fileName = p.name.replace(/[^\w-]+/g, "_") + ".profile.json";
        saveFile(new File([JSON.stringify(p)], fileName, { type: "application/json" }));
    };

    return (
        <Flex alignItems="center" gap="10px" style={{ padding: "8px 0", borderBottom: "1px solid var(--background-modifier-accent)" }}>
            {p.avatar
                ? <img src={p.avatar} width={40} height={40} style={{ borderRadius: "50%" }} />
                : <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--background-tertiary)" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
                <Paragraph style={{ fontWeight: 600 }}>{p.name}</Paragraph>
                <Paragraph size="sm" style={{ opacity: 0.7 }}>
                    {p.globalName ?? p.sourceUser} · von @{p.sourceUser} · {new Date(p.savedAt).toLocaleString()}
                </Paragraph>
            </div>
            <Button size="small" disabled={busy} onClick={onLoad}>Laden</Button>
            <Button size="small" variant="secondary" onClick={exportFile}>Exportieren</Button>
            <Button size="small" variant="dangerSecondary" disabled={busy} onClick={onDelete}>Löschen</Button>
        </Flex>
    );
}

function ProfilePanel() {
    const [profiles, setProfiles] = useState<SavedProfile[]>([]);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => { loadAll().then(setProfiles); }, []);

    const update = async (list: SavedProfile[]) => {
        await saveAll(list);
        setProfiles(list);
    };

    const saveCurrent = async () => {
        setBusy(true);
        try {
            const p = await captureProfile(name.trim() || `Profil ${profiles.length + 1}`);
            await update([...profiles, p]);
            setName("");
            showToast(`"${p.name}" gespeichert`, Toasts.Type.SUCCESS);
        } catch (e) {
            console.error("[ProfileSaver]", e);
            showToast("Speichern fehlgeschlagen, Details in der Konsole", Toasts.Type.FAILURE);
        }
        setBusy(false);
    };

    const load = (p: SavedProfile) => Alerts.show({
        title: `"${p.name}" laden?`,
        body: "Dein aktuelles Profil wird überschrieben. Speicher es vorher, falls du es behalten willst.",
        confirmText: "Laden",
        cancelText: "Abbrechen",
        onConfirm: async () => {
            setBusy(true);
            const { done, failed } = await applyProfile(p);
            setBusy(false);

            if (!failed.length) {
                showToast(`"${p.name}" geladen`, Toasts.Type.SUCCESS);
                return;
            }
            Alerts.show({
                title: "Teilweise geladen",
                body: (
                    <div>
                        <Paragraph>Übernommen: {done.join(", ") || "nichts"}</Paragraph>
                        <Paragraph style={{ marginTop: 8 }}>Nicht übernommen:</Paragraph>
                        {failed.map(f => <Paragraph key={f}>• {f}</Paragraph>)}
                    </div>
                )
            });
        }
    });

    const remove = (p: SavedProfile) => Alerts.show({
        title: `"${p.name}" löschen?`,
        body: "Das gespeicherte Profil ist danach weg.",
        confirmText: "Löschen",
        cancelText: "Abbrechen",
        onConfirm: () => update(profiles.filter(x => x.id !== p.id))
    });

    const importFile = async () => {
        const file = await chooseFile("application/json,.json");
        if (!file) return;
        try {
            const p: SavedProfile = JSON.parse(await file.text());
            if (!p.name || !("avatar" in p)) throw new Error("not a profile file");
            p.id = Date.now().toString(36);
            await update([...profiles, p]);
            showToast(`"${p.name}" importiert`, Toasts.Type.SUCCESS);
        } catch {
            showToast("Datei ist kein gespeichertes Profil", Toasts.Type.FAILURE);
        }
    };

    return (
        <div>
            <Flex gap="8px" alignItems="center">
                <div style={{ flex: 1 }}>
                    <TextInput placeholder="Name für das Profil" value={name} onChange={setName} />
                </div>
                <Button disabled={busy} onClick={saveCurrent}>{busy ? "Moment..." : "Aktuelles Profil speichern"}</Button>
                <Button variant="secondary" onClick={importFile}>Datei importieren</Button>
            </Flex>

            <div style={{ marginTop: 12 }}>
                {profiles.length
                    ? profiles.map(p => (
                        <ProfileRow key={p.id} p={p} busy={busy} onLoad={() => load(p)} onDelete={() => remove(p)} />
                    ))
                    : <Paragraph style={{ opacity: 0.7 }}>Noch keine Profile gespeichert.</Paragraph>}
            </div>

            <Paragraph size="sm" style={{ marginTop: 12, opacity: 0.7 }}>
                Gespeicherte Profile gelten für alle Accounts in diesem Discord. Für einen anderen PC: exportieren und dort importieren.
                Banner und animiertes Profilbild brauchen Nitro, Deko und Profileffekt muss der Ziel-Account selbst besitzen.
            </Paragraph>
        </div>
    );
}

const settings = definePluginSettings({
    profiles: {
        type: OptionType.COMPONENT,
        component: ProfilePanel
    }
});

export default definePlugin({
    name: "ProfileSaver",
    description: "Profil speichern (Name, Pronomen, Info, Status, Bild, Banner, Deko) und auf einem anderen Account wieder laden",
    authors: [{ name: "Gorden467", id: 0n }],
    settings
});
