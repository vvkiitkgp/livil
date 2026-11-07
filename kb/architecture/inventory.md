---
tier: 1
owner: principal-client
consumers: [ALL]
last_verified: 2026-11-07
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

592 TypeScript file(s) under `src/`, 116,444 lines.

## Size hotspots

Files over 600 lines. Size is a proxy for tangled responsibility — when a unit
grows past comprehension its responsibilities have usually stopped being separable by
reading alone (Constitution P28).

| File | Lines |
|---|---:|
| `src/screens/main/ConversationScreen.tsx` | 3205 |
| `src/screens/main/UploadScreen.tsx` | 2594 |
| `src/components/FullScreenPlayer.tsx` | 2446 |
| `src/screens/main/StoryViewerScreen.tsx` | 1671 |
| `src/components/PostCard.tsx` | 1497 |
| `src/screens/main/UserProfileScreen.tsx` | 1475 |
| `src/screens/main/ProfileScreen.tsx` | 1468 |
| `src/screens/main/HomeScreen.tsx` | 1465 |
| `src/components/CommentsSheet.tsx` | 1180 |
| `src/components/WaveformScrubber.tsx` | 1158 |
| `src/screens/main/JamRoomScreen.tsx` | 1155 |
| `src/screens/studio/studioEngine.ts` | 1095 |
| `src/components/FloatingPlayer.tsx` | 1083 |
| `src/screens/main/SearchScreen.tsx` | 1046 |
| `src/screens/main/RepostScreen.tsx` | 1003 |
| `src/screens/auth/BackstagePassOnboarding.tsx` | 805 |
| `src/screens/main/EditProfileScreen.tsx` | 722 |
| `src/components/GlobalAudioPlayer.tsx` | 694 |
| `src/screens/main/InboxScreen.tsx` | 683 |
| `src/screens/studio/StudioScreen.tsx` | 673 |
| `src/screens/main/LibraryScreen.tsx` | 656 |
| `src/screens/main/SpotifyRepostScreen.tsx` | 626 |
| `src/screens/main/CollaboratorPickerScreen.tsx` | 609 |

> 23 file(s) over the threshold against **37 custom hook(s)** in `src/hooks/`. The ratio of large units to extracted
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
| `App` | `NavigatorScreenParams<AppTabParamList> | undefined` |
| `Upload` | `{ studio?: StudioMix` |
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
| `Conversation` | `{ conversationId: string` |
| `ChatMediaViewer` | `{ messages: ChatMessage[]` |
| `NewConversation` | `undefined` |
| `GroupInfo` | `{ conversationId: string }` |
| `FriendRequests` | `undefined` |
| `ActivityCenter` | `undefined` |
| `JamRoom` | `{ jamRoomId: string` |
| `Repost` | `{ originalPostId: string` |
| `AddToLivil` | `undefined` |
| `Studio` | `{ draftId?: string } | undefined` |
| `Drafts` | `undefined` |
| `SpotifyRepost` | `{ spotifyTrackId?: string` |
| `StoryViewer` | `{ clusters: { authorId: string` |
| `startAuthorIndex` | `number` |

## Screens

75 file(s), 35,029 lines.

