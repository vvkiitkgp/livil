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
  UserProfile: { userId: string };
  PlaylistDetail: { playlistId: string; playlistName: string };
  Following: undefined;
  RecentlyPlayed: undefined;
  CreatePlaylist: {
    initialPost?: {
      postId: string;
      title: string;
      artistName: string;
      coverArtUrl: string | null;
    };
  } | undefined;
  // ── Chat
  Inbox: undefined;
  Conversation: { conversationId: string; title: string; kind?: 'dm' | 'group' };
  NewConversation: undefined;
  GroupInfo: { conversationId: string };
  // ── Jam Room (Phase 3)
  JamRoom: { jamRoomId: string; conversationId: string };
};
