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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_notifications: {
        Row: {
          actor_id: string | null
          agg_count: number
          agg_key: string | null
          created_at: string
          id: string
          is_read: boolean
          payload: Json
          post_id: string | null
          recipient_id: string
          type: string
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          agg_count?: number
          agg_key?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json
          post_id?: string | null
          recipient_id: string
          type: string
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          agg_count?: number
          agg_key?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json
          post_id?: string | null
          recipient_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      album_tracks: {
        Row: {
          added_at: string
          album_id: string
          position: number
          track_id: string
        }
        Insert: {
          added_at?: string
          album_id: string
          position: number
          track_id: string
        }
        Update: {
          added_at?: string
          album_id?: string
          position?: number
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "album_tracks_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          cover_art_url: string | null
          created_at: string
          description: string | null
          id: string
          release_date: string | null
          title: string
          uploader_id: string
        }
        Insert: {
          cover_art_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          release_date?: string | null
          title: string
          uploader_id: string
        }
        Update: {
          cover_art_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          release_date?: string | null
          title?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "albums_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      deleted_accounts: {
        Row: {
          deleted_at: string
          email_sha256: string | null
          id: number
          username: string | null
        }
        Insert: {
          deleted_at?: string
          email_sha256?: string | null
          id?: never
          username?: string | null
        }
        Update: {
          deleted_at?: string
          email_sha256?: string | null
          id?: never
          username?: string | null
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          device_id: string
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      notification_preferences: {
        Row: {
          activity: boolean
          jam: boolean
          messages: boolean
          social: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          activity?: boolean
          jam?: boolean
          messages?: boolean
          social?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          activity?: boolean
          jam?: boolean
          messages?: boolean
          social?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          cover_color: string | null
          cover_color_2: string | null
          cover_emoji: string | null
          created_at: string
          id: string
          name: string
          user_id: string
          visibility: Database["public"]["Enums"]["playlist_visibility"]
        }
        Insert: {
          cover_color?: string | null
          cover_color_2?: string | null
          cover_emoji?: string | null
          created_at?: string
          id?: string
          name: string
          user_id: string
          visibility?: Database["public"]["Enums"]["playlist_visibility"]
        }
        Update: {
          cover_color?: string | null
          cover_color_2?: string | null
          cover_emoji?: string | null
          created_at?: string
          id?: string
          name?: string
          user_id?: string
          visibility?: Database["public"]["Enums"]["playlist_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "playlists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comment_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comment_reports: {
        Row: {
          comment_id: string
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comment_reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comment_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          like_count: number
          parent_comment_id: string | null
          post_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          like_count?: number
          parent_comment_id?: string | null
          post_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          like_count?: number
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
      post_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          post_id: string
          reason: string
          reporter_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          post_id: string
          reason: string
          reporter_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string
          reason?: string
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_views: {
        Row: {
          id: string
          played_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          id?: string
          played_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          id?: string
          played_at?: string
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
          comments_friends_only: boolean
          created_at: string | null
          display_name: string | null
          followers_count: number | null
          following_count: number | null
          id: string
          last_seen_at: string | null
          links: string[]
          show_activity: boolean | null
          username: string
          username_set: boolean
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          comments_friends_only?: boolean
          created_at?: string | null
          display_name?: string | null
          followers_count?: number | null
          following_count?: number | null
          id: string
          last_seen_at?: string | null
          links?: string[]
          show_activity?: boolean | null
          username: string
          username_set?: boolean
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          comments_friends_only?: boolean
          created_at?: string | null
          display_name?: string | null
          followers_count?: number | null
          following_count?: number | null
          id?: string
          last_seen_at?: string | null
          links?: string[]
          show_activity?: boolean | null
          username?: string
          username_set?: boolean
        }
        Relationships: []
      }
      profiles_private: {
        Row: {
          date_of_birth: string | null
          phone_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          date_of_birth?: string | null
          phone_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          date_of_birth?: string | null
          phone_number?: string | null
          updated_at?: string
          user_id?: string
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
          file_size_bytes: number | null
          id: string
          lyrics: string | null
          lyrics_format: string | null
          media_kind: string
          thumbnail_url: string | null
          title: string
          uploader_id: string
          video_url: string | null
          waveform_peaks: Json | null
        }
        Insert: {
          audio_url?: string | null
          cover_art_url?: string | null
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          id?: string
          lyrics?: string | null
          lyrics_format?: string | null
          media_kind: string
          thumbnail_url?: string | null
          title: string
          uploader_id: string
          video_url?: string | null
          waveform_peaks?: Json | null
        }
        Update: {
          audio_url?: string | null
          cover_art_url?: string | null
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          id?: string
          lyrics?: string | null
          lyrics_format?: string | null
          media_kind?: string
          thumbnail_url?: string | null
          title?: string
          uploader_id?: string
          video_url?: string | null
          waveform_peaks?: Json | null
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
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
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
      account_email_hash: { Args: { p_email: string }; Returns: string }
      activity_list: {
        Args: { p_before?: string; p_limit?: number }
        Returns: {
          actor_avatar_url: string
          actor_display_name: string
          actor_id: string
          actor_username: string
          agg_count: number
          created_at: string
          id: string
          is_read: boolean
          payload: Json
          post_cover_art_url: string
          post_id: string
          post_title: string
          type: string
          updated_at: string
        }[]
      }
      activity_mark_all_read: { Args: never; Returns: undefined }
      activity_mark_read: { Args: { p_id: string }; Returns: undefined }
      activity_notify_friend_outcome: {
        Args: { p_accepted: boolean; p_other_user: string }
        Returns: string
      }
      activity_notify_new_fan: { Args: { p_target: string }; Returns: string }
      activity_notify_post: {
        Args: {
          p_comment_id?: string
          p_comment_text?: string
          p_post_id: string
          p_type: string
        }
        Returns: {
          actor_display_name: string
          agg_count: number
          notification_id: string
          recipient_id: string
          recipient_should_push: boolean
        }[]
      }
      activity_record_play: {
        Args: { p_post_id: string }
        Returns: {
          milestone_recipient: string
          milestone_threshold: number
          views_count: number
        }[]
      }
      activity_unread_count: { Args: never; Returns: number }
      add_star: { Args: { target_user_id: string }; Returns: undefined }
      assert_analytics_window: {
        Args: { p_from: string; p_to: string }
        Returns: undefined
      }
      assert_friendship: { Args: { a: string; b: string }; Returns: undefined }
      broadcast_jam_state: {
        Args: { p_jam_room_id: string; p_payload: Json }
        Returns: undefined
      }
      can_comment_on_post: { Args: { p_post_id: string }; Returns: boolean }
      cancel_friend_request: {
        Args: { other_user_id: string }
        Returns: undefined
      }
      claim_username: {
        Args: { p_display_name?: string; p_username: string }
        Returns: undefined
      }
      create_group: {
        Args: { p_member_ids: string[]; p_name: string }
        Returns: string
      }
      create_jam_room: { Args: { p_conversation_id: string }; Returns: string }
      creator_plays_by_day: {
        Args: {
          p_exclude_self?: boolean
          p_from: string
          p_to: string
          p_tz?: string
        }
        Returns: {
          day: string
          listeners: number
          plays: number
        }[]
      }
      creator_plays_by_hour: {
        Args: {
          p_exclude_self?: boolean
          p_from: string
          p_to: string
          p_tz?: string
        }
        Returns: {
          hour: number
          plays: number
        }[]
      }
      creator_top_tracks: {
        Args: {
          p_exclude_self?: boolean
          p_from: string
          p_limit?: number
          p_to: string
          p_tz?: string
        }
        Returns: {
          cover_art_url: string
          listeners: number
          plays: number
          post_id: string
          title: string
          track_id: string
        }[]
      }
      delete_my_account: { Args: never; Returns: undefined }
      fetch_home_feed: {
        Args: {
          p_cursor_bucket?: number
          p_cursor_id?: string
          p_cursor_sort_key?: number
          p_limit?: number
        }
        Returns: {
          feed_bucket: number
          post: Json
          post_id: string
          sort_key: number
        }[]
      }
      get_email_for_username: { Args: { p_username: string }; Returns: string }
      get_jam_snapshot: { Args: { p_jam_room_id: string }; Returns: Json }
      get_or_create_dm: {
        Args: { user_a: string; user_b: string }
        Returns: string
      }
      is_conversation_member: { Args: { conv_id: string }; Returns: boolean }
      is_username_available: { Args: { p_username: string }; Returns: boolean }
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
      message_preview: {
        Args: { p_body: string; p_kind: string }
        Returns: string
      }
      profile_links_ok: { Args: { p_links: string[] }; Returns: boolean }
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
      playlist_visibility: "public" | "friends" | "private"
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
    Enums: {
      playlist_visibility: ["public", "friends", "private"],
    },
  },
} as const