| File | Lines |
|---|---:|
| `src/screens/main/ConversationScreen.tsx` | 3205 |
| `src/screens/main/UploadScreen.tsx` | 2594 |
| `src/screens/main/StoryViewerScreen.tsx` | 1671 |
| `src/screens/main/UserProfileScreen.tsx` | 1475 |
| `src/screens/main/ProfileScreen.tsx` | 1468 |
| `src/screens/main/HomeScreen.tsx` | 1465 |
| `src/screens/main/JamRoomScreen.tsx` | 1155 |
| `src/screens/studio/studioEngine.ts` | 1095 |
| `src/screens/main/SearchScreen.tsx` | 1046 |
| `src/screens/main/RepostScreen.tsx` | 1003 |
| `src/screens/auth/BackstagePassOnboarding.tsx` | 805 |
| `src/screens/main/EditProfileScreen.tsx` | 722 |
| `src/screens/main/InboxScreen.tsx` | 683 |
| `src/screens/studio/StudioScreen.tsx` | 673 |
| `src/screens/main/LibraryScreen.tsx` | 656 |
| `src/screens/main/SpotifyRepostScreen.tsx` | 626 |
| `src/screens/main/CollaboratorPickerScreen.tsx` | 609 |
| `src/screens/main/GroupInfoScreen.tsx` | 600 |
| `src/screens/main/ChatMediaViewerScreen.tsx` | 597 |
| `src/screens/main/NewConversationScreen.tsx` | 479 |
| `src/screens/main/ActivityCenterScreen.tsx` | 413 |
| `src/screens/main/CreatePlaylistScreen.tsx` | 404 |
| `src/screens/main/EditAlbumScreen.tsx` | 403 |
| `src/screens/studio/RecordPanel.tsx` | 391 |
| `src/screens/studio/TunePanel.tsx` | 382 |
| `src/screens/studio/EditorPanel.tsx` | 381 |
| `src/screens/auth/SignInScreen.tsx` | 379 |
| `src/screens/main/PrivacyDataScreen.tsx` | 359 |
| `src/screens/main/EditPlaylistScreen.tsx` | 336 |
| `src/screens/main/__tests__/SearchScreen.test.tsx` | 324 |
| `src/screens/main/__tests__/PrivacyDataScreen.test.tsx` | 322 |
| `src/screens/auth/FirstRunGuideScreen.tsx` | 307 |
| `src/screens/studio/SynthSheet.tsx` | 306 |
| `src/screens/main/NotificationSettingsScreen.tsx` | 299 |
| `src/screens/main/ProfilePeopleScreen.tsx` | 292 |
| `src/screens/auth/SignUpScreen.tsx` | 290 |
| `src/screens/main/SettingsScreen.tsx` | 290 |
| `src/screens/auth/AddPhotoScreen.tsx` | 273 |
| `src/screens/main/ContactTeamScreen.tsx` | 272 |
| `src/screens/main/PlaylistScreen.tsx` | 269 |
| `src/screens/main/__tests__/NotificationSettingsScreen.test.tsx` | 269 |
| `src/screens/main/RecentlyPlayedScreen.tsx` | 261 |
| `src/screens/main/DeleteAccountScreen.tsx` | 259 |
| `src/screens/studio/draftFormat.ts` | 235 |
| `src/screens/main/CreateAlbumScreen.tsx` | 234 |
| `src/screens/main/FollowingScreen.tsx` | 231 |
| `src/screens/auth/ChooseUsernameScreen.tsx` | 227 |
| `src/screens/main/__tests__/SettingsScreen.test.tsx` | 227 |
| `src/screens/studio/FinalPanel.tsx` | 226 |
| `src/screens/main/FriendRequestsScreen.tsx` | 223 |
| `src/screens/auth/ForgotPasswordScreen.tsx` | 218 |
| `src/screens/studio/BeatsSheet.tsx` | 210 |
| `src/screens/main/PostDetailScreen.tsx` | 208 |
| `src/screens/main/BlockedAccountsScreen.tsx` | 204 |
| `src/screens/main/AlbumDetailScreen.tsx` | 202 |
| `src/screens/studio/ClipTrack.tsx` | 188 |
| `src/screens/main/__tests__/DeleteAccountScreen.test.tsx` | 185 |
| `src/screens/auth/ResetPasswordScreen.tsx` | 181 |
| `src/screens/auth/TermsAcceptScreen.tsx` | 175 |
| `src/screens/auth/OnboardingScreen.tsx` | 168 |
| `src/screens/main/AddToLivilScreen.tsx` | 163 |
| `src/screens/studio/EffectsSheet.tsx` | 151 |
| `src/screens/studio/renderMix.ts` | 150 |
| `src/screens/studio/MicPicker.tsx` | 114 |
| `src/screens/studio/PitchTrail.tsx` | 112 |
| `src/screens/studio/StudioLoading.tsx` | 99 |
| `src/screens/studio/SongTrim.tsx` | 91 |
| `src/screens/studio/BpmStepper.tsx` | 90 |
| `src/screens/studio/finishTake.ts` | 83 |
| `src/screens/studio/StudioSlider.tsx` | 78 |
| `src/screens/studio/TimeRuler.tsx` | 73 |
| `src/screens/studio/DraftsScreen.tsx` | 62 |
| `src/screens/studio/__tests__/engineToggle.test.ts` | 49 |
| `src/screens/studio/MagicButton.tsx` | 39 |
| `src/screens/studio/timeline.ts` | 25 |

## Components

187 file(s), 36,405 lines.

