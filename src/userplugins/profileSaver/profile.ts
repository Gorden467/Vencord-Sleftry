import { Logger } from "@utils/Logger";
import { RestAPI, UserStore } from "@webpack/common";

const logger = new Logger("ProfileSaver");

export interface SavedProfile {
    id: string;
    name: string;
    savedAt: number;
    sourceUser: string;

    globalName: string | null;
    pronouns: string | null;
    bio: string | null;
    accentColor: number | null;
    themeColors: number[] | null;

    avatar: string | null;
    banner: string | null;

    decoration: { asset: string; skuId: string; } | null;
    profileEffect: { id: string; skuId: string | null; } | null;

    customStatus: {
        text: string | null;
        emojiId: string | null;
        emojiName: string | null;
    } | null;
}

export interface ApplyResult {
    done: string[];
    failed: string[];
}

function cdnUrl(kind: "avatars" | "banners", userId: string, hash: string) {
    const ext = hash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/${kind}/${userId}/${hash}.${ext}?size=1024`;
}

async function toDataUrl(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const blob = await res.blob();

    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export async function captureProfile(name: string): Promise<SavedProfile> {
    const me = UserStore.getCurrentUser();

    const { body } = await RestAPI.get({
        url: `/users/${me.id}/profile`,
        query: { with_mutual_guilds: false, with_mutual_friends: false }
    });
    const user = body?.user ?? {};
    const profile = body?.user_profile ?? {};

    let customStatus: SavedProfile["customStatus"] = null;
    try {
        const settings = await RestAPI.get({ url: "/users/@me/settings" });
        const cs = settings.body?.custom_status;
        if (cs) customStatus = { text: cs.text ?? null, emojiId: cs.emoji_id ?? null, emojiName: cs.emoji_name ?? null };
    } catch (e) {
        logger.warn("Could not read custom status", e);
    }

    const bannerHash = profile.banner ?? user.banner ?? null;
    const deco = user.avatar_decoration_data;
    const effect = profile.profile_effect;

    return {
        id: Date.now().toString(36),
        name,
        savedAt: Date.now(),
        sourceUser: user.username ?? me.username,

        globalName: user.global_name ?? null,
        pronouns: profile.pronouns || null,
        bio: profile.bio ?? user.bio ?? null,
        accentColor: profile.accent_color ?? user.accent_color ?? null,
        themeColors: profile.theme_colors ?? null,

        avatar: user.avatar ? await toDataUrl(cdnUrl("avatars", me.id, user.avatar)) : null,
        banner: bannerHash ? await toDataUrl(cdnUrl("banners", me.id, bannerHash)) : null,

        decoration: deco?.asset ? { asset: deco.asset, skuId: deco.sku_id } : null,
        profileEffect: effect?.id ? { id: effect.id, skuId: effect.sku_id ?? null } : null,

        customStatus
    };
}

async function patch(url: string, body: any) {
    try {
        return await RestAPI.patch({ url, body });
    } catch (e: any) {
        if (e?.status !== 429) throw e;

        const wait = Math.ceil((e.body?.retry_after ?? 2) * 1000);
        logger.warn(`Rate limited on ${url}, waiting ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        return RestAPI.patch({ url, body });
    }
}

function errorText(e: any) {
    const msg = e?.body?.message ?? e?.message ?? "unbekannter Fehler";
    const firstField = e?.body?.errors && Object.values<any>(e.body.errors)[0]?._errors?.[0]?.message;
    return firstField ? `${msg}: ${firstField}` : msg;
}

export async function applyProfile(p: SavedProfile): Promise<ApplyResult> {
    const result: ApplyResult = { done: [], failed: [] };

    // each part on its own, so missing Nitro for the banner doesn't block the rest
    const step = async (label: string, fn: () => Promise<unknown>) => {
        try {
            await fn();
            result.done.push(label);
        } catch (e) {
            logger.error(`Failed: ${label}`, e);
            result.failed.push(`${label} (${errorText(e)})`);
        }
    };

    await step("Anzeigename + Profilbild", () => patch("/users/@me", {
        global_name: p.globalName,
        avatar: p.avatar
    }));

    await step("Info, Pronomen + Farben", () => patch("/users/@me/profile", {
        bio: p.bio ?? "",
        pronouns: p.pronouns ?? "",
        accent_color: p.accentColor,
        theme_colors: p.themeColors
    }));

    await step("Banner", () => patch("/users/@me", { banner: p.banner }));

    await step("Avatar-Deko", () => patch("/users/@me", {
        avatar_decoration_id: p.decoration?.asset ?? null,
        avatar_decoration_sku_id: p.decoration?.skuId ?? null
    }));

    if (p.profileEffect) {
        await step("Profileffekt", () => patch("/users/@me/profile", {
            profile_effect_id: p.profileEffect!.id,
            profile_effect_sku_id: p.profileEffect!.skuId
        }));
    }

    const cs = p.customStatus;
    await step("Status", () => patch("/users/@me/settings", {
        custom_status: cs?.text || cs?.emojiName
            ? { text: cs.text, emoji_id: cs.emojiId, emoji_name: cs.emojiName, expires_at: null }
            : null
    }));

    return result;
}
