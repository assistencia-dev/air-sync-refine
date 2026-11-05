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
      dbs_control_backup_manifests: {
        Row: {
          created_at: string
          document_buckets: string[]
          document_count: number
          document_manifest: Json
          generated_at: string
          id: string
          manifest_path: string
          object_path: string
          snapshot_sha256: string
          status: string
          table_counts: Json
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          document_buckets?: string[]
          document_count?: number
          document_manifest?: Json
          generated_at: string
          id?: string
          manifest_path: string
          object_path: string
          snapshot_sha256: string
          status?: string
          table_counts?: Json
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          document_buckets?: string[]
          document_count?: number
          document_manifest?: Json
          generated_at?: string
          id?: string
          manifest_path?: string
          object_path?: string
          snapshot_sha256?: string
          status?: string
          table_counts?: Json
          verified_at?: string | null
        }
        Relationships: []
      }
      dbs_control_base_clients: {
        Row: {
          base_id: string
          client_id: string
          created_at: string
          created_by_user_id: string | null
        }
        Insert: {
          base_id: string
          client_id: string
          created_at?: string
          created_by_user_id?: string | null
        }
        Update: {
          base_id?: string
          client_id?: string
          created_at?: string
          created_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_base_clients_base_id_fkey"
            columns: ["base_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_base_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_base_clients_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_bases: {
        Row: {
          address_json: Json
          code: string | null
          company_id: string | null
          created_at: string
          created_by_user_id: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          address_json?: Json
          code?: string | null
          company_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          address_json?: Json
          code?: string | null
          company_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_bases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_bases_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      dbs_control_entity_records: {
        Row: {
          created_at: string
          deleted_at: string | null
          entity_type: string
          id: string
          idempotency_key: string | null
          payload: Json
          record_key: string
          scope_key: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          entity_type: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          record_key: string
          scope_key: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          entity_type?: string
          id?: string
          idempotency_key?: string | null
          payload?: Json
          record_key?: string
          scope_key?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_entity_records_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      dbs_control_external_refs: {
        Row: {
          company_id: string
          created_at: string
          entity_type: string
          external_id: string
          id: string
          local_id: string | null
          metadata: Json
          provider: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          entity_type: string
          external_id: string
          id?: string
          local_id?: string | null
          metadata?: Json
          provider?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          entity_type?: string
          external_id?: string
          id?: string
          local_id?: string | null
          metadata?: Json
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_external_refs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_integrations: {
        Row: {
          api_key: string
          company_id: string
          created_at: string
          created_by_user_id: string | null
          id: string
          last_sync_at: string | null
          last_sync_status: string | null
          last_sync_summary: Json
          last_test_at: string | null
          provider: string
          status: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          api_key: string
          company_id: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_status?: string | null
          last_sync_summary?: Json
          last_test_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          api_key?: string
          company_id?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_status?: string | null
          last_sync_summary?: Json
          last_test_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_integrations_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_integrations_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_inventory_commands: {
        Row: {
          actor_user_id: string | null
          command_type: string
          created_at: string
          id: string
          idempotency_key: string
          payload_hash: string
          result: Json
          scope_key: string
        }
        Insert: {
          actor_user_id?: string | null
          command_type: string
          created_at?: string
          id?: string
          idempotency_key: string
          payload_hash: string
          result: Json
          scope_key: string
        }
        Update: {
          actor_user_id?: string | null
          command_type?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          payload_hash?: string
          result?: Json
          scope_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_inventory_commands_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_inventory_movements: {
        Row: {
          balance_after: number
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          metadata: Json
          movement_type: string
          part_id: string
          purchase_id: string | null
          purchase_item_id: string | null
          quantity_delta: number
          scope_key: string
          unit_cost_cents: number
          work_order_id: string | null
          work_order_part_id: string | null
        }
        Insert: {
          balance_after?: number
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          movement_type: string
          part_id: string
          purchase_id?: string | null
          purchase_item_id?: string | null
          quantity_delta: number
          scope_key: string
          unit_cost_cents?: number
          work_order_id?: string | null
          work_order_part_id?: string | null
        }
        Update: {
          balance_after?: number
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          movement_type?: string
          part_id?: string
          purchase_id?: string | null
          purchase_item_id?: string | null
          quantity_delta?: number
          scope_key?: string
          unit_cost_cents?: number
          work_order_id?: string | null
          work_order_part_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_inventory_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_inventory_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_inventory_movements_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_inventory_movements_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_inventory_movements_purchase_item_id_fkey"
            columns: ["purchase_item_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_purchase_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_inventory_movements_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_inventory_movements_work_order_part_id_fkey"
            columns: ["work_order_part_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_order_parts"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_inventory_outbox: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string
          attempts: number
          available_at: string
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          payload: Json
          published_at: string | null
          scope_key: string
          status: string
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type: string
          attempts?: number
          available_at?: string
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload?: Json
          published_at?: string | null
          scope_key: string
          status?: string
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string
          attempts?: number
          available_at?: string
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload?: Json
          published_at?: string | null
          scope_key?: string
          status?: string
        }
        Relationships: []
      }
      dbs_control_legacy_id_map: {
        Row: {
          canonical_id: string
          created_at: string
          entity_type: string
          legacy_key: string
          scope_key: string
        }
        Insert: {
          canonical_id: string
          created_at?: string
          entity_type: string
          legacy_key: string
          scope_key: string
        }
        Update: {
          canonical_id?: string
          created_at?: string
          entity_type?: string
          legacy_key?: string
          scope_key?: string
        }
        Relationships: []
      }
      dbs_control_outbox: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string
          aggregate_version: number
          attempts: number
          available_at: string
          command_id: string | null
          company_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          payload: Json
          published_at: string | null
          status: string
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type: string
          aggregate_version: number
          attempts?: number
          available_at?: string
          command_id?: string | null
          company_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload?: Json
          published_at?: string | null
          status?: string
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string
          aggregate_version?: number
          attempts?: number
          available_at?: string
          command_id?: string | null
          company_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload?: Json
          published_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_outbox_aggregate_id_fkey"
            columns: ["aggregate_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_outbox_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_sync_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_outbox_dlq: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string
          attempts: number
          created_at: string
          event_type: string
          failed_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          outbox_id: string
          payload: Json
          resolution_note: string | null
          resolved_at: string | null
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type: string
          attempts?: number
          created_at?: string
          event_type: string
          failed_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          outbox_id: string
          payload?: Json
          resolution_note?: string | null
          resolved_at?: string | null
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string
          attempts?: number
          created_at?: string
          event_type?: string
          failed_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          outbox_id?: string
          payload?: Json
          resolution_note?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_outbox_dlq_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: true
            referencedRelation: "dbs_control_outbox"
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
          reserved_quantity: number
          sale_cents: number | null
          sku: string | null
          status: string
          stock_quantity: number
          updated_at: string
          version: number
        }
        Insert: {
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          reserved_quantity?: number
          sale_cents?: number | null
          sku?: string | null
          status?: string
          stock_quantity?: number
          updated_at?: string
          version?: number
        }
        Update: {
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          reserved_quantity?: number
          sale_cents?: number | null
          sku?: string | null
          status?: string
          stock_quantity?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      dbs_control_purchase_items: {
        Row: {
          created_at: string
          id: string
          line_no: number
          metadata: Json
          part_id: string
          purchase_id: string
          quantity: number
          total_cents: number
          unit_cost_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_no: number
          metadata?: Json
          part_id: string
          purchase_id: string
          quantity: number
          total_cents: number
          unit_cost_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          line_no?: number
          metadata?: Json
          part_id?: string
          purchase_id?: string
          quantity?: number
          total_cents?: number
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_purchase_items_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_purchases: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          document_number: string | null
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          legacy_key: string | null
          metadata: Json
          payment_status: string
          purchase_date: string
          received_by: string | null
          scope_key: string
          status: string
          supplier_name: string
          total_cents: number
          updated_at: string
          version: number
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          document_number?: string | null
          id?: string
          idempotency_key: string
          ledger_entry_id?: string | null
          legacy_key?: string | null
          metadata?: Json
          payment_status?: string
          purchase_date?: string
          received_by?: string | null
          scope_key: string
          status?: string
          supplier_name: string
          total_cents?: number
          updated_at?: string
          version?: number
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          document_number?: string | null
          id?: string
          idempotency_key?: string
          ledger_entry_id?: string | null
          legacy_key?: string | null
          metadata?: Json
          payment_status?: string
          purchase_date?: string
          received_by?: string | null
          scope_key?: string
          status?: string
          supplier_name?: string
          total_cents?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_purchases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_purchases_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_purchases_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_reservation_batches: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          scope_key: string
          work_order_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          scope_key: string
          work_order_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          scope_key?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_reservation_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_reservation_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_reservation_batches_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_reservation_consumptions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          scope_key: string
          total_cost_cents: number
          work_order_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          ledger_entry_id?: string | null
          scope_key: string
          total_cost_cents?: number
          work_order_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          ledger_entry_id?: string | null
          scope_key?: string
          total_cost_cents?: number
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_reservation_consumptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_reservation_consumptions_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_reservation_consumptions_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: true
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_sale_items: {
        Row: {
          cost_total_cents: number
          created_at: string
          id: string
          part_id: string
          quantity: number
          sale_id: string
          total_cents: number
          unit_cost_cents: number
          unit_sale_cents: number
        }
        Insert: {
          cost_total_cents: number
          created_at?: string
          id?: string
          part_id: string
          quantity: number
          sale_id: string
          total_cents: number
          unit_cost_cents: number
          unit_sale_cents: number
        }
        Update: {
          cost_total_cents?: number
          created_at?: string
          id?: string
          part_id?: string
          quantity?: number
          sale_id?: string
          total_cents?: number
          unit_cost_cents?: number
          unit_sale_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_sale_items_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_sale_settlements: {
        Row: {
          amount_cents: number
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          payment_method: string
          received_at: string
          received_by: string | null
          sale_id: string
          scope_key: string
        }
        Insert: {
          amount_cents: number
          id?: string
          idempotency_key: string
          ledger_entry_id?: string | null
          payment_method: string
          received_at?: string
          received_by?: string | null
          sale_id: string
          scope_key: string
        }
        Update: {
          amount_cents?: number
          id?: string
          idempotency_key?: string
          ledger_entry_id?: string | null
          payment_method?: string
          received_at?: string
          received_by?: string | null
          sale_id?: string
          scope_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_sale_settlements_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sale_settlements_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sale_settlements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_sales: {
        Row: {
          client_id: string | null
          cogs_entry_id: string | null
          company_id: string | null
          cost_cents: number
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          metadata: Json
          received_cents: number
          revenue_entry_id: string | null
          sale_number: string | null
          scope_key: string
          status: string
          total_cents: number
          updated_at: string
          version: number
        }
        Insert: {
          client_id?: string | null
          cogs_entry_id?: string | null
          company_id?: string | null
          cost_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          received_cents?: number
          revenue_entry_id?: string | null
          sale_number?: string | null
          scope_key: string
          status?: string
          total_cents?: number
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string | null
          cogs_entry_id?: string | null
          company_id?: string | null
          cost_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          received_cents?: number
          revenue_entry_id?: string | null
          sale_number?: string | null
          scope_key?: string
          status?: string
          total_cents?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sales_cogs_entry_id_fkey"
            columns: ["cogs_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sales_revenue_entry_id_fkey"
            columns: ["revenue_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
        ]
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
      dbs_control_snapshot_history: {
        Row: {
          archived_at: string
          archived_by: string | null
          id: number
          scope_key: string
          source_updated_at: string
          state: Json
          state_version: number
        }
        Insert: {
          archived_at?: string
          archived_by?: string | null
          id?: never
          scope_key: string
          source_updated_at: string
          state: Json
          state_version?: number
        }
        Update: {
          archived_at?: string
          archived_by?: string | null
          id?: never
          scope_key?: string
          source_updated_at?: string
          state?: Json
          state_version?: number
        }
        Relationships: []
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
      dbs_control_sync_commands: {
        Row: {
          actor_user_id: string | null
          aggregate_id: string | null
          aggregate_type: string
          applied_at: string | null
          company_id: string | null
          conflict_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          expected_version: number | null
          id: string
          idempotency_key: string
          payload: Json
          payload_hash: string
          result: Json
          status: string
        }
        Insert: {
          actor_user_id?: string | null
          aggregate_id?: string | null
          aggregate_type?: string
          applied_at?: string | null
          company_id?: string | null
          conflict_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          expected_version?: number | null
          id?: string
          idempotency_key: string
          payload?: Json
          payload_hash: string
          result?: Json
          status?: string
        }
        Update: {
          actor_user_id?: string | null
          aggregate_id?: string | null
          aggregate_type?: string
          applied_at?: string | null
          company_id?: string | null
          conflict_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          expected_version?: number | null
          id?: string
          idempotency_key?: string
          payload?: Json
          payload_hash?: string
          result?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_sync_commands_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sync_commands_aggregate_id_fkey"
            columns: ["aggregate_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sync_commands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_sync_metrics: {
        Row: {
          claimed_count: number
          created_at: string
          details: Json
          duration_ms: number | null
          failure_count: number
          id: string
          metric_name: string
          retry_count: number
          status: string
          success_count: number
          worker_id: string
        }
        Insert: {
          claimed_count?: number
          created_at?: string
          details?: Json
          duration_ms?: number | null
          failure_count?: number
          id?: string
          metric_name: string
          retry_count?: number
          status: string
          success_count?: number
          worker_id: string
        }
        Update: {
          claimed_count?: number
          created_at?: string
          details?: Json
          duration_ms?: number | null
          failure_count?: number
          id?: string
          metric_name?: string
          retry_count?: number
          status?: string
          success_count?: number
          worker_id?: string
        }
        Relationships: []
      }
      dbs_control_sync_runs: {
        Row: {
          company_id: string
          created_by_user_id: string | null
          errors: Json
          finished_at: string | null
          id: string
          mode: string
          provider: string
          started_at: string
          status: string
          summary: Json
        }
        Insert: {
          company_id: string
          created_by_user_id?: string | null
          errors?: Json
          finished_at?: string | null
          id?: string
          mode: string
          provider?: string
          started_at?: string
          status: string
          summary?: Json
        }
        Update: {
          company_id?: string
          created_by_user_id?: string | null
          errors?: Json
          finished_at?: string | null
          id?: string
          mode?: string
          provider?: string
          started_at?: string
          status?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_sync_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_sync_runs_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
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
          idempotency_key: string | null
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
          idempotency_key?: string | null
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
          idempotency_key?: string | null
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
      dbs_control_work_order_financials: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          metadata: Json
          parts_cost_cents: number
          revenue_cents: number
          revenue_entry_id: string | null
          revenue_reversal_entry_id: string | null
          scope_key: string
          status: string
          updated_at: string
          version: number
          work_order_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          parts_cost_cents?: number
          revenue_cents?: number
          revenue_entry_id?: string | null
          revenue_reversal_entry_id?: string | null
          scope_key: string
          status?: string
          updated_at?: string
          version?: number
          work_order_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          parts_cost_cents?: number
          revenue_cents?: number
          revenue_entry_id?: string | null
          revenue_reversal_entry_id?: string | null
          scope_key?: string
          status?: string
          updated_at?: string
          version?: number
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_order_financial_revenue_reversal_entry_id_fkey"
            columns: ["revenue_reversal_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_financials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_financials_revenue_entry_id_fkey"
            columns: ["revenue_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_financials_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: true
            referencedRelation: "dbs_control_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dbs_control_work_order_parts: {
        Row: {
          consumption_status: string
          cost_cents: number
          created_at: string
          id: string
          idempotency_key: string | null
          part_id: string
          quantity: number
          unit_cents: number | null
          work_order_id: string
        }
        Insert: {
          consumption_status?: string
          cost_cents?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          part_id: string
          quantity: number
          unit_cents?: number | null
          work_order_id: string
        }
        Update: {
          consumption_status?: string
          cost_cents?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
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
      dbs_control_work_order_reservations: {
        Row: {
          batch_id: string
          company_id: string | null
          consumed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          part_id: string
          quantity: number
          released_at: string | null
          scope_key: string
          status: string
          unit_cost_cents: number
          updated_at: string
          version: number
          work_order_id: string
        }
        Insert: {
          batch_id: string
          company_id?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          part_id: string
          quantity: number
          released_at?: string | null
          scope_key: string
          status?: string
          unit_cost_cents: number
          updated_at?: string
          version?: number
          work_order_id: string
        }
        Update: {
          batch_id?: string
          company_id?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          part_id?: string
          quantity?: number
          released_at?: string | null
          scope_key?: string
          status?: string
          unit_cost_cents?: number
          updated_at?: string
          version?: number
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dbs_control_work_order_reservations_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_reservation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_reservations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_reservations_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dbs_control_work_order_reservations_work_order_id_fkey"
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
      dbs_control_work_order_status_catalog: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          is_terminal: boolean
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          is_terminal?: boolean
          label: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          is_terminal?: boolean
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      dbs_control_work_orders: {
        Row: {
          assigned_employee_id: string | null
          assinatura_path: string | null
          client_id: string
          completed_at: string | null
          completion_status_code: string | null
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          description: string | null
          diagnostico: string | null
          execution_checklist: Json
          geolocation_captured_at: string | null
          id: string
          idempotency_key: string | null
          latitude: number | null
          longitude: number | null
          observation: string | null
          priority: string
          protocol: string
          protocolo: string | null
          scheduled_at: string | null
          service_id: string | null
          servico_executado: string | null
          signature_data: string | null
          signature_name: string | null
          signature_path: string | null
          site_id: string | null
          sla_deadline: string | null
          started_at: string | null
          status: string
          technical_opinion: string | null
          total_cents: number
          type: string
          updated_at: string
          version: number
        }
        Insert: {
          assigned_employee_id?: string | null
          assinatura_path?: string | null
          client_id: string
          completed_at?: string | null
          completion_status_code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          description?: string | null
          diagnostico?: string | null
          execution_checklist?: Json
          geolocation_captured_at?: string | null
          id?: string
          idempotency_key?: string | null
          latitude?: number | null
          longitude?: number | null
          observation?: string | null
          priority?: string
          protocol: string
          protocolo?: string | null
          scheduled_at?: string | null
          service_id?: string | null
          servico_executado?: string | null
          signature_data?: string | null
          signature_name?: string | null
          signature_path?: string | null
          site_id?: string | null
          sla_deadline?: string | null
          started_at?: string | null
          status?: string
          technical_opinion?: string | null
          total_cents?: number
          type?: string
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_employee_id?: string | null
          assinatura_path?: string | null
          client_id?: string
          completed_at?: string | null
          completion_status_code?: string | null
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          description?: string | null
          diagnostico?: string | null
          execution_checklist?: Json
          geolocation_captured_at?: string | null
          id?: string
          idempotency_key?: string | null
          latitude?: number | null
          longitude?: number | null
          observation?: string | null
          priority?: string
          protocol?: string
          protocolo?: string | null
          scheduled_at?: string | null
          service_id?: string | null
          servico_executado?: string | null
          signature_data?: string | null
          signature_name?: string | null
          signature_path?: string | null
          site_id?: string | null
          sla_deadline?: string | null
          started_at?: string | null
          status?: string
          technical_opinion?: string | null
          total_cents?: number
          type?: string
          updated_at?: string
          version?: number
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
      project: {
        Row: {
          created_at: string
          id: number
        }
        Insert: {
          created_at?: string
          id?: number
        }
        Update: {
          created_at?: string
          id?: number
        }
        Relationships: []
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
          source_request_id: string | null
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
          source_request_id?: string | null
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
          source_request_id?: string | null
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
          {
            foreignKeyName: "rh_employee_advances_source_request_id_fkey"
            columns: ["source_request_id"]
            isOneToOne: false
            referencedRelation: "rh_employee_requests"
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
          dbs_control_base_id: string | null
          dbs_control_can_issue_work_orders: boolean
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
          source_key: string | null
          source_system: string | null
          trips_per_day: number
          unit: string
          updated_at: string
        }
        Insert: {
          benefit_configured?: boolean
          benefit_type: string
          created_at?: string
          dbs_control_access_enabled?: boolean
          dbs_control_base_id?: string | null
          dbs_control_can_issue_work_orders?: boolean
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
          source_key?: string | null
          source_system?: string | null
          trips_per_day?: number
          unit: string
          updated_at?: string
        }
        Update: {
          benefit_configured?: boolean
          benefit_type?: string
          created_at?: string
          dbs_control_access_enabled?: boolean
          dbs_control_base_id?: string | null
          dbs_control_can_issue_work_orders?: boolean
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
          source_key?: string | null
          source_system?: string | null
          trips_per_day?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rh_employees_dbs_control_base_id_fkey"
            columns: ["dbs_control_base_id"]
            isOneToOne: false
            referencedRelation: "dbs_control_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employees_ponto_portal_user_id_fkey"
            columns: ["ponto_portal_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rh_employees_registry_employee_fk"
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
      treasury_accounts: {
        Row: {
          account_type: string
          code: string
          company_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          id: string
          is_active: boolean
          name: string
          scope_key: string
          updated_at: string
        }
        Insert: {
          account_type: string
          code: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          id?: string
          is_active?: boolean
          name: string
          scope_key: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          code?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          id?: string
          is_active?: boolean
          name?: string
          scope_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_ledger_entries: {
        Row: {
          company_id: string | null
          competence_date: string
          created_at: string
          created_by: string | null
          description: string
          document_date: string | null
          entry_type: string
          external_key: string | null
          id: string
          idempotency_key: string
          metadata: Json
          posted_at: string | null
          posted_by: string | null
          reversed_entry_id: string | null
          scope_key: string
          source_module: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          company_id?: string | null
          competence_date: string
          created_at?: string
          created_by?: string | null
          description: string
          document_date?: string | null
          entry_type?: string
          external_key?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          posted_at?: string | null
          posted_by?: string | null
          reversed_entry_id?: string | null
          scope_key: string
          source_module?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          company_id?: string | null
          competence_date?: string
          created_at?: string
          created_by?: string | null
          description?: string
          document_date?: string | null
          entry_type?: string
          external_key?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          posted_at?: string | null
          posted_by?: string | null
          reversed_entry_id?: string | null
          scope_key?: string
          source_module?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "treasury_ledger_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_ledger_entries_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_ledger_entries_reversed_entry_id_fkey"
            columns: ["reversed_entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_ledger_lines: {
        Row: {
          account_id: string
          credit_cents: number
          debit_cents: number
          entry_id: string
          id: string
          line_no: number
          memo: string | null
          metadata: Json
        }
        Insert: {
          account_id: string
          credit_cents?: number
          debit_cents?: number
          entry_id: string
          id?: string
          line_no: number
          memo?: string | null
          metadata?: Json
        }
        Update: {
          account_id?: string
          credit_cents?: number
          debit_cents?: number
          entry_id?: string
          id?: string
          line_no?: number
          memo?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "treasury_ledger_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "treasury_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_ledger_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_ledger_outbox: {
        Row: {
          attempts: number
          available_at: string
          company_id: string | null
          created_at: string
          entry_id: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          payload: Json
          published_at: string | null
          scope_key: string
          status: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          company_id?: string | null
          created_at?: string
          entry_id: string
          event_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          published_at?: string | null
          scope_key: string
          status?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          company_id?: string | null
          created_at?: string
          entry_id?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          published_at?: string | null
          scope_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_ledger_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_ledger_outbox_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "treasury_ledger_entries"
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
      treasury_viewer_access: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          owner_user_id: string
          viewer_user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          owner_user_id: string
          viewer_user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          owner_user_id?: string
          viewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_viewer_access_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_viewer_access_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_viewer_access_viewer_user_id_fkey"
            columns: ["viewer_user_id"]
            isOneToOne: true
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
      dbs_control_apply_opening_balance: {
        Args: { p_payload: Json }
        Returns: Json
      }
      dbs_control_apply_work_order_delta: {
        Args: { p_payload: Json }
        Returns: {
          changed_at: string
          command_id: string
          error_code: string
          error_message: string
          idempotency_key: string
          ok: boolean
          protocol: string
          status: string
          version: number
          work_order_id: string
        }[]
      }
      dbs_control_apply_work_order_delta_with_reservations: {
        Args: { p_payload: Json }
        Returns: {
          changed_at: string
          command_id: string
          error_code: string
          error_message: string
          idempotency_key: string
          ok: boolean
          protocol: string
          status: string
          version: number
          work_order_id: string
        }[]
      }
      dbs_control_apply_work_order_parts_in_tx: {
        Args: { p_parts: Json; p_work_order_id: string }
        Returns: undefined
      }
      dbs_control_claim_outbox: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          aggregate_id: string | null
          aggregate_type: string
          aggregate_version: number
          attempts: number
          available_at: string
          command_id: string | null
          company_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          payload: Json
          published_at: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "dbs_control_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dbs_control_complete_outbox: {
        Args: {
          p_error?: string
          p_outbox_id: string
          p_retry_seconds?: number
          p_success: boolean
          p_worker_id: string
        }
        Returns: boolean
      }
      dbs_control_consume_work_order_reservations: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_work_order_id: string
        }
        Returns: Json
      }
      dbs_control_consume_work_order_reservations_serialized: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_work_order_id: string
        }
        Returns: Json
      }
      dbs_control_create_part_sale: { Args: { p_payload: Json }; Returns: Json }
      dbs_control_dashboard_summary: {
        Args: { p_employee_id?: string }
        Returns: Json
      }
      dbs_control_dashboard_summary_scoped: {
        Args: {
          p_base_id?: string
          p_company_id?: string
          p_employee_id?: string
        }
        Returns: Json
      }
      dbs_control_inventory_health: { Args: never; Returns: Json }
      dbs_control_inventory_scope_for_work_order: {
        Args: { p_work_order_id: string }
        Returns: {
          company_id: string
          owner_user_id: string
          scope_key: string
        }[]
      }
      dbs_control_is_admin_actor: {
        Args: { p_actor: string }
        Returns: boolean
      }
      dbs_control_issue_work_order: {
        Args: { p_payload: Json }
        Returns: {
          changed_at: string
          command_id: string
          error_code: string
          error_message: string
          idempotency_key: string
          ok: boolean
          protocol: string
          status: string
          version: number
          work_order_id: string
        }[]
      }
      dbs_control_normalize_work_order_timestamps: {
        Args: { p_patch: Json }
        Returns: Json
      }
      dbs_control_receive_purchase: { Args: { p_payload: Json }; Returns: Json }
      dbs_control_receive_purchase_safe: {
        Args: { p_payload: Json }
        Returns: Json
      }
      dbs_control_release_work_order_reservation: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_reservation_id: string
        }
        Returns: Json
      }
      dbs_control_release_work_order_reservation_serialized: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_reservation_id: string
        }
        Returns: Json
      }
      dbs_control_reserve_work_order_parts: {
        Args: { p_payload: Json }
        Returns: Json
      }
      dbs_control_reserve_work_order_parts_serialized: {
        Args: { p_payload: Json }
        Returns: Json
      }
      dbs_control_save_snapshot_safe: {
        Args: { p_payload: Json }
        Returns: {
          state: Json
          state_version: number
          updated_at: string
        }[]
      }
      dbs_control_save_snapshot_safe_v2: {
        Args: { p_payload: Json }
        Returns: {
          state: Json
          state_version: number
          updated_at: string
        }[]
      }
      dbs_control_settle_part_sale: {
        Args: {
          p_actor_user_id: string
          p_amount_cents: number
          p_idempotency_key: string
          p_payment_method: string
          p_sale_id: string
        }
        Returns: Json
      }
      dbs_control_sync_health: { Args: never; Returns: Json }
      dbs_control_upsert_part: { Args: { p_payload: Json }; Returns: Json }
      dbs_control_upsert_part_safe: { Args: { p_payload: Json }; Returns: Json }
      dbs_my_employee_ids: { Args: never; Returns: string[] }
      is_admin: { Args: never; Returns: boolean }
      post_treasury_ledger_entry: {
        Args: {
          p_company_id: string
          p_competence_date: string
          p_created_by: string
          p_description: string
          p_document_date: string
          p_entry_type: string
          p_external_key: string
          p_idempotency_key: string
          p_lines: Json
          p_metadata: Json
          p_scope_key: string
          p_status: string
        }
        Returns: Json
      }
      process_work_order_update: {
        Args: { p_payload: Json }
        Returns: {
          changed_at: string
          command_id: string
          error_code: string
          error_message: string
          idempotency_key: string
          ok: boolean
          protocol: string
          status: string
          version: number
          work_order_id: string
        }[]
      }
      treasury_ledger_health: { Args: never; Returns: Json }
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
        | "FINANCEIRO_LEITURA"
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
        "FINANCEIRO_LEITURA",
      ],
    },
  },
} as const
