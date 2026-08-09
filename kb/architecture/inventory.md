---
tier: 1
owner: principal-client
consumers: [ALL]
last_verified: 2026-08-09
verify_every: 9999d
verified_by: generated
visibility: public
supersedes: []
related_adrs: []
---

# Code Inventory

> **GENERATED FILE — DO NOT EDIT.**
> Produced by `npm run kb:generate`. Edits are overwritten on the next run.
> To change this document, change the generator or the source it reads.

186 TypeScript file(s) under `src/`, 51,507 lines.

## Size hotspots

Files over 600 lines. Size is a proxy for tangled responsibility — when a unit
grows past comprehension its responsibilities have usually stopped being separable by
reading alone (Constitution P28).

| File | Lines |
|---|---:|
| `src/components/FullScreenPlayer.tsx` | 2370 |
| `src/screens/main/StoryViewerScreen.tsx` | 1604 |
| `src/screens/main/ConversationScreen.tsx` | 1432 |
| `src/components/PostCard.tsx` | 1266 |
| `src/screens/main/UploadScreen.tsx` | 1261 |
| `src/screens/main/HomeScreen.tsx` | 1142 |
| `src/screens/main/UserProfileScreen.tsx` | 1084 |
| `src/screens/main/ProfileScreen.tsx` | 1040 |
| `src/components/FloatingPlayer.tsx` | 927 |
| `src/screens/main/RepostScreen.tsx` | 856 |
| `src/screens/main/JamRoomScreen.tsx` | 821 |
| `src/components/CommentsSheet.tsx` | 776 |
| `src/screens/main/EditProfileScreen.tsx` | 719 |
| `src/screens/auth/BackstagePassOnboarding.tsx` | 683 |
| `src/screens/main/SearchScreen.tsx` | 647 |
| `src/screens/main/LibraryScreen.tsx` | 608 |
| `src/screens/main/CollaboratorPickerScreen.tsx` | 605 |

> 17 file(s) over the threshold against **3 custom hook(s)** in `src/hooks/`. The ratio of large units to extracted
> logic is the structural signal here, more than any individual file.

## RPCs called by the client but not defined in any migration

**1 found.** The client calls these by name and no migration creates
them — either they were created outside version control, or they do not exist, in which
case the call fails silently wherever its result is discarded.

🔒 Names and call sites are held in `kb/private/architecture/undefined-rpcs.md`.

## Navigation routes

| Route | Params |
|---|---|
| `Auth` | `undefined` |
| `App` | `undefined` |
| `Upload` | `undefined` |
| `CollaboratorPicker` | `{ /** * Roles already credited here, as `${userId}|${role}` (or `custom:${name}|${role}`). * * NOT a list of people to hide. One artist is routinely two credits — the guitarist who * also wrote it — and excluding them from the search after their first credit made the * second one impossible to add. */ takenRoleKeys?: string[]` |
| `UserProfile` | `{ userId: string` |
| `PlaylistDetail` | `{ playlistId: string` |
| `EditPlaylist` | `{ playlistId: string }` |
| `Following` | `undefined` |
| `RecentlyPlayed` | `undefined` |
| `EditProfile` | `undefined` |
| `Settings` | `undefined` |
| `NotificationSettings` | `undefined` |
| `PrivacyData` | `undefined` |
| `BlockedAccounts` | `undefined` |
| `DeleteAccount` | `undefined` |
| `CreatePlaylist` | `{ initialPost?: { postId: string` |
| `title` | `string` |
| `artistName` | `string` |
| `coverArtUrl` | `string | null` |
| `AlbumDetail` | `{ albumId: string` |
| `CreateAlbum` | `{ // When upload flow kicks off album creation, the new track id is passed in // so it can be auto-tagged into the freshly-created album. initialTrackId?: string` |
| `EditAlbum` | `{ albumId: string }` |
| `Inbox` | `undefined` |
| `Conversation` | `{ conversationId: string` |
| `NewConversation` | `undefined` |
| `GroupInfo` | `{ conversationId: string }` |
| `FriendRequests` | `undefined` |
| `ActivityCenter` | `undefined` |
| `JamRoom` | `{ jamRoomId: string` |
| `Repost` | `{ originalPostId: string` |
| `StoryViewer` | `{ clusters: { authorId: string` |
| `startAuthorIndex` | `number` |

## Screens

41 file(s), 20,487 lines.

