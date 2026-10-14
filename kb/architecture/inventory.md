---
tier: 1
owner: principal-client
consumers: [ALL]
last_verified: 2026-10-14
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

341 TypeScript file(s) under `src/`, 78,403 lines.

## Size hotspots

Files over 600 lines. Size is a proxy for tangled responsibility — when a unit
grows past comprehension its responsibilities have usually stopped being separable by
reading alone (Constitution P28).

| File | Lines |
|---|---:|
| `src/components/FullScreenPlayer.tsx` | 2520 |
| `src/screens/main/ConversationScreen.tsx` | 2074 |
| `src/screens/main/StoryViewerScreen.tsx` | 1672 |
| `src/screens/main/UploadScreen.tsx` | 1546 |
| `src/screens/main/HomeScreen.tsx` | 1486 |
| `src/components/PostCard.tsx` | 1418 |
| `src/screens/main/UserProfileScreen.tsx` | 1310 |
| `src/screens/main/ProfileScreen.tsx` | 1281 |
| `src/components/WaveformScrubber.tsx` | 1158 |
| `src/screens/main/JamRoomScreen.tsx` | 1155 |
| `src/screens/main/SearchScreen.tsx` | 977 |
| `src/screens/main/RepostScreen.tsx` | 959 |
| `src/components/FloatingPlayer.tsx` | 926 |
| `src/screens/auth/BackstagePassOnboarding.tsx` | 807 |
| `src/components/CommentsSheet.tsx` | 743 |
| `src/screens/main/EditProfileScreen.tsx` | 722 |
| `src/components/guide/cardsPeople.tsx` | 640 |
| `src/screens/main/LibraryScreen.tsx` | 632 |
| `src/screens/main/CollaboratorPickerScreen.tsx` | 607 |
| `src/components/GlobalAudioPlayer.tsx` | 606 |
| `src/screens/main/GroupInfoScreen.tsx` | 604 |

> 21 file(s) over the threshold against **18 custom hook(s)** in `src/hooks/`. The ratio of large units to extracted
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
| `ProfilePeople` | `{ userId: string` |
| `kind` | `'friends' | 'stars' | 'fans' | 'mutualFriends' | 'friendFans'` |
| `RecentlyPlayed` | `undefined` |
| `PostDetail` | `{ postId: string` |
| `EditProfile` | `undefined` |
| `Settings` | `undefined` |
| `FirstRunGuide` | `undefined` |
| `NotificationSettings` | `undefined` |
| `PrivacyData` | `undefined` |
| `ContactTeam` | `undefined` |
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
| `AddToLivil` | `undefined` |
| `SpotifyRepost` | `{ spotifyTrackId?: string` |
| `StoryViewer` | `{ clusters: { authorId: string` |
| `startAuthorIndex` | `number` |

## Screens

48 file(s), 25,575 lines.