| File | Lines |
|---|---:|
| `src/components/FullScreenPlayer.tsx` | 2446 |
| `src/components/PostCard.tsx` | 1497 |
| `src/components/CommentsSheet.tsx` | 1180 |
| `src/components/WaveformScrubber.tsx` | 1158 |
| `src/components/FloatingPlayer.tsx` | 1083 |
| `src/components/GlobalAudioPlayer.tsx` | 694 |
| `src/components/SheetModal.tsx` | 570 |
| `src/components/guide/PickThree.tsx` | 483 |
| `src/components/MediaPlayer.tsx` | 468 |
| `src/components/SpotifyPostCard.tsx` | 438 |
| `src/components/QueueList.tsx` | 425 |
| `src/components/ChatSongPicker.tsx` | 421 |
| `src/components/DetailView.tsx` | 411 |
| `src/components/onboarding/BackstagePass.tsx` | 400 |
| `src/components/AddUserSheet.tsx` | 392 |
| `src/components/Icon.tsx` | 374 |
| `src/components/SharePostSheet.tsx` | 372 |
| `src/components/CopyrightMatchModal.tsx` | 370 |
| `src/components/PostGridCard.tsx` | 362 |
| `src/components/PostLikersSheet.tsx` | 330 |
| `src/components/ActivityBubble.tsx` | 324 |
| `src/components/CommentItem.tsx` | 321 |
| `src/components/guide/primitives.tsx` | 319 |
| `src/components/TrackContextMenu.tsx` | 307 |
| `src/components/MessageMenu.tsx` | 305 |
| `src/components/__tests__/PostGridCard.test.tsx` | 305 |
| `src/components/JamSuggestsTab.tsx` | 303 |
| `src/components/ChatSongCard.tsx` | 290 |
| `src/components/Button.tsx` | 286 |
| `src/components/InboxBanner.tsx` | 283 |
| `src/components/TagInput.tsx` | 278 |
| `src/components/OnboardingNotice.tsx` | 276 |
| `src/components/guide/cardsPeople.tsx` | 272 |
| `src/components/__tests__/RealtimeConnectionGate.test.tsx` | 258 |
| `src/components/ConfirmActionModal.tsx` | 247 |
| `src/components/__tests__/SpotifyClipboardPrompt.test.tsx` | 246 |
| `src/components/CommentSongCard.tsx` | 241 |
| `src/components/ShareProfileSheet.tsx` | 240 |
| `src/components/StoryReportModal.tsx` | 239 |
| `src/components/AppleSignInButton.tsx` | 233 |
| `src/components/WaveVisualizer.tsx` | 233 |
| `src/components/RepostChatCard.tsx` | 228 |
| `src/components/__tests__/MentionText.test.tsx` | 218 |
| `src/components/PostReportModal.tsx` | 217 |
| `src/components/__tests__/WaveformScrubber.test.ts` | 217 |
| `src/components/GifPicker.tsx` | 216 |
| `src/components/ExitFeedbackModal.tsx` | 214 |
| `src/components/guide/cardsPlayer.tsx` | 212 |
| `src/components/CommentReportModal.tsx` | 211 |
| `src/components/__tests__/GifPicker.test.tsx` | 211 |
| `src/components/AppUpdatePrompt.tsx` | 210 |
| `src/components/MentionSuggestions.tsx` | 206 |
| `src/components/AddToAlbumSheet.tsx` | 205 |
| `src/components/FriendPickerStrip.tsx` | 204 |
| `src/components/ProfileBadges.tsx` | 203 |
| `src/components/SettingsRow.tsx` | 202 |
| `src/components/SpotifyClipboardPrompt.tsx` | 201 |
| `src/components/__tests__/SettingsRow.test.tsx` | 201 |
| `src/components/GradientBorder.tsx` | 198 |
| `src/components/ReactionEmojiSheet.tsx` | 196 |
| `src/components/auth/AuthStep.tsx` | 195 |
| `src/components/MentionText.tsx` | 191 |
| `src/components/__tests__/GlobalAudioPlayer.loadError.test.tsx` | 191 |
| `src/components/ChatReplySnippet.tsx` | 190 |
| `src/components/SettingsProfileCard.tsx` | 189 |
| `src/components/PlaylistCoverPicker.tsx` | 186 |
| `src/components/__tests__/ChatSongPicker.test.tsx` | 186 |
| `src/components/UploadPreviewCard.tsx` | 180 |
| `src/components/__tests__/GlobalAudioPlayer.iosEnd.test.tsx` | 180 |
| `src/components/ProfileTabBar.tsx` | 179 |
| `src/components/SwipeReplyRow.tsx` | 175 |
| `src/components/ProfileLinkCard.tsx` | 173 |
| `src/components/RolePicker.tsx` | 172 |
| `src/components/GroupAvatarCluster.tsx` | 170 |
| `src/components/__tests__/OnboardingNotice.test.tsx` | 170 |
| `src/components/guide/__tests__/pickSongs.test.ts` | 170 |
| `src/components/guide/pickSongs.ts` | 167 |
| `src/components/FullScreenFrame.tsx` | 166 |
| `src/components/RemovedContentCard.tsx` | 165 |
| `src/components/__tests__/ProfileBadges.test.tsx` | 159 |
| `src/components/ErrorBoundary.tsx` | 154 |
| `src/components/NotificationNudge.tsx` | 154 |
| `src/components/TabAvatar.tsx` | 154 |
| `src/components/__tests__/AppUpdatePrompt.test.tsx` | 151 |
| `src/components/__tests__/CommentSongCard.test.tsx` | 151 |
| `src/components/onboarding/StageLamp.tsx` | 151 |
| `src/components/ChatMediaBubble.tsx` | 150 |
| `src/components/JamExitModal.tsx` | 150 |
| `src/components/__tests__/AppleSignInButton.test.tsx` | 148 |
| `src/components/guide/cardWelcome.tsx` | 148 |
| `src/components/__tests__/GradientBorder.test.tsx` | 145 |
| `src/components/NotificationPermissionModal.tsx` | 140 |
| `src/components/ShareRepostSheet.tsx` | 140 |
| `src/components/StoryCard.tsx` | 132 |
| `src/components/UploadStep.tsx` | 131 |
| `src/components/onboarding/HoloShimmer.tsx` | 130 |
| `src/components/PlayerCloseTarget.tsx` | 129 |
| `src/components/__tests__/ProfileTabBar.test.tsx` | 129 |
| `src/components/DoubleTapLike.tsx` | 127 |
| `src/components/OfflineBanner.tsx` | 127 |
| `src/components/HomeFeedTabs.tsx` | 125 |
| `src/components/SettingsHighlightCard.tsx` | 124 |
| `src/components/__tests__/FloatingPlayer.slideOut.test.tsx` | 122 |
| `src/components/__tests__/PlayerCloseTarget.test.tsx` | 121 |
| `src/components/ProfilePhotoViewer.tsx` | 120 |
| `src/components/ProfileGridCard.tsx` | 118 |
| `src/components/SpotifyTrackSheet.tsx` | 117 |
| `src/components/ArtGlow.tsx` | 116 |
| `src/components/__tests__/MessageMenu.test.tsx` | 114 |
| `src/components/DraftsList.tsx` | 111 |
| `src/components/guide/__tests__/timeline.test.ts` | 109 |
| `src/components/Choice.tsx` | 108 |
| `src/components/FormInput.tsx` | 107 |
| `src/components/LikedByLine.tsx` | 102 |
| `src/components/__tests__/NotificationNudge.test.tsx` | 102 |
| `src/components/NowPlayingPill.tsx` | 100 |
| `src/components/__tests__/ChatGifPicker.test.tsx` | 100 |
| `src/components/__tests__/CommentGifCard.test.tsx` | 100 |
| `src/components/guide/cards.ts` | 100 |
| `src/components/AddBadge.tsx` | 99 |
| `src/components/ProgressiveImage.tsx` | 99 |
| `src/components/CommentGifCard.tsx` | 98 |
| `src/components/ChatMediaSourceSheet.tsx` | 96 |
| `src/components/ChatMediaPreview.tsx` | 94 |
| `src/components/SettingsSection.tsx` | 93 |
| `src/components/DetailActionSheet.tsx` | 92 |
| `src/components/EqualizerBars.tsx` | 89 |
| `src/components/auth/usernameCheck.tsx` | 89 |
| `src/components/MutualsLine.tsx` | 87 |
| `src/components/Scrim.tsx` | 83 |
| `src/components/__tests__/ConfirmActionModal.test.tsx` | 83 |
| `src/components/SpotifyChatCard.tsx` | 82 |
| `src/components/SpotifyLogo.tsx` | 82 |
| `src/components/__tests__/ChatReplySnippet.test.tsx` | 82 |
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
| `src/components/__tests__/HomeFeedTabs.test.tsx` | 72 |
| `src/components/ProfileLayoutToggle.tsx` | 71 |
| `src/components/__tests__/MusicScoreTag.test.tsx` | 70 |
| `src/components/__tests__/OfflineBanner.test.tsx` | 70 |
| `src/components/onboarding/StripedFill.tsx` | 69 |
| `src/components/VisibilitySelector.tsx` | 68 |
| `src/components/ChatGifPicker.tsx` | 67 |
| `src/components/__tests__/CollabAvatar.test.tsx` | 67 |
| `src/components/SettingsHeader.tsx` | 66 |
| `src/components/onboarding/ScreenBackdrop.tsx` | 65 |
| `src/components/RealtimeConnectionGate.tsx` | 64 |
| `src/components/FirstHundredBadge.tsx` | 63 |
| `src/components/CoverFallback.tsx` | 62 |
| `src/components/RoundTickButton.tsx` | 61 |
| `src/components/guide/timeline.ts` | 60 |
| `src/components/VerifiedBadge.tsx` | 58 |
| `src/components/__tests__/TabBarBackground.test.tsx` | 57 |
| `src/components/__tests__/amplitudeBars.test.ts` | 57 |
| `src/components/CollabAvatar.tsx` | 55 |
| `src/components/LikeHeart.tsx` | 52 |
| `src/components/ListeningStatusReporter.tsx` | 48 |
| `src/components/__tests__/FormInput.test.tsx` | 47 |
| `src/components/GoogleGlyph.tsx` | 46 |
| `src/components/TabBarBackground.tsx` | 45 |
| `src/components/MusicScoreTag.tsx` | 43 |
| `src/components/StatusBarFade.tsx` | 43 |
| `src/components/__tests__/UsernameBadges.integration.test.tsx` | 43 |
| `src/components/__tests__/VibeTag.test.tsx` | 42 |
| `src/components/auth/__tests__/signUpSteps.test.ts` | 42 |
| `src/components/TopBarBackground.tsx` | 41 |
| `src/components/onboarding/Barcode.tsx` | 41 |
| `src/components/VibeTag.tsx` | 40 |
| `src/components/MessagesTabIcon.tsx` | 39 |
| `src/components/__tests__/SpotifyLogo.test.ts` | 39 |
| `src/components/GlassBackdrop.tsx` | 38 |
| `src/components/LivilBotAvatar.tsx` | 36 |
| `src/components/__tests__/RoundTickButton.test.tsx` | 33 |
| `src/components/ChatTimeSeparator.tsx` | 31 |
| `src/components/spotifyLogoArtwork.ts` | 31 |
| `src/components/auth/signUpSteps.ts` | 28 |
| `src/components/badgeShapes.ts` | 24 |
| `src/components/Logo.tsx` | 22 |
| `src/components/iosGlass.ts` | 18 |

