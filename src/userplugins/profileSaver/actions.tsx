import { Paragraph } from "@components/Paragraph";
import { Alerts, showToast, Toasts, UserStore } from "@webpack/common";

import { applyProfile, captureProfile, SavedProfile } from "./profile";
import { getProfiles, setActiveId, setProfiles } from "./store";

let busy = false;

export async function saveCurrentProfile(name?: string) {
    if (busy) return;
    busy = true;
    try {
        const me = UserStore.getCurrentUser();
        const fallback = `${me.globalName ?? me.username} ${new Date().toLocaleDateString()}`;
        const p = await captureProfile(name?.trim() || fallback);

        await setProfiles([...getProfiles(), p]);
        await setActiveId(p.id);
        showToast(`"${p.name}" gespeichert`, Toasts.Type.SUCCESS);
    } catch (e) {
        console.error("[ProfileSaver]", e);
        showToast("Speichern fehlgeschlagen, Details in der Konsole", Toasts.Type.FAILURE);
    } finally {
        busy = false;
    }
}

export async function switchToProfile(p: SavedProfile) {
    if (busy) return;
    busy = true;
    showToast(`Lade "${p.name}"...`);

    try {
        const { done, failed } = await applyProfile(p);
        await setActiveId(p.id);

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
    } finally {
        busy = false;
    }
}

export function deleteProfile(p: SavedProfile) {
    Alerts.show({
        title: `"${p.name}" löschen?`,
        body: "Das gespeicherte Profil ist danach weg.",
        confirmText: "Löschen",
        cancelText: "Abbrechen",
        onConfirm: () => setProfiles(getProfiles().filter(x => x.id !== p.id))
    });
}
