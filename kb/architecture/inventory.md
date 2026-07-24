---
tier: 1
owner: principal-client
consumers: [ALL]
last_verified: 2026-07-24
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

127 TypeScript file(s) under `src/`, 38,799 lines.

## Size hotspots

Files over 600 lines. Size is a proxy for tangled responsibility — when a unit
grows past comprehension its responsibilities have usually stopped being separable by
reading alone (Constitution P28).

| File | Lines |
|---|---:|
| `src/components/FullScreenPlayer.tsx` | 2047 |
| `src/screens/main/ConversationScreen.tsx` | 1406 |
| `src/components/PostCard.tsx` | 1197 |
| `src/screens/main/HomeScreen.tsx` | 1104 |
| `src/screens/main/UploadScreen.tsx` | 1096 |
| `src/screens/main/ProfileScreen.tsx` | 1067 |
| `src/components/FloatingPlayer.tsx` | 924 |
| `src/screens/main/JamRoomScreen.tsx` | 821 |
| `src/screens/main/UserProfileScreen.tsx` | 793 |
| `src/components/CommentsSheet.tsx` | 776 |
| `src/screens/main/RepostScreen.tsx` | 749 |
| `src/screens/main/EditProfileScreen.tsx` | 719 |
| `src/screens/main/LibraryScreen.tsx` | 604 |

> 13 file(s) over the threshold against **1 custom hook(s)** in `src/hooks/`. The ratio of large units to extracted
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
| `CollaboratorPicker` | `{ excludeUserIds?: string[]` |
| `UserProfile` | `{ userId: string` |
| `PlaylistDetail` | `{ playlistId: string` |
| `EditPlaylist` | `{ playlistId: string }` |
| `Following` | `undefined` |
| `RecentlyPlayed` | `undefined` |
| `EditProfile` | `undefined` |
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
| `StoryViewer` | `{ storyIds: string[]` |

## Screens

31 file(s), 15,700 lines.

| File | Lines |
|---|---:|
| `src/screens/main/ConversationScreen.tsx` | 1406 |
| `src/screens/main/HomeScreen.tsx` | 1104 |
| `src/screens/main/UploadScreen.tsx` | 1096 |
| `src/screens/main/ProfileScreen.tsx` | 1067 |
| `src/screens/main/JamRoomScreen.tsx` | 821 |
| `src/screens/main/UserProfileScreen.tsx` | 793 |
| `src/screens/main/RepostScreen.tsx` | 749 |
| `src/screens/main/EditProfileScreen.tsx` | 719 |
| `src/screens/main/LibraryScreen.tsx` | 604 |
| `src/screens/main/GroupInfoScreen.tsx` | 585 |
| `src/screens/main/SearchScreen.tsx` | 543 |
| `src/screens/main/CollaboratorPickerScreen.tsx` | 484 |
| `src/screens/main/NewConversationScreen.tsx` | 462 |
| `src/screens/auth/SignUpScreen.tsx` | 453 |
| `src/screens/main/StoryViewerScreen.tsx` | 441 |
| `src/screens/main/InboxScreen.tsx` | 408 |
| `src/screens/main/CreatePlaylistScreen.tsx` | 403 |
| `src/screens/main/EditAlbumScreen.tsx` | 400 |
| `src/screens/auth/SignInScreen.tsx` | 348 |
| `src/screens/main/EditPlaylistScreen.tsx` | 334 |
| `src/screens/auth/ChooseUsernameScreen.tsx` | 331 |
| `src/screens/main/ActivityCenterScreen.tsx` | 260 |
| `src/screens/main/PlaylistScreen.tsx` | 260 |
| `src/screens/main/CreateAlbumScreen.tsx` | 233 |
| `src/screens/main/FollowingScreen.tsx` | 221 |
| `src/screens/auth/ForgotPasswordScreen.tsx` | 218 |
| `src/screens/main/FriendRequestsScreen.tsx` | 217 |
| `src/screens/main/RecentlyPlayedScreen.tsx` | 200 |
| `src/screens/main/AlbumDetailScreen.tsx` | 193 |
| `src/screens/auth/ResetPasswordScreen.tsx` | 179 |
| `src/screens/auth/OnboardingScreen.tsx` | 168 |

## Components

46 file(s), 12,855 lines.

