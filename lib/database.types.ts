export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      conversation_members: {
        Row: {
          conversation_id: string
          joined_at: string | null
          last_read_at: string | null
          role: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string | null
          last_read_at?: string | null
          role?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string | null
          last_read_at?: string | null
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          created_by: string | null
          id: string
          kind: string
          last_message_at: string | null
          last_message_preview: string | null
          name: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          kind: string
          last_message_at?: string | null
          last_message_preview?: string | null
          name?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          kind: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          kind?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_following_id_fkey"
            columns: ["following_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_at: string | null
          created_at: string
          requested_by: string
          status: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          requested_by: string
          status: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          requested_by?: string
          status?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jam_queue: {
        Row: {
          added_at: string | null
          id: string
          jam_room_id: string | null
          position: number | null
          suggested_by: string | null
          track_id: string | null
          upvotes: number | null
        }
        Insert: {
          added_at?: string | null
          id?: string
          jam_room_id?: string | null
          position?: number | null
          suggested_by?: string | null
          track_id?: string | null
          upvotes?: number | null
        }
        Update: {
          added_at?: string | null
          id?: string
          jam_room_id?: string | null
          position?: number | null
          suggested_by?: string | null
          track_id?: string | null
          upvotes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jam_queue_jam_room_id_fkey"
            columns: ["jam_room_id"]
            isOneToOne: false
            referencedRelation: "jam_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jam_queue_suggested_by_fkey"
            columns: ["suggested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jam_queue_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      jam_room_members: {
        Row: {
          jam_room_id: string
          joined_at: string | null
          permissions: Json | null
          role: string | null
          user_id: string
        }
        Insert: {
          jam_room_id: string
          joined_at?: string | null
          permissions?: Json | null
          role?: string | null
          user_id: string
        }
        Update: {
          jam_room_id?: string
          joined_at?: string | null
          permissions?: Json | null
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jam_room_members_jam_room_id_fkey"
            columns: ["jam_room_id"]
            isOneToOne: false
            referencedRelation: "jam_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jam_room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jam_rooms: {
        Row: {
          conversation_id: string | null
          current_track_id: string | null
          ended_at: string | null
          host_clock_at: string | null
          host_id: string | null
          id: string
          is_playing: boolean | null
          playback_position_ms: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          conversation_id?: string | null
          current_track_id?: string | null
          ended_at?: string | null
          host_clock_at?: string | null
          host_id?: string | null
          id?: string
          is_playing?: boolean | null
          playback_position_ms?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          conversation_id?: string | null
          current_track_id?: string | null
          ended_at?: string | null
          host_clock_at?: string | null
          host_id?: string | null
          id?: string
          is_playing?: boolean | null
          playback_position_ms?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jam_rooms_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jam_rooms_current_track_id_fkey"
            columns: ["current_track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jam_rooms_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listen_sessions: {
        Row: {
          artist_name: string
          track_title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          artist_name: string
          track_title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          artist_name?: string
          track_title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listen_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string | null
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string | null
          deleted_at: string | null
          id: string
          kind: string | null
          metadata: Json | null
          reply_to_id: string | null
          sender_id: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string | null
          metadata?: Json | null
          reply_to_id?: string | null
          sender_id?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string | null
          metadata?: Json | null
          reply_to_id?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_posts: {
        Row: {
          added_at: string
          playlist_id: string
          post_id: string
        }
        Insert: {
          added_at?: string
          playlist_id: string
          post_id: string
        }
        Update: {
          added_at?: string
          playlist_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_posts_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          parent_comment_id: string | null
          post_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_views: {
        Row: {
          first_viewed_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          first_viewed_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          first_viewed_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_views_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          caption: string | null
          clip_end_sec: number | null
          clip_start_sec: number | null
          comments_count: number
          created_at: string
          id: string
          kind: string
          likes_count: number
          original_post_id: string | null
          reposts_count: number
          track_id: string
          views_count: number
        }
        Insert: {
          author_id: string
          caption?: string | null
          clip_end_sec?: number | null
          clip_start_sec?: number | null
          comments_count?: number
          created_at?: string
          id?: string
          kind: string
          likes_count?: number
          original_post_id?: string | null
          reposts_count?: number
          track_id: string
          views_count?: number
        }
        Update: {
          author_id?: string
          caption?: string | null
          clip_end_sec?: number | null
          clip_start_sec?: number | null
          comments_count?: number
          created_at?: string
          id?: string
          kind?: string
          likes_count?: number
          original_post_id?: string | null
          reposts_count?: number
          track_id?: string
          views_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_original_post_id_fkey"
            columns: ["original_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          fans_seen_at: string | null
          followers_count: number | null
          following_count: number | null
          id: string
          last_seen_at: string | null
          show_activity: boolean | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          fans_seen_at?: string | null
          followers_count?: number | null
          following_count?: number | null
          id: string
          last_seen_at?: string | null
          show_activity?: boolean | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          fans_seen_at?: string | null
          followers_count?: number | null
          following_count?: number | null
          id?: string
          last_seen_at?: string | null
          show_activity?: boolean | null
          username?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          author_id: string
          clip_end_sec: number
          clip_start_sec: number
          comment: string | null
          created_at: string
          expires_at: string
          id: string
          original_post_id: string
          track_id: string
        }
        Insert: {
          author_id: string
          clip_end_sec: number
          clip_start_sec: number
          comment?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          original_post_id: string
          track_id: string
        }
        Update: {
          author_id?: string
          clip_end_sec?: number
          clip_start_sec?: number
          comment?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          original_post_id?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stories_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_original_post_id_fkey"
            columns: ["original_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      story_views: {
        Row: {
          story_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          story_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          story_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_views_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      track_collaborators: {
        Row: {
          created_at: string
          custom_name: string | null
          id: string
          role: string
          status: string
          track_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          id?: string
          role: string
          status?: string
          track_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          id?: string
          role?: string
          status?: string
          track_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "track_collaborators_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "track_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          audio_url: string | null
          cover_art_url: string | null
          created_at: string
          description: string | null
          duration_seconds: number | null
          id: string
          media_kind: string
          title: string
          uploader_id: string
          video_url: string | null
        }
        Insert: {
          audio_url?: string | null
          cover_art_url?: string | null
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          id?: string
          media_kind: string
          title: string
          uploader_id: string
          video_url?: string | null
        }
        Update: {
          audio_url?: string | null
          cover_art_url?: string | null
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          id?: string
          media_kind?: string
          title?: string
          uploader_id?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tracks_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_recent_tracks: {
        Row: {
          played_at: string
          track_id: string
          user_id: string
        }
        Insert: {
          played_at?: string
          track_id: string
          user_id: string
        }
        Update: {
          played_at?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_recent_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_recent_tracks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _friendship_pair: {
        Args: { a: string; b: string }
        Returns: {
          hi: string
          lo: string
        }[]
      }
      accept_friend_request: {
        Args: { other_user_id: string }
        Returns: undefined
      }
      add_star: { Args: { target_user_id: string }; Returns: undefined }
      assert_friendship: { Args: { a: string; b: string }; Returns: undefined }
      cancel_friend_request: {
        Args: { other_user_id: string }
        Returns: undefined
      }
      create_group: {
        Args: { p_member_ids: string[]; p_name: string }
        Returns: string
      }
      create_jam_room: { Args: { p_conversation_id: string }; Returns: string }
      fetch_home_feed: {
        Args: {
          p_cursor_bucket?: number
          p_cursor_id?: string
          p_cursor_sort_key?: number
          p_limit?: number
        }
        Returns: {
          feed_bucket: number
          post_id: string
          sort_key: number
          viewer_has_liked: boolean
        }[]
      }
      get_jam_snapshot: { Args: { p_jam_room_id: string }; Returns: Json }
      get_new_fans_summary: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          recent_user_id: string
          total_count: number
          username: string
        }[]
      }
      get_or_create_dm: {
        Args: { user_a: string; user_b: string }
        Returns: string
      }
      is_conversation_member: { Args: { conv_id: string }; Returns: boolean }
      list_active_stories: {
        Args: never
        Returns: {
          author_id: string
          avatar_url: string
          clip_end_sec: number
          clip_start_sec: number
          comment: string
          created_at: string
          display_name: string
          expires_at: string
          original_post_id: string
          story_id: string
          track_audio_url: string
          track_cover_url: string
          track_id: string
          track_media_kind: string
          track_title: string
          track_video_url: string
          username: string
          viewed_at: string
        }[]
      }
      list_friend_listen_stories: {
        Args: never
        Returns: {
          artist_name: string
          avatar_url: string
          display_name: string
          track_title: string
          updated_at: string
          user_id: string
          username: string
        }[]
      }
      list_incoming_friend_requests: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          other_user_id: string
          username: string
        }[]
      }
      list_my_conversations: {
        Args: never
        Returns: {
          avatar_url: string
          id: string
          kind: string
          last_message_at: string
          last_message_preview: string
          name: string
          other_user_avatar: string
          other_user_id: string
          other_user_name: string
          other_user_online: boolean
          other_user_username: string
          unread_count: number
        }[]
      }
      mark_fans_seen: { Args: never; Returns: undefined }
      reject_friend_request: {
        Args: { other_user_id: string }
        Returns: undefined
      }
      remove_friend: { Args: { other_user_id: string }; Returns: undefined }
      remove_star: { Args: { target_user_id: string }; Returns: undefined }
      send_friend_request: {
        Args: { target_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
