/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 ProfileManager PRO contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByCode, findByProps } from "@webpack";
import {
    Constants,
    FluxDispatcher,
    RestAPI,
    UserProfileSettingsStore,
    UserProfileStore,
    UserStore,
} from "@webpack/common";

import { downloadDiscordMedia } from "./core/media";
import { assertResponse, NativeResponse } from "./core/response";
import { DiscordPort, ProfileFields, RemoteProfile } from "./core/types";
import { validateRemote } from "./core/validation";

type AccountSave = (patch: { avatar?: string | null; globalName?: string | null }) => Promise<NativeResponse>;
type ProfileSave = (patch: Record<string, unknown>, guildId?: string, md5?: string) => Promise<NativeResponse>;
let saveAccount: AccountSave | undefined;
let saveProfile: ProfileSave | undefined;
function resolveActions() {
    // Native actions, not guessed exports or manually authenticated requests.
    try {
        saveAccount ??= findByCode('"USER_PROFILE_SETTINGS_SUBMIT"', "avatar:", "global_name:") as
            | AccountSave
            | undefined;
        saveProfile ??= findByCode('"USER_PROFILE_UPDATE_START"', '"USER_PROFILE_UPDATE_SUCCESS"') as
            | ProfileSave
            | undefined;
    } catch {
        throw new Error(
            "Discord profile save modules are unavailable. Open the native Profile settings once; if the problem persists, update Vencord and restart Discord. No changes were sent.",
        );
    }
    if (typeof saveAccount !== "function" || typeof saveProfile !== "function")
        throw new Error(
            "Discord's profile save modules could not be found. Update Vencord and reopen Discord. No changes were sent.",
        );
    return { account: saveAccount, profile: saveProfile };
}
export const discord: DiscordPort = {
    accountId() {
        const id = UserStore.getCurrentUser()?.id;
        if (!id) throw new Error("Sign in to Discord before opening ProfileManager PRO.");
        return id;
    },
    assertReady() {
        resolveActions();
        if (UserProfileSettingsStore.hasUnsavedChanges())
            throw new Error(
                "The native profile editor has unsaved changes. Save or reset those changes before switching a preset.",
            );
        if (
            UserProfileStore.isSubmitting ||
            ["SUBMITTING", "submitting"].includes(String(UserProfileSettingsStore.getFormState()))
        )
            throw new Error("Discord is already saving your profile. Wait for that save to finish.");
    },
    async read() {
        const id = this.accountId();
        // Same endpoint and Flux hydration as Vencord's fetchUserProfile, without its cache shortcut.
        const response = await RestAPI.get({
            url: Constants.Endpoints.USER_PROFILE(id),
            query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            oldFormErrors: true,
            retries: 0,
        });
        assertResponse(response, "Reading current profile");
        if (this.accountId() !== id) throw new Error("Account changed while reading the profile.");
        const { body } = response,
            user = body?.user,
            profile = body?.user_profile ?? {};
        if (!user || user.id !== id || !Object.hasOwn(body, "user_profile") || typeof profile !== "object")
            throw new Error("Discord returned an incomplete global profile. Nothing was saved or applied.");
        FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
        FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: body });
        return validateRemote(
            {
                accountId: id,
                avatarHash: user.avatar ?? null,
                bannerHash: profile.banner ?? user.banner ?? null,
                accentColor: profile.accent_color ?? user.accent_color ?? null,
                themeColors: profile.theme_colors ?? null,
                bio: profile.bio ?? "",
                pronouns: profile.pronouns ?? "",
                globalName: user.global_name ?? null,
                premiumType: body.premium_type ?? user.premium_type ?? 0,
            },
            id,
        );
    },
    async snapshot(remote: RemoteProfile): Promise<ProfileFields> {
        if (this.accountId() !== remote.accountId) throw new Error("Account changed before the snapshot.");
        const [avatar, banner] = await Promise.all([
            downloadDiscordMedia(remote.accountId, remote.avatarHash, "avatars"),
            downloadDiscordMedia(remote.accountId, remote.bannerHash, "banners"),
        ]);
        if (this.accountId() !== remote.accountId) throw new Error("Account changed during image capture.");
        return {
            avatar,
            banner,
            accentColor: remote.accentColor,
            themeColors: remote.themeColors,
            bio: remote.bio,
            pronouns: remote.pronouns,
            globalName: remote.globalName,
        };
    },
    checkCapabilities(fields, remote) {
        if ([fields.avatar, fields.banner].some(m => m?.animated && m.mime !== "image/gif"))
            throw new Error(
                "Use GIF for animated avatars and banners. Animated PNG/WebP upload behavior is not reliable across Discord clients.",
            );
        const capabilities = findByProps("canUseAnimatedAvatar", "canUsePremiumProfileCustomization");
        if (!capabilities) throw new Error("Discord's entitlement checks are unavailable. No changes were sent.");
        const user = UserStore.getCurrentUser();
        if (
            (fields.banner || fields.themeColors) &&
            (remote.premiumType !== 2 || !capabilities.canUsePremiumProfileCustomization(user))
        )
            throw new Error(
                "This preset uses a banner or custom profile colors. Full Discord Nitro is required for these features.",
            );
        if (fields.avatar?.animated && (!remote.premiumType || !capabilities.canUseAnimatedAvatar(user)))
            throw new Error("Your current Discord subscription does not allow animated avatars.");
        if (fields.banner?.animated && remote.premiumType !== 2)
            throw new Error("An animated banner requires full Nitro.");
    },
    async writeAccount(fields, before, changeAvatar) {
        if (this.accountId() !== before.accountId) throw new Error("Account changed before saving avatar.");
        const patch: { avatar?: string | null; globalName?: string | null } = {};
        if (changeAvatar) patch.avatar = fields.avatar?.data ?? null;
        if (fields.globalName !== undefined && fields.globalName !== before.globalName)
            patch.globalName = fields.globalName;
        const response = await resolveActions().account(patch);
        assertResponse(response, "Saving avatar / display name");
    },
    async writeProfile(fields, changeBanner) {
        const patch: Record<string, unknown> = {
            accent_color: fields.accentColor,
            theme_colors: fields.themeColors,
            bio: fields.bio,
            pronouns: fields.pronouns,
        };
        if (changeBanner) patch.banner = fields.banner?.data ?? null;
        const response = await resolveActions().profile(patch, undefined);
        assertResponse(response, "Saving global profile");
    },
};