| File | Lines |
|---|---:|
| `src/screens/main/ConversationScreen.tsx` | 2074 |
| `src/screens/main/StoryViewerScreen.tsx` | 1672 |
| `src/screens/main/UploadScreen.tsx` | 1546 |
| `src/screens/main/HomeScreen.tsx` | 1486 |
| `src/screens/main/UserProfileScreen.tsx` | 1310 |
| `src/screens/main/ProfileScreen.tsx` | 1281 |
| `src/screens/main/JamRoomScreen.tsx` | 1155 |
| `src/screens/main/SearchScreen.tsx` | 977 |
| `src/screens/main/RepostScreen.tsx` | 959 |
| `src/screens/auth/BackstagePassOnboarding.tsx` | 807 |
| `src/screens/main/EditProfileScreen.tsx` | 722 |
| `src/screens/main/LibraryScreen.tsx` | 632 |
| `src/screens/main/CollaboratorPickerScreen.tsx` | 607 |
| `src/screens/main/GroupInfoScreen.tsx` | 604 |
| `src/screens/main/InboxScreen.tsx` | 502 |
| `src/screens/main/NewConversationScreen.tsx` | 475 |
| `src/screens/main/SpotifyRepostScreen.tsx` | 471 |
| `src/screens/auth/SignUpScreen.tsx` | 470 |
| `src/screens/main/CreatePlaylistScreen.tsx` | 404 |
| `src/screens/main/EditAlbumScreen.tsx` | 404 |
| `src/screens/auth/ChooseUsernameScreen.tsx` | 372 |
| `src/screens/main/EditPlaylistScreen.tsx` | 338 |
| `src/screens/auth/SignInScreen.tsx` | 336 |
| `src/screens/main/ActivityCenterScreen.tsx` | 314 |
| `src/screens/main/PrivacyDataScreen.tsx` | 313 |
| `src/screens/main/SettingsScreen.tsx` | 294 |
| `src/screens/main/ProfilePeopleScreen.tsx` | 292 |
| `src/screens/main/NotificationSettingsScreen.tsx` | 284 |
| `src/screens/main/ContactTeamScreen.tsx` | 272 |
| `src/screens/main/__tests__/PrivacyDataScreen.test.tsx` | 271 |
| `src/screens/main/PlaylistScreen.tsx` | 269 |
| `src/screens/main/__tests__/NotificationSettingsScreen.test.tsx` | 269 |
| `src/screens/main/DeleteAccountScreen.tsx` | 259 |
| `src/screens/main/RecentlyPlayedScreen.tsx` | 255 |
| `src/screens/auth/TermsAcceptScreen.tsx` | 236 |
| `src/screens/main/CreateAlbumScreen.tsx` | 234 |
| `src/screens/main/FollowingScreen.tsx` | 231 |
| `src/screens/auth/FirstRunGuideScreen.tsx` | 228 |
| `src/screens/main/__tests__/SettingsScreen.test.tsx` | 227 |
| `src/screens/main/FriendRequestsScreen.tsx` | 223 |
| `src/screens/auth/ForgotPasswordScreen.tsx` | 218 |
| `src/screens/main/BlockedAccountsScreen.tsx` | 209 |
| `src/screens/main/AlbumDetailScreen.tsx` | 202 |
| `src/screens/main/PostDetailScreen.tsx` | 202 |
| `src/screens/main/__tests__/DeleteAccountScreen.test.tsx` | 185 |
| `src/screens/auth/ResetPasswordScreen.tsx` | 181 |
| `src/screens/auth/OnboardingScreen.tsx` | 168 |
| `src/screens/main/AddToLivilScreen.tsx` | 135 |

## Components

127 file(s), 27,625 lines.