## Services

126 file(s), 23,930 lines.

| File | Lines |
|---|---:|
| `src/services/tracks.ts` | 1639 |
| `src/services/posts.ts` | 1364 |
| `src/services/pushNotifications.ts` | 988 |
| `src/services/activity.ts` | 715 |
| `src/services/chatMedia.ts` | 630 |
| `src/services/comments.ts` | 620 |
| `src/services/share.ts` | 551 |
| `src/services/albums.ts` | 523 |
| `src/services/spotify.ts` | 514 |
| `src/services/profileService.ts` | 511 |
| `src/services/messages.ts` | 482 |
| `src/services/uploads.ts` | 462 |
| `src/services/__tests__/spotify.test.ts` | 433 |
| `src/services/__tests__/stagedUpload.test.ts` | 408 |
| `src/services/playlists.ts` | 390 |
| `src/services/jamRooms.ts` | 368 |
| `src/services/conversations.ts` | 360 |
| `src/services/__tests__/uploadStallWatchdog.test.ts` | 317 |
| `src/services/drafts.ts` | 299 |
| `src/services/jamRealtime.ts` | 298 |
| `src/services/relationships.ts` | 275 |
| `src/services/gifs.ts` | 245 |
| `src/services/listeningStatus.ts` | 236 |
| `src/services/__tests__/publishTrackCredits.test.ts` | 235 |
| `src/services/__tests__/uploadNetworkSteps.test.ts` | 232 |
| `src/services/__tests__/commentSongs.test.ts` | 230 |
| `src/services/__tests__/pushScheduled.test.ts` | 230 |
| `src/services/__tests__/deleteMyAccount.test.ts` | 229 |
| `src/services/__tests__/uploadContentType.test.ts` | 227 |
| `src/services/__tests__/clipboard.test.ts` | 223 |
| `src/services/__tests__/authorMapping.test.ts` | 221 |
| `src/services/spotifyReturnNudge.ts` | 215 |
| `src/services/stories.ts` | 215 |
| `src/services/__tests__/commentGifs.test.ts` | 213 |
| `src/services/__tests__/waveform.test.ts` | 212 |
| `src/services/__tests__/chatMediaBackground.test.ts` | 205 |
| `src/services/__tests__/copyrightDeclaration.test.ts` | 205 |
| `src/services/__tests__/spotifyReturnNudge.test.ts` | 203 |
| `src/services/mediaPicks.ts` | 183 |
| `src/services/__tests__/tags.test.ts` | 180 |
| `src/services/__tests__/gifs.test.ts` | 178 |
| `src/services/__tests__/appBadge.test.ts` | 177 |
| `src/services/__tests__/publishTrackGate.test.ts` | 175 |
| `src/services/__tests__/activity.test.ts` | 173 |
| `src/services/__tests__/commentNotifications.test.ts` | 173 |
| `src/services/__tests__/pushNotificationPress.test.ts` | 172 |
| `src/services/__tests__/lyrics.test.ts` | 167 |
| `src/services/__tests__/waveformDsp.test.ts` | 166 |
| `src/services/appBadge.ts` | 165 |
| `src/services/__tests__/publishTrackCleanup.test.ts` | 159 |
| `src/services/__tests__/uploadDrafts.test.ts` | 154 |
| `src/services/clipboard.ts` | 154 |
| `src/services/__tests__/fetchHomeFeedPage.test.ts` | 144 |
| `src/services/__tests__/appUpdate.test.ts` | 141 |
| `src/services/jamSuggestions.ts` | 139 |
| `src/services/appleAuth.ts` | 131 |
| `src/services/__tests__/conversationsDelivered.test.ts` | 127 |
| `src/services/__tests__/sweepAbandonedUploads.test.ts` | 127 |
| `src/services/__tests__/feedImpressions.test.ts` | 119 |
| `src/services/__tests__/originalLikes.test.ts` | 117 |
| `src/services/__tests__/recentlyPlayed.test.ts` | 116 |
| `src/services/messageCache.ts` | 116 |
| `src/services/__tests__/commentNotifyCalls.test.ts` | 115 |
| `src/services/follows.ts` | 114 |
| `src/services/__tests__/profileBadges.test.ts` | 110 |
| `src/services/__tests__/pushRegistration.test.ts` | 110 |
| `src/services/__tests__/pushLikeCard.test.ts` | 109 |
| `src/services/network.ts` | 107 |
| `src/services/__tests__/chatMediaSaveNotify.test.ts` | 105 |
| `src/services/__tests__/shareNativeFallback.test.ts` | 104 |
| `src/services/__tests__/fetchMessagesDeleted.test.ts` | 101 |
| `src/services/feedImpressions.ts` | 100 |
| `src/services/__tests__/network.test.ts` | 98 |
| `src/services/crashReporting.ts` | 93 |
| `src/services/appUpdate.ts` | 92 |
| `src/services/recentlyPlayed.ts` | 92 |
| `src/services/__tests__/getBlockedChannelIds.test.ts` | 91 |
| `src/services/waveform.ts` | 89 |
| `src/services/searchDiscover.ts` | 88 |
| `src/services/__tests__/mentionNotifications.test.ts` | 87 |
| `src/services/__tests__/pushOpenChat.test.ts` | 87 |
| `src/services/__tests__/teamMessages.test.ts` | 87 |
| `src/services/__tests__/crashReporting.test.ts` | 86 |
| `src/services/groupFaces.ts` | 86 |
| `src/services/__tests__/session.test.ts` | 84 |
| `src/services/__tests__/submitExitFeedback.test.ts` | 81 |
| `src/services/__tests__/fetchMessagesByIds.test.ts` | 80 |
| `src/services/googleAuth.ts` | 79 |
| `src/services/__tests__/clearConversationNotifications.test.ts` | 78 |
| `src/services/__tests__/findMyActiveJam.test.ts` | 78 |
| `src/services/studioFiles.ts` | 78 |
| `src/services/terms.ts` | 78 |
| `src/services/__tests__/likedPosts.test.ts` | 74 |
| `src/services/__tests__/authStorage.test.ts` | 72 |
| `src/services/searchAnalytics.ts` | 72 |
| `src/services/profileBadges.ts` | 70 |
| `src/services/__tests__/createTrackStreamingGrant.test.ts` | 67 |
| `src/services/__tests__/sharedRepostAuthor.test.ts` | 66 |
| `src/services/mutuals.ts` | 66 |
| `src/services/session.ts` | 66 |
| `src/services/activeConversation.ts` | 62 |
| `src/services/__tests__/waveformLosslessGuard.test.ts` | 59 |
| `src/services/__tests__/chatGifMessage.test.ts` | 57 |
| `src/services/teamMessages.ts` | 57 |
| `src/services/__tests__/likePost.test.ts` | 56 |
| `src/services/__tests__/scanUploadRequest.test.ts` | 56 |
| `src/services/__tests__/jamHeartbeat.test.ts` | 55 |
| `src/services/__tests__/trackPlaysTotals.test.ts` | 52 |
| `src/services/pushDispatch.ts` | 51 |
| `src/services/chatVibes.ts` | 49 |
| `src/services/__tests__/activeConversation.test.ts` | 44 |
| `src/services/musicScore.ts` | 43 |
| `src/services/jamHeartbeat.ts` | 42 |
| `src/services/__tests__/recentReactions.test.ts` | 39 |
| `src/services/authSession.ts` | 36 |
| `src/services/friendActivity.ts` | 33 |
| `src/services/blurSnapshot.ts` | 29 |
| `src/services/recentReactions.ts` | 28 |
| `src/services/__tests__/blurSnapshot.test.ts` | 27 |
| `src/services/livilLinks.ts` | 27 |
| `src/services/__tests__/activityMilestone.test.ts` | 25 |
| `src/services/authStorage.ts` | 24 |
| `src/services/__tests__/isUploadedAvatar.test.ts` | 16 |
| `src/services/__tests__/postEvents.test.ts` | 16 |
| `src/services/postEvents.ts` | 16 |
| `src/services/uploadEvents.ts` | 15 |

