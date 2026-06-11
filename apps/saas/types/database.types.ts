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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account: {
        Row: {
          accessToken: string | null
          accessTokenExpiresAt: string | null
          accountId: string
          createdAt: string
          id: string
          idToken: string | null
          password: string | null
          providerId: string
          refreshToken: string | null
          refreshTokenExpiresAt: string | null
          scope: string | null
          updatedAt: string
          userId: string
        }
        Insert: {
          accessToken?: string | null
          accessTokenExpiresAt?: string | null
          accountId: string
          createdAt?: string
          id: string
          idToken?: string | null
          password?: string | null
          providerId: string
          refreshToken?: string | null
          refreshTokenExpiresAt?: string | null
          scope?: string | null
          updatedAt?: string
          userId: string
        }
        Update: {
          accessToken?: string | null
          accessTokenExpiresAt?: string | null
          accountId?: string
          createdAt?: string
          id?: string
          idToken?: string | null
          password?: string | null
          providerId?: string
          refreshToken?: string | null
          refreshTokenExpiresAt?: string | null
          scope?: string | null
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_otp_inbox: {
        Row: {
          created_at: string
          email: string
          id: string
          otp: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          otp: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          otp?: string
        }
        Relationships: []
      }
      files: {
        Row: {
          byte_size: number
          conversion_error: string | null
          conversion_status: Database["public"]["Enums"]["conversion_status"]
          created_at: string
          id: string
          markdown_content: string | null
          mime_type: string
          name: string
          project_id: string
          storage_key: string
        }
        Insert: {
          byte_size: number
          conversion_error?: string | null
          conversion_status?: Database["public"]["Enums"]["conversion_status"]
          created_at?: string
          id?: string
          markdown_content?: string | null
          mime_type: string
          name: string
          project_id: string
          storage_key: string
        }
        Update: {
          byte_size?: number
          conversion_error?: string | null
          conversion_status?: Database["public"]["Enums"]["conversion_status"]
          created_at?: string
          id?: string
          markdown_content?: string | null
          mime_type?: string
          name?: string
          project_id?: string
          storage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_answers: {
        Row: {
          answer: string
          id: string
          project_id: string
          question_key: Database["public"]["Enums"]["interview_question_key"]
          updated_at: string
        }
        Insert: {
          answer: string
          id?: string
          project_id: string
          question_key: Database["public"]["Enums"]["interview_question_key"]
          updated_at?: string
        }
        Update: {
          answer?: string
          id?: string
          project_id?: string
          question_key?: Database["public"]["Enums"]["interview_question_key"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_answers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          created_at: string
          id: string
          project_id: string
          raised_by: Database["public"]["Enums"]["agent_kind"]
          resolution: Json | null
          severity: Database["public"]["Enums"]["issue_severity"]
          status: Database["public"]["Enums"]["issue_status"]
          summary: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          raised_by: Database["public"]["Enums"]["agent_kind"]
          resolution?: Json | null
          severity: Database["public"]["Enums"]["issue_severity"]
          status?: Database["public"]["Enums"]["issue_status"]
          summary: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          raised_by?: Database["public"]["Enums"]["agent_kind"]
          resolution?: Json | null
          severity?: Database["public"]["Enums"]["issue_severity"]
          status?: Database["public"]["Enums"]["issue_status"]
          summary?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          created_at: string
          id: string
          issue_id: string | null
          message: Json
          project_id: string
          status: Database["public"]["Enums"]["message_status"]
          stream_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          issue_id?: string | null
          message: Json
          project_id: string
          status?: Database["public"]["Enums"]["message_status"]
          stream_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          issue_id?: string | null
          message?: Json
          project_id?: string
          status?: Database["public"]["Enums"]["message_status"]
          stream_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      outputs: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["output_kind"]
          project_id: string
          storage_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["output_kind"]
          project_id: string
          storage_key: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["output_kind"]
          project_id?: string
          storage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "outputs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      passkey: {
        Row: {
          aaguid: string | null
          backedUp: boolean
          counter: number
          createdAt: string
          credentialID: string
          deviceType: string
          id: string
          name: string | null
          publicKey: string
          transports: string | null
          userId: string
        }
        Insert: {
          aaguid?: string | null
          backedUp: boolean
          counter: number
          createdAt?: string
          credentialID: string
          deviceType: string
          id: string
          name?: string | null
          publicKey: string
          transports?: string | null
          userId: string
        }
        Update: {
          aaguid?: string | null
          backedUp?: boolean
          counter?: number
          createdAt?: string
          credentialID?: string
          deviceType?: string
          id?: string
          name?: string | null
          publicKey?: string
          transports?: string | null
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "passkey_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_responses: {
        Row: {
          comment: string | null
          created_at: string
          price_band: string | null
          updated_at: string
          user_id: string
          wants_more_models: string | null
          wants_unlimited: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          price_band?: string | null
          updated_at?: string
          user_id: string
          wants_more_models?: string | null
          wants_unlimited: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          price_band?: string | null
          updated_at?: string
          user_id?: string
          wants_more_models?: string | null
          wants_unlimited?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      project_document_versions: {
        Row: {
          created_at: string
          file_id: string
          id: string
          issue_id: string | null
          message_id: string | null
          parent_version_id: string | null
          project_id: string
          source: Database["public"]["Enums"]["project_document_version_source"]
          storage_key: string
          version_number: number
        }
        Insert: {
          created_at?: string
          file_id: string
          id?: string
          issue_id?: string | null
          message_id?: string | null
          parent_version_id?: string | null
          project_id: string
          source: Database["public"]["Enums"]["project_document_version_source"]
          storage_key: string
          version_number: number
        }
        Update: {
          created_at?: string
          file_id?: string
          id?: string
          issue_id?: string | null
          message_id?: string | null
          parent_version_id?: string | null
          project_id?: string
          source?: Database["public"]["Enums"]["project_document_version_source"]
          storage_key?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_document_versions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_document_versions_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_document_versions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_document_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "project_document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_document_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_parties: {
        Row: {
          created_at: string
          id: string
          is_placeholder: boolean
          is_user_side: boolean | null
          name: string
          project_id: string
          role: string | null
          side: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_placeholder?: boolean
          is_user_side?: boolean | null
          name: string
          project_id: string
          role?: string | null
          side: number
        }
        Update: {
          created_at?: string
          id?: string
          is_placeholder?: boolean
          is_user_side?: boolean | null
          name?: string
          project_id?: string
          role?: string | null
          side?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          cancel_requested_at: string | null
          completed_at: string | null
          created_at: string
          display_id: string | null
          draft_ownership: Database["public"]["Enums"]["draft_ownership"] | null
          failure_message: string | null
          id: string
          max_issues: number
          max_turns_per_issue: number
          name: string
          owner_id: string
          provider: string | null
          run_started_at: string | null
          run_usage: Json | null
          slug: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cancel_requested_at?: string | null
          completed_at?: string | null
          created_at?: string
          display_id?: string | null
          draft_ownership?:
            | Database["public"]["Enums"]["draft_ownership"]
            | null
          failure_message?: string | null
          id?: string
          max_issues?: number
          max_turns_per_issue?: number
          name: string
          owner_id: string
          provider?: string | null
          run_started_at?: string | null
          run_usage?: Json | null
          slug?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cancel_requested_at?: string | null
          completed_at?: string | null
          created_at?: string
          display_id?: string | null
          draft_ownership?:
            | Database["public"]["Enums"]["draft_ownership"]
            | null
          failure_message?: string | null
          id?: string
          max_issues?: number
          max_turns_per_issue?: number
          name?: string
          owner_id?: string
          provider?: string | null
          run_started_at?: string | null
          run_usage?: Json | null
          slug?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          bucket: string
          id: string
          occurred_at: string
          user_id: string
        }
        Insert: {
          bucket: string
          id?: string
          occurred_at?: string
          user_id: string
        }
        Update: {
          bucket?: string
          id?: string
          occurred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      session: {
        Row: {
          createdAt: string
          expiresAt: string
          id: string
          ipAddress: string | null
          token: string
          updatedAt: string
          userAgent: string | null
          userId: string
        }
        Insert: {
          createdAt?: string
          expiresAt: string
          id: string
          ipAddress?: string | null
          token: string
          updatedAt?: string
          userAgent?: string | null
          userId: string
        }
        Update: {
          createdAt?: string
          expiresAt?: string
          id?: string
          ipAddress?: string | null
          token?: string
          updatedAt?: string
          userAgent?: string | null
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      user: {
        Row: {
          createdAt: string
          disclaimer_acknowledged_at: string | null
          email: string
          emailVerified: boolean
          id: string
          image: string | null
          name: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          disclaimer_acknowledged_at?: string | null
          email: string
          emailVerified?: boolean
          id: string
          image?: string | null
          name: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          disclaimer_acknowledged_at?: string | null
          email?: string
          emailVerified?: boolean
          id?: string
          image?: string | null
          name?: string
          updatedAt?: string
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          auth_tag: string
          created_at: string
          encrypted_key: string
          is_default: boolean
          iv: string
          last_validated_at: string | null
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_tag: string
          created_at?: string
          encrypted_key: string
          is_default?: boolean
          iv: string
          last_validated_at?: string | null
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_tag?: string
          created_at?: string
          encrypted_key?: string
          is_default?: boolean
          iv?: string
          last_validated_at?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      verification: {
        Row: {
          createdAt: string
          expiresAt: string
          id: string
          identifier: string
          updatedAt: string
          value: string
        }
        Insert: {
          createdAt?: string
          expiresAt: string
          id: string
          identifier: string
          updatedAt?: string
          value: string
        }
        Update: {
          createdAt?: string
          expiresAt?: string
          id?: string
          identifier?: string
          updatedAt?: string
          value?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_burst_max: number
          p_burst_window_secs: number
          p_long_max: number
          p_long_window_secs: number
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          burst_count: number
          long_count: number
          retry_after_secs: number
        }[]
      }
      next_user_project_display_id: {
        Args: { p_owner: string }
        Returns: string
      }
      user_owns_project: { Args: { p_id: string }; Returns: boolean }
    }
    Enums: {
      agent_kind: "red" | "blue" | "system"
      conversion_status: "pending" | "done" | "failed"
      draft_ownership: "ours" | "theirs" | "neither"
      interview_question_key: "user_side_details" | "counterparty_details"
      issue_severity: "low" | "medium" | "high" | "critical"
      issue_status:
        | "open"
        | "in_negotiation"
        | "agreed"
        | "escalated"
        | "impasse"
        | "deferred"
        | "unresolved"
      message_status: "streaming" | "complete" | "failed"
      output_kind: "redline" | "memo" | "transcript"
      project_document_version_source: "upload" | "proposal" | "accepted"
      project_status:
        | "draft"
        | "extracting"
        | "ready_for_interview"
        | "interviewing"
        | "reviewing"
        | "negotiating"
        | "complete"
        | "complete_with_impasses"
        | "failed"
        | "cancelling"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agent_kind: ["red", "blue", "system"],
      conversion_status: ["pending", "done", "failed"],
      draft_ownership: ["ours", "theirs", "neither"],
      interview_question_key: ["user_side_details", "counterparty_details"],
      issue_severity: ["low", "medium", "high", "critical"],
      issue_status: [
        "open",
        "in_negotiation",
        "agreed",
        "escalated",
        "impasse",
        "deferred",
        "unresolved",
      ],
      message_status: ["streaming", "complete", "failed"],
      output_kind: ["redline", "memo", "transcript"],
      project_document_version_source: ["upload", "proposal", "accepted"],
      project_status: [
        "draft",
        "extracting",
        "ready_for_interview",
        "interviewing",
        "reviewing",
        "negotiating",
        "complete",
        "complete_with_impasses",
        "failed",
        "cancelling",
        "cancelled",
      ],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