| File | Lines |
|---|---:|
| `src/components/FullScreenPlayer.tsx` | 2520 |
| `src/components/PostCard.tsx` | 1418 |
| `src/components/WaveformScrubber.tsx` | 1158 |
| `src/components/FloatingPlayer.tsx` | 926 |
| `src/components/CommentsSheet.tsx` | 743 |
| `src/components/guide/cardsPeople.tsx` | 640 |
| `src/components/GlobalAudioPlayer.tsx` | 606 |
| `src/components/SheetModal.tsx` | 570 |
| `src/components/guide/cardsFeed.tsx` | 501 |
| `src/components/MediaPlayer.tsx` | 454 |
| `src/components/QueueList.tsx` | 425 |
| `src/components/DetailView.tsx` | 411 |
| `src/components/onboarding/BackstagePass.tsx` | 400 |
| `src/components/AddUserSheet.tsx` | 392 |
| `src/components/SharePostSheet.tsx` | 372 |
| `src/components/CopyrightMatchModal.tsx` | 371 |
| `src/components/SpotifyPostCard.tsx` | 371 |
| `src/components/ChatSongPicker.tsx` | 360 |
| `src/components/PostLikersSheet.tsx` | 330 |
| `src/components/ActivityBubble.tsx` | 319 |
| `src/components/guide/primitives.tsx` | 319 |
| `src/components/JamSuggestsTab.tsx` | 303 |
| `src/components/TrackContextMenu.tsx` | 293 |
| `src/components/CommentItem.tsx` | 278 |
| `src/components/Icon.tsx` | 276 |
| `src/components/Button.tsx` | 254 |
| `src/components/InboxBanner.tsx` | 254 |
| `src/components/OnboardingNotice.tsx` | 251 |
| `src/components/guide/cardsPlayer.tsx` | 247 |
| `src/components/ShareProfileSheet.tsx` | 240 |
| `src/components/StoryReportModal.tsx` | 239 |
| `src/components/AppleSignInButton.tsx` | 233 |
| `src/components/WaveVisualizer.tsx` | 233 |
| `src/components/__tests__/WaveformScrubber.test.ts` | 217 |
| `src/components/PostReportModal.tsx` | 216 |
| `src/components/ExitFeedbackModal.tsx` | 214 |
| `src/components/CommentReportModal.tsx` | 211 |
| `src/components/AppUpdatePrompt.tsx` | 210 |
| `src/components/AddToAlbumSheet.tsx` | 205 |
| `src/components/ConfirmActionModal.tsx` | 205 |
| `src/components/ProfileBadges.tsx` | 203 |
| `src/components/SettingsRow.tsx` | 202 |
| `src/components/__tests__/SettingsRow.test.tsx` | 201 |
| `src/components/JamExitModal.tsx` | 199 |
| `src/components/GradientBorder.tsx` | 198 |
| `src/components/SettingsProfileCard.tsx` | 189 |
| `src/components/PlaylistCoverPicker.tsx` | 186 |
| `src/components/FriendPickerStrip.tsx` | 184 |
| `src/components/ChatReplySnippet.tsx` | 179 |
| `src/components/NotificationPermissionModal.tsx` | 179 |
| `src/components/SwipeReplyRow.tsx` | 175 |
| `src/components/ProfileLinkCard.tsx` | 173 |
| `src/components/__tests__/ChatSongPicker.test.tsx` | 173 |
| `src/components/GroupAvatarCluster.tsx` | 170 |
| `src/components/TagInput.tsx` | 167 |
| `src/components/MentionSuggestions.tsx` | 166 |
| `src/components/RemovedContentCard.tsx` | 165 |
| `src/components/__tests__/ProfileBadges.test.tsx` | 159 |
| `src/components/guide/cards.ts` | 159 |
| `src/components/ProfileTabBar.tsx` | 158 |
| `src/components/TabAvatar.tsx` | 155 |
| `src/components/ErrorBoundary.tsx` | 153 |
| `src/components/__tests__/OnboardingNotice.test.tsx` | 153 |
| `src/components/__tests__/AppUpdatePrompt.test.tsx` | 151 |
| `src/components/onboarding/StageLamp.tsx` | 151 |
| `src/components/__tests__/AppleSignInButton.test.tsx` | 148 |
| `src/components/guide/cardWelcome.tsx` | 148 |
| `src/components/ChatSongCard.tsx` | 146 |
| `src/components/__tests__/GradientBorder.test.tsx` | 145 |
| `src/components/StoryCard.tsx` | 132 |
| `src/components/onboarding/HoloShimmer.tsx` | 130 |
| `src/components/SettingsHighlightCard.tsx` | 124 |
| `src/components/ProfilePhotoViewer.tsx` | 120 |
| `src/components/ProfileGridCard.tsx` | 118 |
| `src/components/SpotifyTrackSheet.tsx` | 117 |
| `src/components/ArtGlow.tsx` | 116 |
| `src/components/__tests__/ProfileTabBar.test.tsx` | 114 |
| `src/components/guide/__tests__/timeline.test.ts` | 112 |
| `src/components/__tests__/RealtimeConnectionGate.test.tsx` | 110 |
| `src/components/Choice.tsx` | 108 |
| `src/components/AddBadge.tsx` | 102 |
| `src/components/NowPlayingPill.tsx` | 100 |
| `src/components/ProgressiveImage.tsx` | 99 |
| `src/components/LikedByLine.tsx` | 98 |
| `src/components/HomeFeedTabs.tsx` | 95 |
| `src/components/SettingsSection.tsx` | 93 |
| `src/components/DetailActionSheet.tsx` | 92 |
| `src/components/EqualizerBars.tsx` | 89 |
| `src/components/MutualsLine.tsx` | 87 |
| `src/components/RealtimeConnectionGate.tsx` | 87 |
| `src/components/Scrim.tsx` | 83 |
| `src/components/SpotifyChatCard.tsx` | 82 |
| `src/components/SpotifyLogo.tsx` | 81 |
| `src/components/onboarding/Crowd.tsx` | 81 |
| `src/components/PostCardSkeleton.tsx` | 79 |
| `src/components/UsernameBadges.tsx` | 78 |
| `src/components/__tests__/shareBadgeParity.test.ts` | 78 |
| `src/components/EmojiCoverArt.tsx` | 76 |
| `src/components/JamPillAvatar.tsx` | 76 |
| `src/components/GradientFill.tsx` | 74 |
| `src/components/SwipeRevealRow.tsx` | 74 |
| `src/components/FeedEndMessage.tsx` | 73 |
| `src/components/ScrubTimeLabel.tsx` | 73 |
| `src/components/FormInput.tsx` | 69 |
| `src/components/onboarding/StripedFill.tsx` | 69 |
| `src/components/VisibilitySelector.tsx` | 68 |
| `src/components/__tests__/CollabAvatar.test.tsx` | 67 |
| `src/components/SettingsHeader.tsx` | 66 |
| `src/components/onboarding/ScreenBackdrop.tsx` | 65 |
| `src/components/__tests__/ChatReplySnippet.test.tsx` | 64 |
| `src/components/FirstHundredBadge.tsx` | 63 |
| `src/components/__tests__/ConfirmActionModal.test.tsx` | 63 |
| `src/components/CoverFallback.tsx` | 62 |
| `src/components/guide/timeline.ts` | 60 |
| `src/components/VerifiedBadge.tsx` | 58 |
| `src/components/__tests__/amplitudeBars.test.ts` | 57 |
| `src/components/CollabAvatar.tsx` | 55 |
| `src/components/ListeningStatusReporter.tsx` | 48 |
| `src/components/GoogleGlyph.tsx` | 46 |
| `src/components/__tests__/HomeFeedTabs.test.tsx` | 43 |
| `src/components/__tests__/UsernameBadges.integration.test.tsx` | 43 |
| `src/components/onboarding/Barcode.tsx` | 41 |
| `src/components/__tests__/SpotifyLogo.test.ts` | 39 |
| `src/components/ChatTimeSeparator.tsx` | 31 |
| `src/components/spotifyLogoArtwork.ts` | 31 |
| `src/components/badgeShapes.ts` | 24 |
| `src/components/Logo.tsx` | 22 |

