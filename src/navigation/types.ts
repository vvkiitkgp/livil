export type AuthStackParamList = {
  Onboarding: undefined;
  SignIn: undefined;
  SignUp: undefined;
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
    openComments?: boolean;
    highlightCommentId?: string;
  };
  PlaylistDetail: { playlistId: string; playlistName: string };
  EditPlaylist: { playlistId: string };
  Following: undefined;
  RecentlyPlayed: undefined;
  EditProfile: undefined;
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
  StoryViewer: { storyIds: string[]; startIndex: number };
};