| File | Lines |
|---|---:|
| `src/screens/main/StoryViewerScreen.tsx` | 1604 |
| `src/screens/main/ConversationScreen.tsx` | 1432 |
| `src/screens/main/UploadScreen.tsx` | 1261 |
| `src/screens/main/HomeScreen.tsx` | 1142 |
| `src/screens/main/UserProfileScreen.tsx` | 1084 |
| `src/screens/main/ProfileScreen.tsx` | 1040 |
| `src/screens/main/RepostScreen.tsx` | 856 |
| `src/screens/main/JamRoomScreen.tsx` | 821 |
| `src/screens/main/EditProfileScreen.tsx` | 719 |
| `src/screens/auth/BackstagePassOnboarding.tsx` | 683 |
| `src/screens/main/SearchScreen.tsx` | 647 |
| `src/screens/main/LibraryScreen.tsx` | 608 |
| `src/screens/main/CollaboratorPickerScreen.tsx` | 605 |
| `src/screens/main/GroupInfoScreen.tsx` | 582 |
| `src/screens/main/NewConversationScreen.tsx` | 462 |
| `src/screens/auth/SignUpScreen.tsx` | 453 |
| `src/screens/main/InboxScreen.tsx` | 408 |
| `src/screens/main/CreatePlaylistScreen.tsx` | 403 |
| `src/screens/main/EditAlbumScreen.tsx` | 400 |
| `src/screens/auth/SignInScreen.tsx` | 348 |
| `src/screens/main/EditPlaylistScreen.tsx` | 334 |
| `src/screens/auth/ChooseUsernameScreen.tsx` | 331 |
| `src/screens/main/ActivityCenterScreen.tsx` | 318 |
| `src/screens/main/NotificationSettingsScreen.tsx` | 284 |
| `src/screens/main/SettingsScreen.tsx` | 271 |
| `src/screens/main/__tests__/NotificationSettingsScreen.test.tsx` | 269 |
| `src/screens/main/PrivacyDataScreen.tsx` | 268 |
| `src/screens/main/PlaylistScreen.tsx` | 264 |
| `src/screens/main/DeleteAccountScreen.tsx` | 236 |
| `src/screens/main/CreateAlbumScreen.tsx` | 233 |
| `src/screens/main/FollowingScreen.tsx` | 225 |
| `src/screens/auth/ForgotPasswordScreen.tsx` | 218 |
| `src/screens/main/FriendRequestsScreen.tsx` | 217 |
| `src/screens/main/BlockedAccountsScreen.tsx` | 208 |
| `src/screens/main/RecentlyPlayedScreen.tsx` | 204 |
| `src/screens/main/AlbumDetailScreen.tsx` | 197 |
| `src/screens/main/__tests__/SettingsScreen.test.tsx` | 197 |
| `src/screens/main/__tests__/PrivacyDataScreen.test.tsx` | 190 |
| `src/screens/auth/ResetPasswordScreen.tsx` | 179 |
| `src/screens/auth/OnboardingScreen.tsx` | 168 |
| `src/screens/main/__tests__/DeleteAccountScreen.test.tsx` | 118 |

## Components

67 file(s), 16,311 lines.