## Services

72 file(s), 14,411 lines.

| File | Lines |
|---|---:|
| `src/services/posts.ts` | 1257 |
| `src/services/tracks.ts` | 1001 |
| `src/services/pushNotifications.ts` | 807 |
| `src/services/albums.ts` | 518 |
| `src/services/profileService.ts` | 487 |
| `src/services/share.ts` | 484 |
| `src/services/activity.ts` | 461 |
| `src/services/comments.ts` | 383 |
| `src/services/playlists.ts` | 382 |
| `src/services/messages.ts` | 381 |
| `src/services/jamRooms.ts` | 368 |
| `src/services/spotify.ts` | 347 |
| `src/services/uploads.ts` | 301 |
| `src/services/jamRealtime.ts` | 277 |
| `src/services/relationships.ts` | 273 |
| `src/services/conversations.ts` | 249 |
| `src/services/__tests__/publishTrackCredits.test.ts` | 235 |
| `src/services/__tests__/pushScheduled.test.ts` | 230 |
| `src/services/__tests__/deleteMyAccount.test.ts` | 229 |
| `src/services/listeningStatus.ts` | 223 |
| `src/services/__tests__/authorMapping.test.ts` | 221 |
| `src/services/stories.ts` | 215 |
| `src/services/__tests__/copyrightDeclaration.test.ts` | 205 |
| `src/services/__tests__/spotify.test.ts` | 201 |
| `src/services/__tests__/tags.test.ts` | 180 |
| `src/services/__tests__/appBadge.test.ts` | 177 |
| `src/services/__tests__/publishTrackGate.test.ts` | 175 |
| `src/services/__tests__/waveform.test.ts` | 173 |
| `src/services/__tests__/lyrics.test.ts` | 167 |
| `src/services/__tests__/waveformDsp.test.ts` | 166 |
| `src/services/appBadge.ts` | 166 |
| `src/services/__tests__/publishTrackCleanup.test.ts` | 159 |
| `src/services/__tests__/uploadStallWatchdog.test.ts` | 149 |
| `src/services/__tests__/fetchHomeFeedPage.test.ts` | 144 |
| `src/services/__tests__/appUpdate.test.ts` | 141 |
| `src/services/jamSuggestions.ts` | 139 |
| `src/services/appleAuth.ts` | 131 |
| `src/services/__tests__/feedImpressions.test.ts` | 119 |
| `src/services/follows.ts` | 114 |
| `src/services/__tests__/profileBadges.test.ts` | 110 |
| `src/services/messageCache.ts` | 109 |
| `src/services/__tests__/shareNativeFallback.test.ts` | 104 |
| `src/services/feedImpressions.ts` | 100 |
| `src/services/mediaPicks.ts` | 93 |
| `src/services/appUpdate.ts` | 92 |
| `src/services/__tests__/activity.test.ts` | 91 |
| `src/services/__tests__/getBlockedChannelIds.test.ts` | 91 |
| `src/services/__tests__/pushLikeCard.test.ts` | 89 |
| `src/services/searchDiscover.ts` | 88 |
| `src/services/__tests__/pushOpenChat.test.ts` | 87 |
| `src/services/__tests__/teamMessages.test.ts` | 87 |
| `src/services/groupFaces.ts` | 86 |
| `src/services/__tests__/submitExitFeedback.test.ts` | 81 |
| `src/services/googleAuth.ts` | 79 |
| `src/services/__tests__/clearConversationNotifications.test.ts` | 78 |
| `src/services/__tests__/findMyActiveJam.test.ts` | 78 |
| `src/services/terms.ts` | 78 |
| `src/services/searchAnalytics.ts` | 72 |
| `src/services/profileBadges.ts` | 70 |
| `src/services/mutuals.ts` | 66 |
| `src/services/waveform.ts` | 66 |
| `src/services/__tests__/createTrackStreamingGrant.test.ts` | 64 |
| `src/services/activeConversation.ts` | 62 |
| `src/services/teamMessages.ts` | 57 |
| `src/services/__tests__/jamHeartbeat.test.ts` | 55 |
| `src/services/pushDispatch.ts` | 48 |
| `src/services/__tests__/activeConversation.test.ts` | 44 |
| `src/services/jamHeartbeat.ts` | 42 |
| `src/services/authSession.ts` | 36 |
| `src/services/friendActivity.ts` | 33 |
| `src/services/__tests__/activityMilestone.test.ts` | 25 |
| `src/services/uploadEvents.ts` | 15 |

