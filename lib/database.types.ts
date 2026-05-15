export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.4';
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          created_at: string | null;
          display_name: string | null;
          followers_count: number | null;
          following_count: number | null;
          id: string;
          username: string;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string | null;
          display_name?: string | null;
          followers_count?: number | null;
          following_count?: number | null;
          id: string;
          username: string;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string | null;
          display_name?: string | null;
          followers_count?: number | null;
          following_count?: number | null;
          id?: string;
          username?: string;
        };
        Relationships: [];
      };
      track_collaborators: {
        Row: {
          created_at: string;
          custom_name: string | null;
          id: string;
          role: string;
          status: 'pending' | 'accepted' | 'declined';
          track_id: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          custom_name?: string | null;
          id?: string;
          role: string;
          status?: 'pending' | 'accepted' | 'declined';
          track_id: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          custom_name?: string | null;
          id?: string;
          role?: string;
          status?: 'pending' | 'accepted' | 'declined';
          track_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'track_collaborators_track_id_fkey';
            columns: ['track_id'];
            isOneToOne: false;
            referencedRelation: 'tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'track_collaborators_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      tracks: {
        Row: {
          audio_url: string | null;
          cover_art_url: string | null;
          created_at: string;
          description: string | null;
          duration_seconds: number | null;
          id: string;
          media_kind: 'audio' | 'video';
          title: string;
          uploader_id: string;
          video_url: string | null;
        };
        Insert: {
          audio_url?: string | null;
          cover_art_url?: string | null;
          created_at?: string;
          description?: string | null;
          duration_seconds?: number | null;
          id?: string;
          media_kind: 'audio' | 'video';
          title: string;
          uploader_id: string;
          video_url?: string | null;
        };
        Update: {
          audio_url?: string | null;
          cover_art_url?: string | null;
          created_at?: string;
          description?: string | null;
          duration_seconds?: number | null;
          id?: string;
          media_kind?: 'audio' | 'video';
          title?: string;
          uploader_id?: string;
          video_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tracks_uploader_id_fkey';
            columns: ['uploader_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      posts: {
        Row: {
          author_id: string;
          caption: string | null;
          comments_count: number;
          created_at: string;
          id: string;
          kind: 'upload' | 'repost';
          likes_count: number;
          original_post_id: string | null;
          reposts_count: number;
          track_id: string;
          views_count: number;
        };
        Insert: {
          author_id: string;
          caption?: string | null;
          comments_count?: number;
          created_at?: string;
          id?: string;
          kind: 'upload' | 'repost';
          likes_count?: number;
          original_post_id?: string | null;
          reposts_count?: number;
          track_id: string;
          views_count?: number;
        };
        Update: {
          author_id?: string;
          caption?: string | null;
          comments_count?: number;
          created_at?: string;
          id?: string;
          kind?: 'upload' | 'repost';
          likes_count?: number;
          original_post_id?: string | null;
          reposts_count?: number;
          track_id?: string;
          views_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'posts_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'posts_original_post_id_fkey';
            columns: ['original_post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'posts_track_id_fkey';
            columns: ['track_id'];
            isOneToOne: false;
            referencedRelation: 'tracks';
            referencedColumns: ['id'];
          },
        ];
      };
      post_likes: {
        Row: {
          created_at: string;
          post_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'post_likes_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'post_likes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      post_views: {
        Row: {
          first_viewed_at: string;
          post_id: string;
          user_id: string;
        };
        Insert: {
          first_viewed_at?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          first_viewed_at?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'post_views_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'post_views_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      post_comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          parent_comment_id: string | null;
          post_id: string;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          parent_comment_id?: string | null;
          post_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          parent_comment_id?: string | null;
          post_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'post_comments_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'post_comments_parent_comment_id_fkey';
            columns: ['parent_comment_id'];
            isOneToOne: false;
            referencedRelation: 'post_comments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'post_comments_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
        ];
      };
      follows: {
        Row: {
          created_at: string;
          follower_id: string;
          following_id: string;
          kind: 'star';
        };
        Insert: {
          created_at?: string;
          follower_id: string;
          following_id: string;
          kind?: 'star';
        };
        Update: {
          created_at?: string;
          follower_id?: string;
          following_id?: string;
          kind?: 'star';
        };
        Relationships: [
          {
            foreignKeyName: 'follows_follower_id_fkey';
            columns: ['follower_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'follows_following_id_fkey';
            columns: ['following_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      friendships: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          requested_by: string;
          status: 'pending' | 'accepted' | 'blocked';
          user_a_id: string;
          user_b_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          requested_by: string;
          status: 'pending' | 'accepted' | 'blocked';
          user_a_id: string;
          user_b_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          requested_by?: string;
          status?: 'pending' | 'accepted' | 'blocked';
          user_a_id?: string;
          user_b_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'friendships_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'friendships_user_a_id_fkey';
            columns: ['user_a_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'friendships_user_b_id_fkey';
            columns: ['user_b_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
