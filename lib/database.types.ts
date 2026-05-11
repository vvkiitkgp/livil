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
          audio_url: string;
          cover_art_url: string | null;
          created_at: string;
          description: string | null;
          duration_seconds: number | null;
          id: string;
          title: string;
          uploader_id: string;
          video_url: string | null;
        };
        Insert: {
          audio_url: string;
          cover_art_url?: string | null;
          created_at?: string;
          description?: string | null;
          duration_seconds?: number | null;
          id?: string;
          title: string;
          uploader_id: string;
          video_url?: string | null;
        };
        Update: {
          audio_url?: string;
          cover_art_url?: string | null;
          created_at?: string;
          description?: string | null;
          duration_seconds?: number | null;
          id?: string;
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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