## Contexts

13 file(s), 3,160 lines.

| File | Lines |
|---|---:|
| `src/contexts/PlaybackContext.tsx` | 1024 |
| `src/contexts/JamRealtimeContext.tsx` | 487 |
| `src/contexts/RelationshipContext.tsx` | 345 |
| `src/contexts/JamSuggestionsContext.tsx` | 200 |
| `src/contexts/ToastContext.tsx` | 190 |
| `src/contexts/ProfileBadgesContext.tsx` | 172 |
| `src/contexts/__tests__/ProfileBadgesContext.test.tsx` | 171 |
| `src/contexts/__tests__/PlaybackContext.clipSession.test.tsx` | 148 |
| `src/contexts/__tests__/PlaybackContext.jamListenerGuard.test.tsx` | 125 |
| `src/contexts/SwipeRevealContext.tsx` | 107 |
| `src/contexts/ChromeVisibilityContext.tsx` | 69 |
| `src/contexts/JamContext.tsx` | 68 |
| `src/contexts/StoriesContext.tsx` | 54 |

## Hooks

18 file(s), 1,303 lines.

| File | Lines |
|---|---:|
| `src/hooks/useHomeFeed.ts` | 173 |
| `src/hooks/__tests__/useHomeFeed.test.tsx` | 115 |
| `src/hooks/__tests__/useRunAfterDismiss.test.tsx` | 98 |
| `src/hooks/useListeningNow.ts` | 93 |
| `src/hooks/useRecentSearches.ts` | 85 |
| `src/hooks/useGroupFaces.ts` | 83 |
| `src/hooks/useNewOnLivilDot.ts` | 81 |
| `src/hooks/usePlayFullScreen.ts` | 80 |
| `src/hooks/__tests__/useNewOnLivilDot.test.tsx` | 78 |
| `src/hooks/useRecentSearchOpens.ts` | 60 |
| `src/hooks/useCommentsCountDeltas.ts` | 55 |
| `src/hooks/useTrackWaveform.ts` | 52 |
| `src/hooks/useRunAfterDismiss.ts` | 50 |
| `src/hooks/usePostLike.ts` | 49 |
| `src/hooks/usePlayRecentlyPlayed.ts` | 47 |
| `src/hooks/useOpenInSpotify.ts` | 39 |
| `src/hooks/useImageAspect.ts` | 37 |
| `src/hooks/useMyRepostsPublic.ts` | 28 |

## Utilities

47 file(s), 4,251 lines.