## Contexts

18 file(s), 4,293 lines.

| File | Lines |
|---|---:|
| `src/contexts/PlaybackContext.tsx` | 1058 |
| `src/contexts/__tests__/UnreadBadgeContext.test.tsx` | 489 |
| `src/contexts/JamRealtimeContext.tsx` | 487 |
| `src/contexts/RelationshipContext.tsx` | 381 |
| `src/contexts/ToastContext.tsx` | 204 |
| `src/contexts/JamSuggestionsContext.tsx` | 200 |
| `src/contexts/UnreadBadgeContext.tsx` | 194 |
| `src/contexts/ProfileBadgesContext.tsx` | 172 |
| `src/contexts/__tests__/ProfileBadgesContext.test.tsx` | 171 |
| `src/contexts/__tests__/RelationshipContext.test.tsx` | 163 |
| `src/contexts/__tests__/PlaybackContext.clipSession.test.tsx` | 148 |
| `src/contexts/__tests__/PlaybackContext.closePlayer.test.tsx` | 125 |
| `src/contexts/__tests__/PlaybackContext.jamListenerGuard.test.tsx` | 125 |
| `src/contexts/SwipeRevealContext.tsx` | 107 |
| `src/contexts/__tests__/ToastContext.test.tsx` | 78 |
| `src/contexts/ChromeVisibilityContext.tsx` | 69 |
| `src/contexts/JamContext.tsx` | 68 |
| `src/contexts/StoriesContext.tsx` | 54 |

