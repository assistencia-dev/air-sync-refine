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
      dbs_control_clients: {
        Row: {
          cnpj: string | null
          created_at: string
          email: string | null
          id: string
          legal_name: string
          logo_storage_path: string | null
          notes: string | null
          phone: string | null
          status: string
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          legal_name: string
          logo_storage_path?: string | null
          notes?: string | null
          phone?: string | null
          status?: string
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          legal_name?: string
          logo_storage_path?: string | null
          notes?: string | null
          phone?: string | null
          status?: string
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dbs_control_equipment: {
        Row: {
          brand: string | null
          capacity: string | null
          client_id: string
          created_at: string
          environment: string | null
          equipment_type: string | null
          id: string
          installation_date: string | null
          model: string | null
          serial_number: string | null
          site_id: string | null
          status: string
          tag_code: string | null
          technical_notes: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          capacity?: string | null
          client_id: string
          created_at?: string
          environment?: string | null
          equipment_type?: string | null
          id?: string
          installation_date?: string | null
          model?: string | null
          serial_number?: string | null
          site_id?: string | null
          status?: string
          tag_code?: string | null
          technical_notes?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          capacity?: string | null
          client_id?: string
          created_at?: string
          environment?: string | null
          equipment_type?: string | null
          id?: string
          installation_date?: string | null
          model?: string | null
          serial_number?: string | null
          site_id?: string | null
          status?: string
          tag_code?: string | null
          technical_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_equipment_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_equipment_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_parts: {
        Row: {
          cost_cents: number | null
          created_at: string
          description: string | null
          id: string
          name: string
          sale_cents: number | null
          sku: string | null
          status: string
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sale_cents?: number | null
          sku?: string | null
          status?: string
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sale_cents?: number | null
          sku?: string | null
          status?: string
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      dbs_control_service_catalog: {
        Row: {
          created_at: string
          description: string | null
          estimated_hours: number | null
          id: string
          name: string
          status: string
          table_value_cents: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimated_hours?: number | null
          id?: string
          name: string
          status?: string
          table_value_cents?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          estimated_hours?: number | null
          id?: string
          name?: string
          status?: string
          table_value_cents?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      dbs_control_sites: {
        Row: {
          address_json: Json
          client_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address_json?: Json
          client_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address_json?: Json
          client_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_snapshots: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          owner_user_id: string | null
          scope_key: string
          state: Json
          state_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          owner_user_id?: string | null
          scope_key: string
          state: Json
          state_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          owner_user_id?: string | null
          scope_key?: string
          state?: Json
          state_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_snapshots_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_snapshots_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_work_order_attachments: {
        Row: {
          attachment_type: string
          created_at: string
          file_name: string
          file_type: string | null
          id: string
          storage_path: string
          uploaded_by_user_id: string | null
          work_order_id: string
        }
        Insert: {
          attachment_type?: string
          created_at?: string
          file_name: string
          file_type?: string | null
          id?: string
          storage_path: string
          uploaded_by_user_id?: string | null
          work_order_id: string
        }
        Update: {
          attachment_type?: string
          created_at?: string
          file_name?: string
          file_type?: string | null
          id?: string
          storage_path?: string
          uploaded_by_user_id?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_order_attachments_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_attachments_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_work_order_equipment: {
        Row: {
          equipment_id: string
          work_order_id: string
        }
        Insert: {
          equipment_id: string
          work_order_id: string
        }
        Update: {
          equipment_id?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_order_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_equipment_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_work_order_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          new_status: string | null
          old_status: string | null
          work_order_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          new_status?: string | null
          old_status?: string | null
          work_order_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          new_status?: string | null
          old_status?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_order_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_events_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_work_order_parts: {
        Row: {
          created_at: string
          id: string
          part_id: string
          quantity: number
          unit_cents: number | null
          work_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          part_id: string
          quantity: number
          unit_cents?: number | null
          work_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          part_id?: string
          quantity?: number
          unit_cents?: number | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_order_parts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_parts_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_work_order_services: {
        Row: {
          created_at: string
          description: string | null
          id: string
          quantity: number
          service_id: string | null
          unit_cents: number | null
          work_order_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          quantity?: number
          service_id?: string | null
          unit_cents?: number | null
          work_order_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          quantity?: number
          service_id?: string | null
          unit_cents?: number | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_order_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_service_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_services_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_work_orders: {
        Row: {
          assigned_employee_id: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          created_by_user_id: string | null
          description: string | null
          id: string
          latitude: number | null
          longitude: number | null
          observation: string | null
          priority: string
          protocol: string
          scheduled_at: string | null
          service_id: string | null
          signature_data: string | null
          signature_name: string | null
          site_id: string | null
          sla_deadline: string | null
          started_at: string | null
          status: string
          technical_opinion: string | null
          total_cents: number
          type: string
          updated_at: string
        }
        Insert: {
          assigned_employee_id?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          observation?: string | null
          priority?: string
          protocol: string
          scheduled_at?: string | null
          service_id?: string | null
          signature_data?: string | null
          signature_name?: string | null
          site_id?: string | null
          sla_deadline?: string | null
          started_at?: string | null
          status?: string
          technical_opinion?: string | null
          total_cents?: number
          type?: string
          updated_at?: string
        }
        Update: {
          assigned_employee_id?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          observation?: string | null
          priority?: string
          protocol?: string
          scheduled_at?: string | null
          service_id?: string | null
          signature_data?: string | null
          signature_name?: string | null
          site_id?: string | null
          sla_deadline?: string | null
          started_at?: string | null
          status?: string
          technical_opinion?: string | null
          total_cents?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_orders_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_orders_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_service_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_orders_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_admission_processes: {
        Row: {
          actual_start: string | null
          checklist: Json
          created_at: string
          employee_id: string | null
          expected_start: string | null
          id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_start?: string | null
          checklist?: Json
          created_at?: string
          employee_id?: string | null
          expected_start?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_start?: string | null
          checklist?: Json
          created_at?: string
          employee_id?: string | null
          expected_start?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_admission_processes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          employee_id: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          employee_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          employee_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_benefit_requests: {
        Row: {
          birth_date: string | null
          carrier: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          daily_cents: number | null
          days: number | null
          depart_at: string | null
          destination: string | null
          employee_id: string | null
          employee_name: string
          estimated_cents: number
          filial: string | null
          id: string
          is_deleted: boolean
          kind: string
          meal_type: string | null
          origin: string | null
          over_budget_reason: string | null
          paid_cents: number
          pnr: string | null
          reason: string | null
          ref_month: string | null
          return_at: string | null
          rg: string | null
          status: string
          total_cents: number | null
          travel_mode: string | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          carrier?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          daily_cents?: number | null
          days?: number | null
          depart_at?: string | null
          destination?: string | null
          employee_id?: string | null
          employee_name: string
          estimated_cents?: number
          filial?: string | null
          id?: string
          is_deleted?: boolean
          kind: string
          meal_type?: string | null
          origin?: string | null
          over_budget_reason?: string | null
          paid_cents?: number
          pnr?: string | null
          reason?: string | null
          ref_month?: string | null
          return_at?: string | null
          rg?: string | null
          status?: string
          total_cents?: number | null
          travel_mode?: string | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          carrier?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          daily_cents?: number | null
          days?: number | null
          depart_at?: string | null
          destination?: string | null
          employee_id?: string | null
          employee_name?: string
          estimated_cents?: number
          filial?: string | null
          id?: string
          is_deleted?: boolean
          kind?: string
          meal_type?: string | null
          origin?: string | null
          over_budget_reason?: string | null
          paid_cents?: number
          pnr?: string | null
          reason?: string | null
          ref_month?: string | null
          return_at?: string | null
          rg?: string | null
          status?: string
          total_cents?: number | null
          travel_mode?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_benefit_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_benefit_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_departments: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rh_employee_access: {
        Row: {
          access_enabled: boolean
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          login_identifier: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_enabled?: boolean
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          login_identifier?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_enabled?: boolean
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          login_identifier?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_access_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_access_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employee_advances: {
        Row: {
          advance_type: string
          amount_cents: number
          authorized: boolean
          competence: string
          created_at: string
          created_by: string | null
          description: string
          employee_id: string
          id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          advance_type?: string
          amount_cents: number
          authorized?: boolean
          competence: string
          created_at?: string
          created_by?: string | null
          description: string
          employee_id: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          advance_type?: string
          amount_cents?: number
          authorized?: boolean
          competence?: string
          created_at?: string
          created_by?: string | null
          description?: string
          employee_id?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_advances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_advances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employee_contracts: {
        Row: {
          admission_date: string | null
          contract_type: string
          created_at: string
          department_id: string | null
          employee_id: string
          id: string
          is_current: boolean
          notes: string | null
          position_id: string | null
          salary_cents: number | null
          salary_effective_from: string | null
          termination_date: string | null
          updated_at: string
          weekly_hours: number | null
          work_regime: string | null
          work_shift: string | null
        }
        Insert: {
          admission_date?: string | null
          contract_type?: string
          created_at?: string
          department_id?: string | null
          employee_id: string
          id?: string
          is_current?: boolean
          notes?: string | null
          position_id?: string | null
          salary_cents?: number | null
          salary_effective_from?: string | null
          termination_date?: string | null
          updated_at?: string
          weekly_hours?: number | null
          work_regime?: string | null
          work_shift?: string | null
        }
        Update: {
          admission_date?: string | null
          contract_type?: string
          created_at?: string
          department_id?: string | null
          employee_id?: string
          id?: string
          is_current?: boolean
          notes?: string | null
          position_id?: string | null
          salary_cents?: number | null
          salary_effective_from?: string | null
          termination_date?: string | null
          updated_at?: string
          weekly_hours?: number | null
          work_regime?: string | null
          work_shift?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_contracts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "rh_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_contracts_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "rh_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employee_dependents: {
        Row: {
          birth_date: string | null
          cpf: string | null
          created_at: string
          employee_id: string
          full_name: string
          id: string
          is_active: boolean
          is_health_dependent: boolean
          is_ir_dependent: boolean
          relationship: string | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          employee_id: string
          full_name: string
          id?: string
          is_active?: boolean
          is_health_dependent?: boolean
          is_ir_dependent?: boolean
          relationship?: string | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          employee_id?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_health_dependent?: boolean
          is_ir_dependent?: boolean
          relationship?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_dependents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employee_documents: {
        Row: {
          created_at: string
          document_number: string | null
          document_type: string
          employee_id: string
          expires_at: string | null
          file_name: string | null
          id: string
          issued_at: string | null
          metadata: Json
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_number?: string | null
          document_type: string
          employee_id: string
          expires_at?: string | null
          file_name?: string | null
          id?: string
          issued_at?: string | null
          metadata?: Json
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_number?: string | null
          document_type?: string
          employee_id?: string
          expires_at?: string | null
          file_name?: string | null
          id?: string
          issued_at?: string | null
          metadata?: Json
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employee_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          employee_id: string
          event_date: string
          event_type: string
          id: string
          payload: Json
          status: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          employee_id: string
          event_date?: string
          event_type: string
          id?: string
          payload?: Json
          status?: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          employee_id?: string
          event_date?: string
          event_type?: string
          id?: string
          payload?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employee_requests: {
        Row: {
          employee_id: string
          id: string
          payload: Json
          request_type: string
          requested_at: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          employee_id: string
          id?: string
          payload?: Json
          request_type: string
          requested_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          employee_id?: string
          id?: string
          payload?: Json
          request_type?: string
          requested_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employee_schedule_assignments: {
        Row: {
          created_at: string
          employee_id: string
          ends_on: string | null
          id: string
          schedule_id: string
          starts_on: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          ends_on?: string | null
          id?: string
          schedule_id: string
          starts_on: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          ends_on?: string | null
          id?: string
          schedule_id?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employee_schedule_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employee_schedule_assignments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "rh_work_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_employees: {
        Row: {
          benefit_configured: boolean
          benefit_type: string
          created_at: string
          dbs_control_access_enabled: boolean
          fare_cents: number
          ficha_file_name: string | null
          ficha_storage_path: string | null
          full_name: string
          id: string
          is_active: boolean
          ponto_access_enabled: boolean
          ponto_almoco_fim_previsto: string | null
          ponto_almoco_inicio_previsto: string | null
          ponto_base_lat: number | null
          ponto_base_lng: number | null
          ponto_entrada_prevista: string | null
          ponto_portal_user_id: string | null
          ponto_raio_m: number
          ponto_saida_prevista: string | null
          registration_data: Json
          registry_employee_id: string | null
          trips_per_day: number
          unit: string
          updated_at: string
        }
        Insert: {
          benefit_configured?: boolean
          benefit_type: string
          created_at?: string
          dbs_control_access_enabled?: boolean
          fare_cents: number
          ficha_file_name?: string | null
          ficha_storage_path?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          ponto_access_enabled?: boolean
          ponto_almoco_fim_previsto?: string | null
          ponto_almoco_inicio_previsto?: string | null
          ponto_base_lat?: number | null
          ponto_base_lng?: number | null
          ponto_entrada_prevista?: string | null
          ponto_portal_user_id?: string | null
          ponto_raio_m?: number
          ponto_saida_prevista?: string | null
          registration_data?: Json
          registry_employee_id?: string | null
          trips_per_day?: number
          unit: string
          updated_at?: string
        }
        Update: {
          benefit_configured?: boolean
          benefit_type?: string
          created_at?: string
          dbs_control_access_enabled?: boolean
          fare_cents?: number
          ficha_file_name?: string | null
          ficha_storage_path?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          ponto_access_enabled?: boolean
          ponto_almoco_fim_previsto?: string | null
          ponto_almoco_inicio_previsto?: string | null
          ponto_base_lat?: number | null
          ponto_base_lng?: number | null
          ponto_entrada_prevista?: string | null
          ponto_portal_user_id?: string | null
          ponto_raio_m?: number
          ponto_saida_prevista?: string | null
          registration_data?: Json
          registry_employee_id?: string | null
          trips_per_day?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employees_ponto_portal_user_id_fkey"
            columns: ["ponto_portal_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employees_registry_employee_id_fkey"
            columns: ["registry_employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_leave_records: {
        Row: {
          created_at: string
          document_id: string | null
          employee_id: string
          end_date: string | null
          id: string
          leave_type: string
          notes: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          employee_id: string
          end_date?: string | null
          id?: string
          leave_type: string
          notes?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          employee_id?: string
          end_date?: string | null
          id?: string
          leave_type?: string
          notes?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_leave_records_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "rh_employee_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_leave_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_medical_exams: {
        Row: {
          created_at: string
          document_id: string | null
          employee_id: string
          exam_date: string
          exam_type: string
          id: string
          notes: string | null
          provider: string | null
          result: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          employee_id: string
          exam_date: string
          exam_type: string
          id?: string
          notes?: string | null
          provider?: string | null
          result?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string | null
          employee_id?: string
          exam_date?: string
          exam_type?: string
          id?: string
          notes?: string | null
          provider?: string | null
          result?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_medical_exams_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "rh_employee_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_medical_exams_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_payroll_items: {
        Row: {
          amount_cents: number
          code: string | null
          created_at: string
          description: string
          employee_id: string
          id: string
          item_type: string
          period_id: string
          quantity: number | null
          rate: number | null
          reference: Json
        }
        Insert: {
          amount_cents?: number
          code?: string | null
          created_at?: string
          description: string
          employee_id: string
          id?: string
          item_type: string
          period_id: string
          quantity?: number | null
          rate?: number | null
          reference?: Json
        }
        Update: {
          amount_cents?: number
          code?: string | null
          created_at?: string
          description?: string
          employee_id?: string
          id?: string
          item_type?: string
          period_id?: string
          quantity?: number | null
          rate?: number | null
          reference?: Json
        }
        Relationships: [
          {
            foreignKeyName: "rh_payroll_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_payroll_items_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "rh_payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_payroll_periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          competence: string
          created_at: string
          id: string
          notes: string | null
          opened_at: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          competence: string
          created_at?: string
          id?: string
          notes?: string | null
          opened_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          competence?: string
          created_at?: string
          id?: string
          notes?: string | null
          opened_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_payroll_periods_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_payroll_rules: {
        Row: {
          code: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          name: string
          parameters: Json
          rule_type: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          name: string
          parameters?: Json
          rule_type: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          name?: string
          parameters?: Json
          rule_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      rh_payroll_runs: {
        Row: {
          calculated_at: string
          discount_cents: number
          employee_id: string
          fgts_base_cents: number
          gross_cents: number
          id: string
          inss_base_cents: number
          irrf_base_cents: number
          net_cents: number
          period_id: string
          status: string
        }
        Insert: {
          calculated_at?: string
          discount_cents?: number
          employee_id: string
          fgts_base_cents?: number
          gross_cents?: number
          id?: string
          inss_base_cents?: number
          irrf_base_cents?: number
          net_cents?: number
          period_id: string
          status?: string
        }
        Update: {
          calculated_at?: string
          discount_cents?: number
          employee_id?: string
          fgts_base_cents?: number
          gross_cents?: number
          id?: string
          inss_base_cents?: number
          irrf_base_cents?: number
          net_cents?: number
          period_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_payroll_runs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_payroll_runs_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "rh_payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_ponto_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          details: Json
          employee_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          employee_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          employee_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_ponto_audit_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_ponto_audit_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_ponto_records: {
        Row: {
          created_at: string
          created_by: string | null
          distance_m: number | null
          employee_id: string
          gps_accuracy_m: number | null
          id: string
          inside_radius: boolean | null
          latitude: number | null
          longitude: number | null
          note: string | null
          photo_data: string | null
          punch_type: string
          punched_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          distance_m?: number | null
          employee_id: string
          gps_accuracy_m?: number | null
          id?: string
          inside_radius?: boolean | null
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          photo_data?: string | null
          punch_type: string
          punched_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          distance_m?: number | null
          employee_id?: string
          gps_accuracy_m?: number | null
          id?: string
          inside_radius?: boolean | null
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          photo_data?: string | null
          punch_type?: string
          punched_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_ponto_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_ponto_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_positions: {
        Row: {
          cbo: string | null
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          cbo?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          cbo?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      rh_request_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          is_deleted: boolean
          request_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_deleted?: boolean
          request_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          is_deleted?: boolean
          request_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_request_attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "rh_benefit_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_request_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_request_audit: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          request_id: string
          status_from: string | null
          status_to: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          request_id: string
          status_from?: string | null
          status_to?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          request_id?: string
          status_from?: string | null
          status_to?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_request_audit_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "rh_benefit_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_request_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_safety_events: {
        Row: {
          created_at: string
          details: Json
          employee_id: string
          event_date: string
          event_type: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          employee_id: string
          event_date: string
          event_type: string
          id?: string
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          employee_id?: string
          event_date?: string
          event_type?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_safety_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_termination_processes: {
        Row: {
          checklist: Json
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          reason: string | null
          status: string
          termination_date: string | null
          updated_at: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          reason?: string | null
          status?: string
          termination_date?: string | null
          updated_at?: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          reason?: string | null
          status?: string
          termination_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_termination_processes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_time_adjustments: {
        Row: {
          adjustment_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_id: string
          id: string
          minutes: number
          reason: string
          reference_date: string
          requested_by: string | null
          status: string
        }
        Insert: {
          adjustment_type: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id: string
          id?: string
          minutes?: number
          reason: string
          reference_date: string
          requested_by?: string | null
          status?: string
        }
        Update: {
          adjustment_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          minutes?: number
          reason?: string
          reference_date?: string
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_time_adjustments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_time_adjustments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_time_adjustments_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_time_closures: {
        Row: {
          balance_minutes: number
          closed_at: string | null
          closed_by: string | null
          competence: string
          employee_id: string
          id: string
          missing_minutes: number
          overtime_minutes: number
          status: string
        }
        Insert: {
          balance_minutes?: number
          closed_at?: string | null
          closed_by?: string | null
          competence: string
          employee_id: string
          id?: string
          missing_minutes?: number
          overtime_minutes?: number
          status?: string
        }
        Update: {
          balance_minutes?: number
          closed_at?: string | null
          closed_by?: string | null
          competence?: string
          employee_id?: string
          id?: string
          missing_minutes?: number
          overtime_minutes?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_time_closures_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_time_closures_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
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
      rh_vacation_periods: {
        Row: {
          acquisition_end: string
          acquisition_start: string
          concession_deadline: string | null
          created_at: string
          days_earned: number
          days_used: number
          employee_id: string
          id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          acquisition_end: string
          acquisition_start: string
          concession_deadline?: string | null
          created_at?: string
          days_earned?: number
          days_used?: number
          employee_id: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          acquisition_end?: string
          acquisition_start?: string
          concession_deadline?: string | null
          created_at?: string
          days_earned?: number
          days_used?: number
          employee_id?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_vacation_periods_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_vacation_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          days: number
          employee_id: string
          end_date: string
          id: string
          notes: string | null
          requested_at: string
          start_date: string
          status: string
          vacation_period_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          days: number
          employee_id: string
          end_date: string
          id?: string
          notes?: string | null
          requested_at?: string
          start_date: string
          status?: string
          vacation_period_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          days?: number
          employee_id?: string
          end_date?: string
          id?: string
          notes?: string | null
          requested_at?: string
          start_date?: string
          status?: string
          vacation_period_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rh_vacation_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_vacation_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "rh_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_vacation_requests_vacation_period_id_fkey"
            columns: ["vacation_period_id"]
            isOneToOne: false
            referencedRelation: "rh_vacation_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      rh_work_schedules: {
        Row: {
          break_minutes: number
          created_at: string
          friday_end: string | null
          friday_start: string | null
          id: string
          is_active: boolean
          monday_end: string | null
          monday_start: string | null
          name: string
          saturday_end: string | null
          saturday_start: string | null
          sunday_end: string | null
          sunday_start: string | null
          thursday_end: string | null
          thursday_start: string | null
          tolerance_minutes: number
          tuesday_end: string | null
          tuesday_start: string | null
          updated_at: string
          wednesday_end: string | null
          wednesday_start: string | null
          weekly_hours: number | null
        }
        Insert: {
          break_minutes?: number
          created_at?: string
          friday_end?: string | null
          friday_start?: string | null
          id?: string
          is_active?: boolean
          monday_end?: string | null
          monday_start?: string | null
          name: string
          saturday_end?: string | null
          saturday_start?: string | null
          sunday_end?: string | null
          sunday_start?: string | null
          thursday_end?: string | null
          thursday_start?: string | null
          tolerance_minutes?: number
          tuesday_end?: string | null
          tuesday_start?: string | null
          updated_at?: string
          wednesday_end?: string | null
          wednesday_start?: string | null
          weekly_hours?: number | null
        }
        Update: {
          break_minutes?: number
          created_at?: string
          friday_end?: string | null
          friday_start?: string | null
          id?: string
          is_active?: boolean
          monday_end?: string | null
          monday_start?: string | null
          name?: string
          saturday_end?: string | null
          saturday_start?: string | null
          sunday_end?: string | null
          sunday_start?: string | null
          thursday_end?: string | null
          thursday_start?: string | null
          tolerance_minutes?: number
          tuesday_end?: string | null
          tuesday_start?: string | null
          updated_at?: string
          wednesday_end?: string | null
          wednesday_start?: string | null
          weekly_hours?: number | null
        }
        Relationships: []
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
      treasury_snapshots: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          owner_user_id: string | null
          scope_key: string
          state: Json
          state_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          owner_user_id?: string | null
          scope_key: string
          state: Json
          state_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          owner_user_id?: string | null
          scope_key?: string
          state?: Json
          state_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treasury_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_snapshots_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_snapshots_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      dbs_my_employee_ids: { Args: never; Returns: string[] }
      dbs_my_work_order_ids: { Args: never; Returns: string[] }
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
        | "COLABORADOR"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
        "COLABORADOR",
      ],
    },
  },
} as const