| File | Lines |
|---|---:|
| `src/components/FullScreenPlayer.tsx` | 2370 |
| `src/components/PostCard.tsx` | 1266 |
| `src/components/FloatingPlayer.tsx` | 927 |
| `src/components/CommentsSheet.tsx` | 776 |
| `src/components/GlobalAudioPlayer.tsx` | 541 |
| `src/components/QueueList.tsx` | 475 |
| `src/components/MediaPlayer.tsx` | 469 |
| `src/components/AddUserSheet.tsx` | 401 |
| `src/components/onboarding/BackstagePass.tsx` | 400 |
| `src/components/DetailView.tsx` | 395 |
| `src/components/ClipRangeSlider.tsx` | 387 |
| `src/components/PostLikersSheet.tsx` | 356 |
| `src/components/TrackContextMenu.tsx` | 293 |
| `src/components/CommentItem.tsx` | 271 |
| `src/components/Icon.tsx` | 255 |
| `src/components/InboxBanner.tsx` | 254 |
| `src/components/Button.tsx` | 247 |
| `src/components/StoryReportModal.tsx` | 236 |
| `src/components/ActivityBubble.tsx` | 229 |
| `src/components/WaveVisualizer.tsx` | 219 |
| `src/components/AddToAlbumSheet.tsx` | 218 |
| `src/components/PostReportModal.tsx` | 213 |
| `src/components/CommentReportModal.tsx` | 208 |
| `src/components/SettingsRow.tsx` | 202 |
| `src/components/__tests__/SettingsRow.test.tsx` | 201 |
| `src/components/ConfirmActionModal.tsx` | 192 |
| `src/components/SettingsProfileCard.tsx` | 189 |
| `src/components/JamExitModal.tsx` | 188 |
| `src/components/PlaylistCoverPicker.tsx` | 185 |
| `src/components/GradientBorder.tsx` | 181 |
| `src/components/SwipeReplyRow.tsx` | 175 |
| `src/components/SeekBar.tsx` | 174 |
| `src/components/NotificationPermissionModal.tsx` | 168 |
| `src/components/TagInput.tsx` | 167 |
| `src/components/MentionSuggestions.tsx` | 160 |
| `src/components/ErrorBoundary.tsx` | 153 |
| `src/components/__tests__/GradientBorder.test.tsx` | 145 |
| `src/components/ProfileTabBar.tsx` | 140 |
| `src/components/onboarding/HoloShimmer.tsx` | 130 |
| `src/components/SettingsHighlightCard.tsx` | 124 |
| `src/components/onboarding/StageLamp.tsx` | 121 |
| `src/components/ProfileGridCard.tsx` | 117 |
| `src/components/ArtGlow.tsx` | 116 |
| `src/components/ProgressiveImage.tsx` | 99 |
| `src/components/LikedByLine.tsx` | 98 |
| `src/components/AddBadge.tsx` | 95 |
| `src/components/SettingsSection.tsx` | 93 |
| `src/components/DetailActionSheet.tsx` | 87 |
| `src/components/Scrim.tsx` | 83 |
| `src/components/onboarding/Crowd.tsx` | 81 |
| `src/components/EmojiCoverArt.tsx` | 76 |
| `src/components/GradientFill.tsx` | 74 |
| `src/components/PostCardSkeleton.tsx` | 74 |
| `src/components/SwipeRevealRow.tsx` | 74 |
| `src/components/FeedEndMessage.tsx` | 73 |
| `src/components/__tests__/ProfileTabBar.test.tsx` | 71 |
| `src/components/FormInput.tsx` | 69 |
| `src/components/onboarding/StripedFill.tsx` | 69 |
| `src/components/VisibilitySelector.tsx` | 68 |
| `src/components/__tests__/CollabAvatar.test.tsx` | 67 |
| `src/components/SettingsHeader.tsx` | 66 |
| `src/components/onboarding/ScreenBackdrop.tsx` | 65 |
| `src/components/CollabAvatar.tsx` | 55 |
| `src/components/GoogleGlyph.tsx` | 46 |
| `src/components/onboarding/Barcode.tsx` | 41 |
| `src/components/ChatTimeSeparator.tsx` | 31 |
| `src/components/Logo.tsx` | 22 |

## Services

32 file(s), 8,390 lines.

| File | Lines |
|---|---:|
| `src/services/posts.ts` | 1052 |
| `src/services/tracks.ts` | 822 |
| `src/services/pushNotifications.ts` | 615 |
| `src/services/albums.ts` | 497 |
| `src/services/comments.ts` | 383 |
| `src/services/playlists.ts` | 382 |
| `src/services/profileService.ts` | 374 |
| `src/services/activity.ts` | 364 |
| `src/services/messages.ts` | 362 |
| `src/services/jamRooms.ts` | 325 |
| `src/services/conversations.ts` | 291 |
| `src/services/jamRealtime.ts` | 251 |
| `src/services/__tests__/deleteMyAccount.test.ts` | 229 |
| `src/services/__tests__/publishTrackCredits.test.ts` | 227 |
| `src/services/relationships.ts` | 224 |
| `src/services/__tests__/authorMapping.test.ts` | 221 |
| `src/services/uploads.ts` | 218 |
| `src/services/stories.ts` | 209 |
| `src/services/__tests__/tags.test.ts` | 180 |
| `src/services/__tests__/waveform.test.ts` | 173 |
| `src/services/__tests__/lyrics.test.ts` | 167 |
| `src/services/__tests__/waveformDsp.test.ts` | 166 |
| `src/services/__tests__/publishTrackCleanup.test.ts` | 157 |
| `src/services/messageCache.ts` | 109 |
| `src/services/__tests__/getBlockedChannelIds.test.ts` | 91 |
| `src/services/searchAnalytics.ts` | 72 |
| `src/services/waveform.ts` | 66 |
| `src/services/follows.ts` | 48 |
| `src/services/pushDispatch.ts` | 48 |
| `src/services/friendActivity.ts` | 33 |
| `src/services/googleAuth.ts` | 19 |
| `src/services/uploadEvents.ts` | 15 |

## Contexts

9 file(s), 2,298 lines.