## Hooks

37 file(s), 2,456 lines.

| File | Lines |
|---|---:|
| `src/hooks/useHomeFeed.ts` | 173 |
| `src/hooks/__tests__/useHomeFeed.test.tsx` | 115 |
| `src/hooks/useListeningNow.ts` | 115 |
| `src/hooks/__tests__/usePostLike.test.tsx` | 106 |
| `src/hooks/__tests__/useListeningNow.test.tsx` | 98 |
| `src/hooks/__tests__/useRunAfterDismiss.test.tsx` | 98 |
| `src/hooks/useGroupFaces.ts` | 85 |
| `src/hooks/useRecentSearches.ts` | 85 |
| `src/hooks/__tests__/useOpenInSpotify.test.tsx` | 83 |
| `src/hooks/useNewOnLivilDot.ts` | 81 |
| `src/hooks/usePlayFullScreen.ts` | 80 |
| `src/hooks/useSwitchFade.ts` | 80 |
| `src/hooks/__tests__/useNewOnLivilDot.test.tsx` | 78 |
| `src/hooks/usePostLike.ts` | 77 |
| `src/hooks/useCommentsCountDeltas.ts` | 69 |
| `src/hooks/__tests__/useProfileTabCache.test.tsx` | 63 |
| `src/hooks/__tests__/useSwitchFade.test.tsx` | 63 |
| `src/hooks/useProfileTabCache.ts` | 63 |
| `src/hooks/usePinnedTabsScroll.ts` | 61 |
| `src/hooks/useOpenInSpotify.ts` | 60 |
| `src/hooks/useRecentSearchOpens.ts` | 60 |
| `src/hooks/useMentionInput.ts` | 59 |
| `src/hooks/usePlayRecentlyPlayed.ts` | 56 |
| `src/hooks/useTrackWaveform.ts` | 52 |
| `src/hooks/useRunAfterDismiss.ts` | 50 |
| `src/hooks/__tests__/useOriginalLikes.test.tsx` | 49 |
| `src/hooks/__tests__/useCommentsCountDeltas.test.tsx` | 48 |
| `src/hooks/__tests__/usePinnedTabsScroll.test.tsx` | 48 |
| `src/hooks/__tests__/useNowPlayingCommentsSync.test.tsx` | 45 |
| `src/hooks/__tests__/useProfileLayout.test.tsx` | 45 |
| `src/hooks/useImageAspect.ts` | 37 |
| `src/hooks/useProfileLayout.ts` | 35 |
| `src/hooks/useMyDrafts.ts` | 34 |
| `src/hooks/useTrackPlaysTotals.ts` | 30 |
| `src/hooks/useOpenMention.ts` | 27 |
| `src/hooks/useNowPlayingCommentsSync.ts` | 25 |
| `src/hooks/useOriginalLikes.ts` | 23 |