| File | Lines |
|---|---:|
| `src/components/FullScreenPlayer.tsx` | 2047 |
| `src/components/PostCard.tsx` | 1197 |
| `src/components/FloatingPlayer.tsx` | 924 |
| `src/components/CommentsSheet.tsx` | 776 |
| `src/components/GlobalAudioPlayer.tsx` | 423 |
| `src/components/MediaPlayer.tsx` | 419 |
| `src/components/QueueList.tsx` | 406 |
| `src/components/DetailView.tsx` | 395 |
| `src/components/ClipRangeSlider.tsx` | 387 |
| `src/components/AddUserSheet.tsx` | 376 |
| `src/components/PostLikersSheet.tsx` | 351 |
| `src/components/TrackContextMenu.tsx` | 293 |
| `src/components/CommentItem.tsx` | 271 |
| `src/components/InboxBanner.tsx` | 254 |
| `src/components/WaveVisualizer.tsx` | 219 |
| `src/components/AddToAlbumSheet.tsx` | 218 |
| `src/components/Button.tsx` | 214 |
| `src/components/PostReportModal.tsx` | 213 |
| `src/components/CommentReportModal.tsx` | 208 |
| `src/components/Icon.tsx` | 201 |
| `src/components/ConfirmActionModal.tsx` | 188 |
| `src/components/JamExitModal.tsx` | 188 |
| `src/components/PlaylistCoverPicker.tsx` | 185 |
| `src/components/GradientBorder.tsx` | 181 |
| `src/components/SwipeReplyRow.tsx` | 179 |
| `src/components/SeekBar.tsx` | 174 |
| `src/components/NotificationPermissionModal.tsx` | 168 |
| `src/components/ActivityBubble.tsx` | 162 |
| `src/components/MentionSuggestions.tsx` | 160 |
| `src/components/ErrorBoundary.tsx` | 153 |
| `src/components/__tests__/GradientBorder.test.tsx` | 145 |
| `src/components/ProfileTabBar.tsx` | 123 |
| `src/components/ProfileGridCard.tsx` | 117 |
| `src/components/ProgressiveImage.tsx` | 99 |
| `src/components/LikedByLine.tsx` | 98 |
| `src/components/AddBadge.tsx` | 95 |
| `src/components/DetailActionSheet.tsx` | 87 |
| `src/components/EmojiCoverArt.tsx` | 76 |
| `src/components/GradientFill.tsx` | 74 |
| `src/components/PostCardSkeleton.tsx` | 74 |
| `src/components/SwipeRevealRow.tsx` | 74 |
| `src/components/FeedEndMessage.tsx` | 73 |
| `src/components/FormInput.tsx` | 69 |
| `src/components/VisibilitySelector.tsx` | 68 |
| `src/components/ChatTimeSeparator.tsx` | 31 |
| `src/components/Logo.tsx` | 22 |

## Services

23 file(s), 6,101 lines.

| File | Lines |
|---|---:|
| `src/services/posts.ts` | 806 |
| `src/services/tracks.ts` | 694 |
| `src/services/pushNotifications.ts` | 444 |
| `src/services/albums.ts` | 430 |
| `src/services/comments.ts` | 383 |
| `src/services/playlists.ts` | 382 |
| `src/services/messages.ts` | 362 |
| `src/services/waveform.ts` | 324 |
| `src/services/activity.ts` | 306 |
| `src/services/jamRooms.ts` | 301 |
| `src/services/jamRealtime.ts` | 251 |
| `src/services/conversations.ts` | 238 |
| `src/services/profileService.ts` | 233 |
| `src/services/uploads.ts` | 218 |
| `src/services/__tests__/waveform.test.ts` | 173 |
| `src/services/stories.ts` | 152 |
| `src/services/relationships.ts` | 132 |
| `src/services/messageCache.ts` | 109 |
| `src/services/follows.ts` | 48 |
| `src/services/pushDispatch.ts` | 48 |
| `src/services/friendActivity.ts` | 33 |
| `src/services/googleAuth.ts` | 19 |
| `src/services/uploadEvents.ts` | 15 |

## Contexts

8 file(s), 1,914 lines.

| File | Lines |
|---|---:|
| `src/contexts/PlaybackContext.tsx` | 789 |
| `src/contexts/JamRealtimeContext.tsx` | 389 |
| `src/contexts/RelationshipContext.tsx` | 294 |
| `src/contexts/ToastContext.tsx` | 183 |
| `src/contexts/SwipeRevealContext.tsx` | 107 |
| `src/contexts/ChromeVisibilityContext.tsx` | 69 |
| `src/contexts/StoriesContext.tsx` | 42 |
| `src/contexts/JamContext.tsx` | 41 |

## Hooks

1 file(s), 46 lines.

| File | Lines |
|---|---:|
| `src/hooks/useCommentsCountDeltas.ts` | 46 |

## Utilities

8 file(s), 933 lines.

| File | Lines |
|---|---:|
| `src/utils/__tests__/playTracker.test.ts` | 208 |
| `src/utils/__tests__/nowPlayingMetadata.test.ts` | 191 |
| `src/utils/nowPlayingMetadata.ts` | 123 |
| `src/utils/mentions.ts` | 105 |
| `src/utils/playTracker.ts` | 83 |
| `src/utils/chatTime.ts` | 82 |
| `src/utils/__tests__/chatTime.test.ts` | 73 |
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
