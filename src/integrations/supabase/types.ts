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
      assets: {
        Row: {
          asset_type: string | null
          brand_model: string | null
          btu_capacity: number | null
          created_at: string
          id: string
          last_maintenance_date: string | null
          status: string
          tag_code: string | null
          unit_id: string | null
        }
        Insert: {
          asset_type?: string | null
          brand_model?: string | null
          btu_capacity?: number | null
          created_at?: string
          id?: string
          last_maintenance_date?: string | null
          status?: string
          tag_code?: string | null
          unit_id?: string | null
        }
        Update: {
          asset_type?: string | null
          brand_model?: string | null
          btu_capacity?: number | null
          created_at?: string
          id?: string
          last_maintenance_date?: string | null
          status?: string
          tag_code?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata_json: Json | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata_json?: Json | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata_json?: Json | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          account_type: string | null
          cnpj_matriz: string | null
          created_at: string
          id: string
          legal_name: string
          trade_name: string | null
        }
        Insert: {
          account_type?: string | null
          cnpj_matriz?: string | null
          created_at?: string
          id?: string
          legal_name: string
          trade_name?: string | null
        }
        Update: {
          account_type?: string | null
          cnpj_matriz?: string | null
          created_at?: string
          id?: string
          legal_name?: string
          trade_name?: string | null
        }
        Relationships: []
      }
      rh_employees: {
        Row: {
          benefit_type: string
          created_at: string
          fare_cents: number
          full_name: string
          id: string
          is_active: boolean
          trips_per_day: number
          unit: string
          updated_at: string
        }
        Insert: {
          benefit_type: string
          created_at?: string
          fare_cents: number
          full_name: string
          id?: string
          is_active?: boolean
          trips_per_day?: number
          unit: string
          updated_at?: string
        }
        Update: {
          benefit_type?: string
          created_at?: string
          fare_cents?: number
          full_name?: string
          id?: string
          is_active?: boolean
          trips_per_day?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      rh_topups: {
        Row: {
          amount_cents: number
          benefit_type: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          paid_at: string
        }
        Insert: {
          amount_cents: number
          benefit_type: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          paid_at: string
        }
        Update: {
          amount_cents?: number
          benefit_type?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          paid_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_topups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_topups_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          created_at: string
          file_name: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          storage_path: string | null
          ticket_id: string
          uploaded_by: string | null
          uploader_role: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          storage_path?: string | null
          ticket_id: string
          uploaded_by?: string | null
          uploader_role?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          storage_path?: string | null
          ticket_id?: string
          uploaded_by?: string | null
          uploader_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_timeline: {
        Row: {
          author_user_id: string | null
          created_at: string
          id: string
          note_text: string | null
          role_label: string | null
          status_change: string | null
          ticket_id: string
        }
        Insert: {
          author_user_id?: string | null
          created_at?: string
          id?: string
          note_text?: string | null
          role_label?: string | null
          status_change?: string | null
          ticket_id: string
        }
        Update: {
          author_user_id?: string | null
          created_at?: string
          id?: string
          note_text?: string | null
          role_label?: string | null
          status_change?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_timeline_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_timeline_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          asset_id: string | null
          assigned_technician_id: string | null
          assumed_at: string | null
          assumed_by: string | null
          cancel_reason: string | null
          closed_at: string | null
          created_at: string
          created_by_user_id: string | null
          description: string
          id: string
          occurrence_type: string
          priority: string
          protocol_number: string | null
          sla_deadline: string | null
          status: string
          unit_id: string | null
        }
        Insert: {
          asset_id?: string | null
          assigned_technician_id?: string | null
          assumed_at?: string | null
          assumed_by?: string | null
          cancel_reason?: string | null
          closed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description: string
          id?: string
          occurrence_type: string
          priority?: string
          protocol_number?: string | null
          sla_deadline?: string | null
          status?: string
          unit_id?: string | null
        }
        Update: {
          asset_id?: string | null
          assigned_technician_id?: string | null
          assumed_at?: string | null
          assumed_by?: string | null
          cancel_reason?: string | null
          closed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string
          id?: string
          occurrence_type?: string
          priority?: string
          protocol_number?: string | null
          sla_deadline?: string | null
          status?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_assumed_by_fkey"
            columns: ["assumed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          address_json: Json | null
          cnpj: string | null
          company_id: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          address_json?: Json | null
          cnpj?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          address_json?: Json | null
          cnpj?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_id: string
          company_id: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string | null
          id: string
          is_unit_manager: boolean
          role_key: Database["public"]["Enums"]["role_key"]
          status: string
          unit_id: string | null
          username: string | null
        }
        Insert: {
          auth_id: string
          company_id?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_unit_manager?: boolean
          role_key?: Database["public"]["Enums"]["role_key"]
          status?: string
          unit_id?: string | null
          username?: string | null
        }
        Update: {
          auth_id?: string
          company_id?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_unit_manager?: boolean
          role_key?: Database["public"]["Enums"]["role_key"]
          status?: string
          unit_id?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_app_user_id: { Args: never; Returns: string }
      current_is_unit_manager: { Args: never; Returns: boolean }
      current_role_key: {
        Args: never
        Returns: Database["public"]["Enums"]["role_key"]
      }
      current_unit_id: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      usuario_esta_ativo: { Args: never; Returns: boolean }
    }
    Enums: {
      role_key:
        | "SUPER_ADMIN"
        | "ADMIN_OPERACIONAL"
        | "GESTOR_CONTA"
        | "GESTOR_REGIONAL"
        | "CLIENTE_PF"
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
      role_key: [
        "SUPER_ADMIN",
        "ADMIN_OPERACIONAL",
        "GESTOR_CONTA",
        "GESTOR_REGIONAL",
        "CLIENTE_PF",
      ],
    },
  },
} as const