## Utilities

127 file(s), 11,766 lines.

| File | Lines |
|---|---:|
| `src/utils/audioFx/master.ts` | 447 |
| `src/utils/synth.ts` | 253 |
| `src/utils/audioFile/flac.ts` | 234 |
| `src/utils/__tests__/captionFit.test.ts` | 226 |
| `src/utils/__tests__/playTracker.test.ts` | 226 |
| `src/utils/searchRanking.ts` | 219 |
| `src/utils/captionFit.ts` | 217 |
| `src/utils/__tests__/searchRanking.test.ts` | 212 |
| `src/utils/haptics.ts` | 201 |
| `src/utils/__tests__/magicTune.test.ts` | 195 |
| `src/utils/__tests__/nowPlayingMetadata.test.ts` | 191 |
| `src/utils/audioClean/clickRepair.ts` | 190 |
| `src/utils/__tests__/shareLinks.test.ts` | 186 |
| `src/utils/chatLinks.ts` | 184 |
| `src/utils/audioClean/clickRemover.ts` | 173 |
| `src/utils/__tests__/drafts.test.ts` | 168 |
| `src/utils/__tests__/groupStoriesByAuthor.test.ts` | 167 |
| `src/utils/__tests__/chatLinks.test.ts` | 165 |
| `src/utils/emojiData.ts` | 162 |
| `src/utils/__tests__/storyPlayback.test.ts` | 152 |
| `src/utils/magicTune/pitch.ts` | 152 |
| `src/utils/__tests__/listeningStatus.test.ts` | 147 |
| `src/utils/listeningStatus.ts` | 147 |
| `src/utils/uploadRecovery.ts` | 145 |
| `src/utils/mentions.ts` | 141 |
| `src/utils/shareLinks.ts` | 140 |
| `src/utils/groupFaces.ts` | 139 |
| `src/utils/__tests__/uploadRecovery.test.ts` | 136 |
| `src/utils/__tests__/authorDisplay.test.ts` | 135 |
| `src/utils/chatMedia.ts` | 134 |
| `src/utils/drums.ts` | 134 |
| `src/utils/audioFx/level.ts` | 128 |
| `src/utils/groupStoriesByAuthor.ts` | 125 |
| `src/utils/__tests__/audioClean.test.ts` | 124 |
| `src/utils/__tests__/groupFaces.test.ts` | 124 |
| `src/utils/audioFx/effects.ts` | 123 |
| `src/utils/nowPlayingMetadata.ts` | 123 |
| `src/utils/magicTune/index.ts` | 121 |
| `src/utils/audioClean/denoise.ts` | 117 |
| `src/utils/chatTime.ts` | 115 |
| `src/utils/__tests__/spotifyLinks.test.ts` | 112 |
| `src/utils/__tests__/commentThread.test.ts` | 111 |
| `src/utils/__tests__/master.test.ts` | 108 |
| `src/utils/__tests__/audioFx.test.ts` | 105 |
| `src/utils/spotifyLinks.ts` | 105 |
| `src/utils/__tests__/haptics.test.ts` | 101 |
| `src/utils/__tests__/homeTabsPin.test.ts` | 101 |
| `src/utils/storyPlayback.ts` | 98 |
| `src/utils/__tests__/chatMedia.test.ts` | 96 |
| `src/utils/__tests__/chatTime.test.ts` | 95 |
| `src/utils/repostShare.ts` | 94 |
| `src/utils/activitySeen.ts` | 92 |
| `src/utils/commentThread.ts` | 91 |
| `src/utils/playTracker.ts` | 90 |
| `src/utils/__tests__/flac.test.ts` | 87 |
| `src/utils/magicTune/scale.ts` | 87 |
| `src/utils/__tests__/repostShare.test.ts` | 83 |
| `src/utils/audioClean/fft.ts` | 83 |
| `src/utils/likeStore.ts` | 82 |
| `src/utils/__tests__/activitySeen.test.ts` | 79 |
| `src/utils/__tests__/clickRepair.test.ts` | 78 |
| `src/utils/__tests__/recentSearches.test.ts` | 78 |
| `src/utils/__tests__/chatDelete.test.ts` | 76 |
| `src/utils/__tests__/commentsDelta.test.ts` | 76 |
| `src/utils/magicTune/psola.ts` | 76 |
| `src/utils/__tests__/playerCloseGesture.test.ts` | 75 |
| `src/utils/audioClean/breath.ts` | 74 |
| `src/utils/chatReceipts.ts` | 74 |
| `src/utils/homeTabsPin.ts` | 73 |
| `src/utils/authorDisplay.ts` | 72 |
| `src/utils/punycode.ts` | 72 |
| `src/utils/recentSearches.ts` | 72 |
| `src/utils/__tests__/chatOrder.test.ts` | 69 |
| `src/utils/playerCloseGesture.ts` | 69 |
| `src/utils/__tests__/likeStore.test.ts` | 68 |
| `src/utils/__tests__/synth.test.ts` | 68 |
| `src/utils/errorMessages.ts` | 68 |
| `src/utils/audioFile/wav.ts` | 66 |
| `src/utils/__tests__/mentions.test.ts` | 62 |
| `src/utils/chatOrder.ts` | 60 |
| `src/utils/__tests__/recentSearchOpens.test.ts` | 58 |
| `src/utils/commentsDelta.ts` | 58 |
| `src/utils/__tests__/inboxFilter.test.ts` | 56 |
| `src/utils/audioDevices.ts` | 56 |
| `src/utils/chatDelete.ts` | 55 |
| `src/utils/__tests__/chatReceipts.test.ts` | 52 |
| `src/utils/recentSearchOpens.ts` | 52 |
| `src/utils/__tests__/messageMenuLayout.test.ts` | 51 |
| `src/utils/messageMenuLayout.ts` | 49 |
| `src/utils/mutualsText.ts` | 48 |
| `src/utils/__tests__/shareLinkGate.test.ts` | 47 |
| `src/utils/serverClock.ts` | 45 |
| `src/utils/chatGif.ts` | 44 |
| `src/utils/shareLinkGate.ts` | 44 |
| `src/utils/zoomMath.ts` | 44 |
| `src/utils/__tests__/mutualsText.test.ts` | 43 |
| `src/utils/__tests__/chatCopy.test.ts` | 42 |
| `src/utils/__tests__/emojiData.test.ts` | 40 |
| `src/utils/inboxFilter.ts` | 39 |
| `src/utils/__tests__/friendOrder.test.ts` | 37 |
| `src/utils/__tests__/retryOnce.test.ts` | 35 |
| `src/utils/realtimeEpoch.ts` | 34 |
| `src/utils/__tests__/avoidRepeatTop.test.ts` | 31 |
| `src/utils/__tests__/zoomMath.test.ts` | 31 |
| `src/utils/__tests__/audioDevices.test.ts` | 30 |
| `src/utils/returningListener.ts` | 30 |
| `src/utils/__tests__/likeCount.test.ts` | 29 |
| `src/utils/__tests__/returningListener.test.ts` | 29 |
| `src/utils/__tests__/seenWhileAway.test.ts` | 29 |
| `src/utils/playbackErrors.ts` | 28 |
| `src/utils/__tests__/passwordPolicy.test.ts` | 27 |
| `src/utils/__tests__/swipeBack.test.ts` | 27 |
| `src/utils/audioClean/index.ts` | 27 |
| `src/utils/chatCopy.ts` | 26 |
| `src/utils/__tests__/chatGif.test.ts` | 25 |
| `src/utils/__tests__/likedBy.test.ts` | 25 |
| `src/utils/__tests__/commentTime.test.ts` | 23 |
| `src/utils/__tests__/playbackErrors.test.ts` | 23 |
| `src/utils/avoidRepeatTop.ts` | 23 |
| `src/utils/friendOrder.ts` | 21 |
| `src/utils/commentTime.ts` | 20 |
| `src/utils/likeCount.ts` | 20 |
| `src/utils/likedBy.ts` | 20 |
| `src/utils/retryOnce.ts` | 17 |
| `src/utils/swipeBack.ts` | 13 |
| `src/utils/seenWhileAway.ts` | 12 |
| `src/utils/gifIds.ts` | 7 |