| File | Lines |
|---|---:|
| `src/utils/__tests__/playTracker.test.ts` | 226 |
| `src/utils/searchRanking.ts` | 219 |
| `src/utils/__tests__/searchRanking.test.ts` | 212 |
| `src/utils/haptics.ts` | 201 |
| `src/utils/__tests__/nowPlayingMetadata.test.ts` | 191 |
| `src/utils/__tests__/shareLinks.test.ts` | 186 |
| `src/utils/__tests__/groupStoriesByAuthor.test.ts` | 167 |
| `src/utils/__tests__/storyPlayback.test.ts` | 152 |
| `src/utils/shareLinks.ts` | 140 |
| `src/utils/groupFaces.ts` | 139 |
| `src/utils/__tests__/authorDisplay.test.ts` | 135 |
| `src/utils/groupStoriesByAuthor.ts` | 125 |
| `src/utils/__tests__/groupFaces.test.ts` | 124 |
| `src/utils/nowPlayingMetadata.ts` | 123 |
| `src/utils/mentions.ts` | 105 |
| `src/utils/__tests__/haptics.test.ts` | 101 |
| `src/utils/listeningStatus.ts` | 100 |
| `src/utils/storyPlayback.ts` | 98 |
| `src/utils/playTracker.ts` | 90 |
| `src/utils/__tests__/listeningStatus.test.ts` | 88 |
| `src/utils/spotifyLinks.ts` | 86 |
| `src/utils/__tests__/spotifyLinks.test.ts` | 84 |
| `src/utils/chatTime.ts` | 82 |
| `src/utils/__tests__/recentSearches.test.ts` | 78 |
| `src/utils/__tests__/chatTime.test.ts` | 73 |
| `src/utils/authorDisplay.ts` | 72 |
| `src/utils/recentSearches.ts` | 72 |
| `src/utils/errorMessages.ts` | 68 |
| `src/utils/__tests__/recentSearchOpens.test.ts` | 58 |
| `src/utils/__tests__/commentsDelta.test.ts` | 53 |
| `src/utils/recentSearchOpens.ts` | 52 |
| `src/utils/__tests__/homeTabsPin.test.ts` | 49 |
| `src/utils/mutualsText.ts` | 48 |
| `src/utils/__tests__/shareLinkGate.test.ts` | 47 |
| `src/utils/shareLinkGate.ts` | 44 |
| `src/utils/__tests__/mutualsText.test.ts` | 43 |
| `src/utils/commentsDelta.ts` | 40 |
| `src/utils/homeTabsPin.ts` | 39 |
| `src/utils/__tests__/retryOnce.test.ts` | 35 |
| `src/utils/__tests__/avoidRepeatTop.test.ts` | 31 |
| `src/utils/returningListener.ts` | 30 |
| `src/utils/__tests__/likeCount.test.ts` | 29 |
| `src/utils/__tests__/returningListener.test.ts` | 29 |
| `src/utils/__tests__/passwordPolicy.test.ts` | 27 |
| `src/utils/avoidRepeatTop.ts` | 23 |
| `src/utils/likeCount.ts` | 20 |
| `src/utils/retryOnce.ts` | 17 |

## Dependencies

Declared range versus what is actually installed. A drift here means a pinned
version is not the version running (Constitution P52).

| Package | Declared | Installed |
|---|---|---|
| `@invertase/react-native-apple-authentication` | `2.5.1` | 2.5.1 |
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
| `react-native-haptic-feedback` | `3.0.0` | 3.0.0 |
| `react-native-image-crop-picker` | `^0.51.1` | 0.51.1 |
| `react-native-keyboard-controller` | `^1.21.9` | 1.21.9 |
| `react-native-reanimated` | `^4.4.0` | 4.4.0 |
| `react-native-safe-area-context` | `^5.8.0` | 5.8.0 |
| `react-native-screens` | `^4.11.0` | **4.25.2** |
| `react-native-share` | `12.3.1` | 12.3.1 |
| `react-native-svg` | `15.15.5` | 15.15.5 |
| `react-native-url-polyfill` | `^3.0.0` | 3.0.0 |
| `react-native-video` | `6.19.2` | 6.19.2 |
| `react-native-view-shot` | `5.1.1` | 5.1.1 |
| `react-native-worklets` | `^0.9.0` | **0.9.1** |
| `text-encoding-polyfill` | `^0.6.7` | 0.6.7 |

*Bold = installed version differs from the floor of the declared range.*
