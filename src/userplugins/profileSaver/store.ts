import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import type { SavedProfile } from "./profile";

const STORE_KEY = "ProfileSaver_profiles";
const ACTIVE_KEY = "ProfileSaver_active";

let profiles: SavedProfile[] = [];
let activeId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach(l => l());
}

export async function loadStore() {
    profiles = (await DataStore.get<SavedProfile[]>(STORE_KEY)) ?? [];
    activeId = (await DataStore.get<string>(ACTIVE_KEY)) ?? null;
    emit();
}

export function getProfiles() {
    return profiles;
}

export function getActiveId() {
    return activeId;
}

export async function setProfiles(list: SavedProfile[]) {
    profiles = list;
    emit();
    await DataStore.set(STORE_KEY, list);
}

export async function setActiveId(id: string | null) {
    activeId = id;
    emit();
    await DataStore.set(ACTIVE_KEY, id);
}

export function useProfiles() {
    const [, rerender] = useState(0);

    useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);

    return { profiles, activeId };
}
