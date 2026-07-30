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
    excludeUserIds?: string[];
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
  RecentlyPlayed: undefined;
  EditProfile: undefined;
  Settings: undefined;
  AccountSettings: undefined;
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