## Dependencies

Declared range versus what is actually installed. A drift here means a pinned
version is not the version running (Constitution P52).

| Package | Declared | Installed |
|---|---|---|
| `@invertase/react-native-apple-authentication` | `2.5.1` | 2.5.1 |
| `@notifee/react-native` | `^9.1.8` | 9.1.8 |
| `@react-native-async-storage/async-storage` | `^1.23.1` | 1.23.1 |
| `@react-native-clipboard/clipboard` | `1.16.3` | 1.16.3 |
| `@react-native-community/netinfo` | `12.0.1` | 12.0.1 |
| `@react-native-documents/picker` | `^10.1.7` | 10.1.7 |
| `@react-native-firebase/app` | `^24.1.0` | 24.1.0 |
| `@react-native-firebase/crashlytics` | `24.1.0` | 24.1.0 |
| `@react-native-firebase/messaging` | `^24.1.0` | 24.1.0 |
| `@react-native-masked-view/masked-view` | `^0.3.2` | 0.3.2 |
| `@react-navigation/bottom-tabs` | `^7.15.10` | 7.15.10 |
| `@react-navigation/native` | `^7.2.2` | 7.2.2 |
| `@react-navigation/native-stack` | `^7.14.12` | 7.14.12 |
| `@react-navigation/stack` | `^7.8.11` | 7.8.11 |
| `@sbaiahmed1/react-native-blur` | `6.0.3` | 6.0.3 |
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
