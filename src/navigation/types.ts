export type AuthStackParamList = {
  Onboarding: undefined;
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

export type AppTabParamList = {
  Home: undefined;
  Search: undefined;
  Library: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  Upload: undefined;
  CollaboratorPicker: {
    /**
     * Roles already credited here, as `${userId}|${role}` (or `custom:${name}|${role}`).
     *
     * NOT a list of people to hide. One artist is routinely two credits — the guitarist who
     * also wrote it — and excluding them from the search after their first credit made the
     * second one impossible to add.
     */
    takenRoleKeys?: string[];
  } | undefined;
  UserProfile: {
    userId: string;
    // Optional deep-link params used by ActivityCenter taps. focusPostId scrolls
    // the post into view; openComments opens the CommentsSheet for it;
    // highlightCommentId pulses that comment row briefly when the sheet opens.
    focusPostId?: string;
    // Which profile tab the focused post lives in, so the profile opens on the
    // right tab (uploads vs reposts) before scrolling — else focusPostId can't be
    // found in the default tab's list. Used by the story viewer's "go to song".
    focusPostKind?: 'upload' | 'repost';
    openComments?: boolean;
    highlightCommentId?: string;
  };
  PlaylistDetail: { playlistId: string; playlistName: string };
  EditPlaylist: { playlistId: string };
  Following: undefined;
  // A profile's Friends / Stars (public to every signed-in viewer) or Fans (OWNER ONLY —
  // 'fans' always lists the caller's own; never navigate here with another user's id).
  // `username` is only for the header; omit it for your own profile.
  ProfilePeople: { userId: string; username?: string; kind: 'friends' | 'stars' | 'fans' };
  RecentlyPlayed: undefined;
  // A single post on its own page. Where post notifications land: `openComments`
  // opens the comments (pulsing `highlightCommentId`), `openLikers` opens the likes
  // list. Both are one-shot arrival intents.
  PostDetail: {
    postId: string;
    openComments?: boolean;
    highlightCommentId?: string;
    openLikers?: boolean;
  };
  EditProfile: undefined;
  Settings: undefined;
  /** Replays the first-run guide from Settings; the sign-up showing is not a route. */
  FirstRunGuide: undefined;
  NotificationSettings: undefined;
  PrivacyData: undefined;
  ContactTeam: undefined;
  BlockedAccounts: undefined;
  DeleteAccount: undefined;
  CreatePlaylist: {
    initialPost?: {
      postId: string;
      title: string;
      artistName: string;
      coverArtUrl: string | null;
    };
  } | undefined;
  // ── Albums
  AlbumDetail: { albumId: string; albumTitle: string };
  CreateAlbum: {
    // When upload flow kicks off album creation, the new track id is passed in
    // so it can be auto-tagged into the freshly-created album.
    initialTrackId?: string;
  } | undefined;
  EditAlbum: { albumId: string };
  // ── Chat
  Inbox: undefined;
  Conversation: { conversationId: string; title: string; kind?: 'dm' | 'group' };
  NewConversation: undefined;
  GroupInfo: { conversationId: string };
  FriendRequests: undefined;
  ActivityCenter: undefined;
  // ── Jam Room (Phase 3)
  JamRoom: { jamRoomId: string; conversationId: string };
  // ── Repost / Story composer
  Repost: {
    originalPostId: string;
    // Seed values for the clip slider so the Repost screen opens with the
    // same clip the user was just looking at (PostCard's stored clip, or the
    // FullScreenPlayer's live-edited clip), not the original post's defaults.
    seedClipStartSec?: number | null;
    seedClipEndSec?: number | null;
  };
  // Stories are grouped by author (one tray ring per person). The viewer receives
  // the ordered clusters plus which ring/story was tapped, and flattens them into
  // one ordered index space internally (so cross-author tap/swipe works).
  StoryViewer: {
    clusters: { authorId: string; storyIds: string[] }[];
    startAuthorIndex: number;
    startStoryIndex?: number;
  };
};