| File | Lines |
|---|---:|
| `src/contexts/PlaybackContext.tsx` | 955 |
| `src/contexts/JamRealtimeContext.tsx` | 389 |
| `src/contexts/RelationshipContext.tsx` | 345 |
| `src/contexts/ToastContext.tsx` | 190 |
| `src/contexts/__tests__/PlaybackContext.clipSession.test.tsx` | 148 |
| `src/contexts/SwipeRevealContext.tsx` | 107 |
| `src/contexts/ChromeVisibilityContext.tsx` | 69 |
| `src/contexts/StoriesContext.tsx` | 54 |
| `src/contexts/JamContext.tsx` | 41 |

## Hooks

3 file(s), 168 lines.

| File | Lines |
|---|---:|
| `src/hooks/useRecentSearches.ts` | 85 |
| `src/hooks/useCommentsCountDeltas.ts` | 46 |
| `src/hooks/useImageAspect.ts` | 37 |

## Utilities

19 file(s), 2,374 lines.

| File | Lines |
|---|---:|
| `src/utils/__tests__/playTracker.test.ts` | 226 |
| `src/utils/searchRanking.ts` | 219 |
| `src/utils/__tests__/searchRanking.test.ts` | 212 |
| `src/utils/__tests__/nowPlayingMetadata.test.ts` | 191 |
| `src/utils/__tests__/groupStoriesByAuthor.test.ts` | 167 |
| `src/utils/__tests__/storyPlayback.test.ts` | 152 |
| `src/utils/__tests__/authorDisplay.test.ts` | 135 |
| `src/utils/groupStoriesByAuthor.ts` | 125 |
| `src/utils/nowPlayingMetadata.ts` | 123 |
| `src/utils/mentions.ts` | 105 |
| `src/utils/storyPlayback.ts` | 98 |
| `src/utils/playTracker.ts` | 90 |
| `src/utils/haptics.ts` | 86 |
| `src/utils/chatTime.ts` | 82 |
| `src/utils/__tests__/recentSearches.test.ts` | 78 |
| `src/utils/__tests__/chatTime.test.ts` | 73 |
| `src/utils/authorDisplay.ts` | 72 |
| `src/utils/recentSearches.ts` | 72 |
| `src/utils/errorMessages.ts` | 68 |

## Dependencies

Declared range versus what is actually installed. A drift here means a pinned
version is not the version running (Constitution P52).

| Package | Declared | Installed |
|---|---|---|
| `@notifee/react-native` | `^9.1.8` | 9.1.8 |
| `@react-native-async-storage/async-storage` | `^1.23.1` | 1.23.1 |
| `@react-native-documents/picker` | `^10.1.7` | 10.1.7 |
| `@react-native-firebase/app` | `^24.1.0` | 24.1.0 |
| `@react-native-firebase/messaging` | `^24.1.0` | 24.1.0 |
| `@react-native-masked-view/masked-view` | `^0.3.2` | 0.3.2 |
| `@react-navigation/bottom-tabs` | `^7.15.10` | 7.15.10 |
| `@react-navigation/native` | `^7.2.2` | 7.2.2 |
| `@react-navigation/native-stack` | `^7.14.12` | 7.14.12 |
| `@react-navigation/stack` | `^7.8.11` | 7.8.11 |
| `@supabase/supabase-js` | `^2.99.3` | 2.99.3 |
| `fft.js` | `4.0.4` | 4.0.4 |
| `lucide-react-native` | `1.18.0` | 1.18.0 |
| `phosphor-react-native` | `3.0.6` | 3.0.6 |
| `react` | `19.2.3` | 19.2.3 |
| `react-native` | `0.85.3` | 0.85.3 |
| `react-native-app-auth` | `^8.4.0` | 8.4.0 |
| `react-native-audio-api` | `0.12.2` | 0.12.2 |
| `react-native-gesture-handler` | `^2.24.0` | **2.31.2** |
| `react-native-image-crop-picker` | `^0.51.1` | 0.51.1 |
| `react-native-keyboard-controller` | `^1.21.9` | 1.21.9 |
| `react-native-reanimated` | `^4.4.0` | 4.4.0 |
| `react-native-safe-area-context` | `^5.8.0` | 5.8.0 |
| `react-native-screens` | `^4.11.0` | **4.25.2** |
| `react-native-svg` | `15.15.5` | 15.15.5 |
| `react-native-url-polyfill` | `^3.0.0` | 3.0.0 |
| `react-native-video` | `6.19.2` | 6.19.2 |
| `react-native-worklets` | `^0.9.0` | **0.9.1** |
| `text-encoding-polyfill` | `^0.6.7` | 0.6.7 |

*Bold = installed version differs from the floor of the declared range.*
