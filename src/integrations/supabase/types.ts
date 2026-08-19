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
      app_settings: {
        Row: {
          id: string
          family_name: string
          simulated_date: string | null
          created_at: string
          updated_at: string
          household_id: string
          monthly_income: number | null
          monthly_expenses: number | null
          retirement_year: number | null
          cpf_payout_age: number | null
          cpf_monthly_payout: number | null
          investment_growth_rate: number | null
          property_appreciation_rate: number | null
          inflation_rate: number | null
          planning_horizon_age: number | null
          mortgage_days: number
          insurance_days: number
          fd_days: number
          warranty_days: number
          onboarding_dismissed: boolean
        }
        Insert: {
          id?: string
          family_name?: string
          simulated_date?: string | null
          created_at?: string
          updated_at?: string
          household_id?: string
          monthly_income?: number | null
          monthly_expenses?: number | null
          retirement_year?: number | null
          cpf_payout_age?: number | null
          cpf_monthly_payout?: number | null
          investment_growth_rate?: number | null
          property_appreciation_rate?: number | null
          inflation_rate?: number | null
          planning_horizon_age?: number | null
          mortgage_days?: number
          insurance_days?: number
          fd_days?: number
          warranty_days?: number
          onboarding_dismissed?: boolean
        }
        Update: {
          id?: string
          family_name?: string
          simulated_date?: string | null
          created_at?: string
          updated_at?: string
          household_id?: string
          monthly_income?: number | null
          monthly_expenses?: number | null
          retirement_year?: number | null
          cpf_payout_age?: number | null
          cpf_monthly_payout?: number | null
          investment_growth_rate?: number | null
          property_appreciation_rate?: number | null
          inflation_rate?: number | null
          planning_horizon_age?: number | null
          mortgage_days?: number
          insurance_days?: number
          fd_days?: number
          warranty_days?: number
          onboarding_dismissed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      dismissed_dashboard_items: {
        Row: {
          id: string
          household_id: string
          source_type: string
          record_id: string
          label: string
          dismissed_at: string
          dismissed_date: string
          permanently_deleted: boolean
          reminder_id: string | null
        }
        Insert: {
          id?: string
          household_id: string
          source_type: string
          record_id: string
          label: string
          dismissed_at?: string
          dismissed_date?: string
          permanently_deleted?: boolean
          reminder_id?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          source_type?: string
          record_id?: string
          label?: string
          dismissed_at?: string
          dismissed_date?: string
          permanently_deleted?: boolean
          reminder_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_dashboard_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          id: string
          created_at: string
          user_id: string | null
          error_type: string
          error_message: string | null
          error_stack: string | null
          page_url: string | null
          component_name: string | null
          metadata: Json | null
        }
        Insert: {
          id?: string
          created_at?: string
          user_id?: string | null
          error_type: string
          error_message?: string | null
          error_stack?: string | null
          page_url?: string | null
          component_name?: string | null
          metadata?: Json | null
        }
        Update: {
          id?: string
          created_at?: string
          user_id?: string | null
          error_type?: string
          error_message?: string | null
          error_stack?: string | null
          page_url?: string | null
          component_name?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
      estate_checklist: {
        Row: {
          id: string
          household_id: string
          item_id: string
          checked: boolean
          external_url: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          household_id: string
          item_id: string
          checked?: boolean
          external_url?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          item_id?: string
          checked?: boolean
          external_url?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estate_checklist_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      gobag_items: {
        Row: {
          id: string
          label: string
          checked: boolean
          sort_order: number
          household_id: string
        }
        Insert: {
          id?: string
          label: string
          checked?: boolean
          sort_order?: number
          household_id?: string
        }
        Update: {
          id?: string
          label?: string
          checked?: boolean
          sort_order?: number
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gobag_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      health_conditions: {
        Row: {
          id: string
          member_id: string | null
          action_member_id: string | null
          name: string
          supplements: Json
          actions: Json
          details: string | null
          notes: string | null
          status: Database["public"]["Enums"]["record_status"]
          is_demo: boolean
          created_at: string
          updated_at: string
          household_id: string
        }
        Insert: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name: string
          supplements?: Json
          actions?: Json
          details?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
        }
        Update: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name?: string
          supplements?: Json
          actions?: Json
          details?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_conditions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_conditions_action_member_id_fkey"
            columns: ["action_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_conditions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_invites: {
        Row: {
          id: string
          household_id: string
          invited_email: string
          role: string
          invited_by_user_id: string
          token: string
          created_at: string
          expires_at: string
          accepted_at: string | null
          accepted_by_user_id: string | null
          cancelled_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          invited_email: string
          role?: string
          invited_by_user_id: string
          token: string
          created_at?: string
          expires_at?: string
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          cancelled_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          invited_email?: string
          role?: string
          invited_by_user_id?: string
          token?: string
          created_at?: string
          expires_at?: string
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          cancelled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "household_invites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_users: {
        Row: {
          household_id: string
          user_id: string
          role: string
          invited_by: string | null
          created_at: string
          has_seen_tour: boolean
        }
        Insert: {
          household_id: string
          user_id: string
          role?: string
          invited_by?: string | null
          created_at?: string
          has_seen_tour?: boolean
        }
        Update: {
          household_id?: string
          user_id?: string
          role?: string
          invited_by?: string | null
          created_at?: string
          has_seen_tour?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "household_users_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          id: string
          name: string
          slug: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_policies: {
        Row: {
          id: string
          member_id: string | null
          action_member_id: string | null
          name: string
          category: string | null
          provider: string | null
          policy_number: string | null
          premium: number | null
          frequency: string | null
          num_payments: number | null
          payment_end_date: string | null
          sum_assured: number | null
          start_date: string | null
          end_date: string | null
          next_due_date: string | null
          action: string | null
          notes: string | null
          status: Database["public"]["Enums"]["record_status"]
          is_demo: boolean
          created_at: string
          updated_at: string
          household_id: string
          currency: string | null
          payout_amount: number | null
          payout_start_date: string | null
          payout_frequency: string | null
          payout_end_date: string | null
          coverage: string | null
          beneficiary: string | null
          also_covers: string[]
          surrender_value: number | null
          surrender_value_date: string | null
          external_url: string | null
        }
        Insert: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name: string
          category?: string | null
          provider?: string | null
          policy_number?: string | null
          premium?: number | null
          frequency?: string | null
          num_payments?: number | null
          payment_end_date?: string | null
          sum_assured?: number | null
          start_date?: string | null
          end_date?: string | null
          next_due_date?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          currency?: string | null
          payout_amount?: number | null
          payout_start_date?: string | null
          payout_frequency?: string | null
          payout_end_date?: string | null
          coverage?: string | null
          beneficiary?: string | null
          also_covers?: string[]
          surrender_value?: number | null
          surrender_value_date?: string | null
          external_url?: string | null
        }
        Update: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name?: string
          category?: string | null
          provider?: string | null
          policy_number?: string | null
          premium?: number | null
          frequency?: string | null
          num_payments?: number | null
          payment_end_date?: string | null
          sum_assured?: number | null
          start_date?: string | null
          end_date?: string | null
          next_due_date?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          currency?: string | null
          payout_amount?: number | null
          payout_start_date?: string | null
          payout_frequency?: string | null
          payout_end_date?: string | null
          coverage?: string | null
          beneficiary?: string | null
          also_covers?: string[]
          surrender_value?: number | null
          surrender_value_date?: string | null
          external_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_policies_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_action_member_id_fkey"
            columns: ["action_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_folders: {
        Row: {
          id: string
          parent_id: string | null
          name: string
          photo_url: string | null
          sort_order: number
          created_at: string
          household_id: string
        }
        Insert: {
          id?: string
          parent_id?: string | null
          name: string
          photo_url?: string | null
          sort_order?: number
          created_at?: string
          household_id?: string
        }
        Update: {
          id?: string
          parent_id?: string | null
          name?: string
          photo_url?: string | null
          sort_order?: number
          created_at?: string
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "inventory_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_folders_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          id: string
          folder_id: string | null
          member_id: string | null
          name: string
          description: string | null
          quantity: number | null
          image_url: string | null
          notes: string | null
          created_at: string
          updated_at: string
          household_id: string
          category: string | null
          action: string | null
          warranty_date: string | null
          photo_url: string | null
        }
        Insert: {
          id?: string
          folder_id?: string | null
          member_id?: string | null
          name: string
          description?: string | null
          quantity?: number | null
          image_url?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          household_id?: string
          category?: string | null
          action?: string | null
          warranty_date?: string | null
          photo_url?: string | null
        }
        Update: {
          id?: string
          folder_id?: string | null
          member_id?: string | null
          name?: string
          description?: string | null
          quantity?: number | null
          image_url?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          household_id?: string
          category?: string | null
          action?: string | null
          warranty_date?: string | null
          photo_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "inventory_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string
        }
        Relationships: []
      }
      investments: {
        Row: {
          id: string
          member_id: string | null
          action_member_id: string | null
          name: string
          group_name: string | null
          cost_basis: number | null
          current_value: number | null
          projected_return_pct: number | null
          strategy: string | null
          action: string | null
          notes: string | null
          status: Database["public"]["Enums"]["record_status"]
          is_demo: boolean
          created_at: string
          updated_at: string
          household_id: string
          premium_start_date: string | null
          premium_frequency: string | null
          premium_end_date: string | null
          coverage: string | null
          premium_amount: number | null
          payout_amount: number | null
          payout_start_date: string | null
          payout_end_date: string | null
          payout_frequency: string | null
          currency: string | null
          last_updated: string | null
          external_url: string | null
        }
        Insert: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name: string
          group_name?: string | null
          cost_basis?: number | null
          current_value?: number | null
          projected_return_pct?: number | null
          strategy?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          premium_start_date?: string | null
          premium_frequency?: string | null
          premium_end_date?: string | null
          coverage?: string | null
          premium_amount?: number | null
          payout_amount?: number | null
          payout_start_date?: string | null
          payout_end_date?: string | null
          payout_frequency?: string | null
          currency?: string | null
          last_updated?: string | null
          external_url?: string | null
        }
        Update: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name?: string
          group_name?: string | null
          cost_basis?: number | null
          current_value?: number | null
          projected_return_pct?: number | null
          strategy?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          premium_start_date?: string | null
          premium_frequency?: string | null
          premium_end_date?: string | null
          coverage?: string | null
          premium_amount?: number | null
          payout_amount?: number | null
          payout_start_date?: string | null
          payout_end_date?: string | null
          payout_frequency?: string | null
          currency?: string | null
          last_updated?: string | null
          external_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_action_member_id_fkey"
            columns: ["action_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_rate_schedule: {
        Row: {
          id: string
          loan_id: string
          year_label: string
          rate: number | null
          rate_type: string | null
          sort_order: number
          household_id: string
        }
        Insert: {
          id?: string
          loan_id: string
          year_label: string
          rate?: number | null
          rate_type?: string | null
          sort_order?: number
          household_id?: string
        }
        Update: {
          id?: string
          loan_id?: string
          year_label?: string
          rate?: number | null
          rate_type?: string | null
          sort_order?: number
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_rate_schedule_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_rate_schedule_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          id: string
          member_id: string | null
          action_member_id: string | null
          bank: string
          purpose: string | null
          original_amount: number | null
          balance: number | null
          start_date: string | null
          term_years: number | null
          rate: number | null
          rate_label: string | null
          reprice_date: string | null
          action: string | null
          notes: string | null
          status: Database["public"]["Enums"]["record_status"]
          is_demo: boolean
          created_at: string
          updated_at: string
          household_id: string
          monthly_payment: number | null
          property_id: string | null
          loan_end_date: string | null
          external_url: string | null
          currency: string | null
        }
        Insert: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          bank: string
          purpose?: string | null
          original_amount?: number | null
          balance?: number | null
          start_date?: string | null
          term_years?: number | null
          rate?: number | null
          rate_label?: string | null
          reprice_date?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          monthly_payment?: number | null
          property_id?: string | null
          loan_end_date?: string | null
          external_url?: string | null
          currency?: string | null
        }
        Update: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          bank?: string
          purpose?: string | null
          original_amount?: number | null
          balance?: number | null
          start_date?: string | null
          term_years?: number | null
          rate?: number | null
          rate_label?: string | null
          reprice_date?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          monthly_payment?: number | null
          property_id?: string | null
          loan_end_date?: string | null
          external_url?: string | null
          currency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_action_member_id_fkey"
            columns: ["action_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          id: string
          name: string
          emoji: string | null
          color: string | null
          created_at: string
          short_name: string | null
          sort_order: number
          household_id: string
          birth_year: number | null
        }
        Insert: {
          id?: string
          name: string
          emoji?: string | null
          color?: string | null
          created_at?: string
          short_name?: string | null
          sort_order?: number
          household_id?: string
          birth_year?: number | null
        }
        Update: {
          id?: string
          name?: string
          emoji?: string | null
          color?: string | null
          created_at?: string
          short_name?: string | null
          sort_order?: number
          household_id?: string
          birth_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      other_assets: {
        Row: {
          id: string
          member_id: string | null
          action_member_id: string | null
          name: string
          category: string
          estimated_value: number | null
          last_updated: string | null
          notes: string | null
          action: string | null
          status: Database["public"]["Enums"]["record_status"]
          is_demo: boolean
          created_at: string
          updated_at: string
          household_id: string
          currency: string | null
        }
        Insert: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name: string
          category?: string
          estimated_value?: number | null
          last_updated?: string | null
          notes?: string | null
          action?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id: string
          currency?: string | null
        }
        Update: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name?: string
          category?: string
          estimated_value?: number | null
          last_updated?: string | null
          notes?: string | null
          action?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          currency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "other_assets_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "other_assets_action_member_id_fkey"
            columns: ["action_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "other_assets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_cashflow_events: {
        Row: {
          id: string
          household_id: string
          label: string
          year: number
          amount: number
          type: string
          created_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          label: string
          year: number
          amount: number
          type: string
          created_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          label?: string
          year?: number
          amount?: number
          type?: string
          created_at?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          id: string
          member_id: string | null
          action_member_id: string | null
          name: string
          address: string | null
          purpose: string | null
          currency: string
          purchase_price: number | null
          purchase_date: string | null
          current_value: number | null
          mortgage_bank: string | null
          mortgage_balance: number | null
          monthly_payment: number | null
          interest_rate: number | null
          rate_type: string | null
          fixed_rate_end: string | null
          monthly_rent: number | null
          market_rent: number | null
          cost_management: number | null
          cost_property_tax: number | null
          cost_fire_insurance: number | null
          cost_maintenance: number | null
          cost_other_label: string | null
          cost_other: number | null
          strategy: string | null
          action_note: string | null
          notes: string | null
          status: Database["public"]["Enums"]["record_status"]
          is_demo: boolean
          created_at: string
          updated_at: string
          household_id: string
          mortgage_end_date: string | null
          beneficiary: string | null
          external_url: string | null
        }
        Insert: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name: string
          address?: string | null
          purpose?: string | null
          currency?: string
          purchase_price?: number | null
          purchase_date?: string | null
          current_value?: number | null
          mortgage_bank?: string | null
          mortgage_balance?: number | null
          monthly_payment?: number | null
          interest_rate?: number | null
          rate_type?: string | null
          fixed_rate_end?: string | null
          monthly_rent?: number | null
          market_rent?: number | null
          cost_management?: number | null
          cost_property_tax?: number | null
          cost_fire_insurance?: number | null
          cost_maintenance?: number | null
          cost_other_label?: string | null
          cost_other?: number | null
          strategy?: string | null
          action_note?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          mortgage_end_date?: string | null
          beneficiary?: string | null
          external_url?: string | null
        }
        Update: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          name?: string
          address?: string | null
          purpose?: string | null
          currency?: string
          purchase_price?: number | null
          purchase_date?: string | null
          current_value?: number | null
          mortgage_bank?: string | null
          mortgage_balance?: number | null
          monthly_payment?: number | null
          interest_rate?: number | null
          rate_type?: string | null
          fixed_rate_end?: string | null
          monthly_rent?: number | null
          market_rent?: number | null
          cost_management?: number | null
          cost_property_tax?: number | null
          cost_fire_insurance?: number | null
          cost_maintenance?: number | null
          cost_other_label?: string | null
          cost_other?: number | null
          strategy?: string | null
          action_note?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          mortgage_end_date?: string | null
          beneficiary?: string | null
          external_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_action_member_id_fkey"
            columns: ["action_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      property_rate_schedule: {
        Row: {
          id: string
          property_id: string
          year_label: string
          rate: number | null
          rate_type: string | null
          sort_order: number
          household_id: string
        }
        Insert: {
          id?: string
          property_id: string
          year_label: string
          rate?: number | null
          rate_type?: string | null
          sort_order?: number
          household_id?: string
        }
        Update: {
          id?: string
          property_id?: string
          year_label?: string
          rate?: number | null
          rate_type?: string | null
          sort_order?: number
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_rate_schedule_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_rate_schedule_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      record_documents: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          bucket: string
          path: string
          label: string | null
          reminder_date: string | null
          uploaded_at: string
          household_id: string
        }
        Insert: {
          id?: string
          entity_type: string
          entity_id: string
          bucket?: string
          path: string
          label?: string | null
          reminder_date?: string | null
          uploaded_at?: string
          household_id?: string
        }
        Update: {
          id?: string
          entity_type?: string
          entity_id?: string
          bucket?: string
          path?: string
          label?: string | null
          reminder_date?: string | null
          uploaded_at?: string
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_documents_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      record_history: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          note: string
          occurred_on: string
          created_at: string
          household_id: string
        }
        Insert: {
          id?: string
          entity_type: string
          entity_id: string
          note: string
          occurred_on?: string
          created_at?: string
          household_id?: string
        }
        Update: {
          id?: string
          entity_type?: string
          entity_id?: string
          note?: string
          occurred_on?: string
          created_at?: string
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_history_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          id: string
          entity_type: string | null
          entity_id: string | null
          what: string | null
          remind_at: string | null
          dismissed: boolean
          created_at: string
          household_id: string
        }
        Insert: {
          id?: string
          entity_type?: string | null
          entity_id?: string | null
          what?: string | null
          remind_at?: string | null
          dismissed?: boolean
          created_at?: string
          household_id?: string
        }
        Update: {
          id?: string
          entity_type?: string | null
          entity_id?: string | null
          what?: string | null
          remind_at?: string | null
          dismissed?: boolean
          created_at?: string
          household_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      savings_accounts: {
        Row: {
          id: string
          member_id: string | null
          action_member_id: string | null
          institution: string
          account_type: string | null
          account_number: string | null
          group_name: string | null
          balance: number | null
          interest_rate: number | null
          monthly_contribution: number | null
          maturity_date: string | null
          last_updated: string | null
          note: string | null
          action: string | null
          notes: string | null
          status: Database["public"]["Enums"]["record_status"]
          is_demo: boolean
          created_at: string
          updated_at: string
          household_id: string
          withdrawal_date: string | null
          estimated_monthly_payout: number | null
          joint_member_id: string | null
          currency: string | null
        }
        Insert: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          institution: string
          account_type?: string | null
          account_number?: string | null
          group_name?: string | null
          balance?: number | null
          interest_rate?: number | null
          monthly_contribution?: number | null
          maturity_date?: string | null
          last_updated?: string | null
          note?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          withdrawal_date?: string | null
          estimated_monthly_payout?: number | null
          joint_member_id?: string | null
          currency?: string | null
        }
        Update: {
          id?: string
          member_id?: string | null
          action_member_id?: string | null
          institution?: string
          account_type?: string | null
          account_number?: string | null
          group_name?: string | null
          balance?: number | null
          interest_rate?: number | null
          monthly_contribution?: number | null
          maturity_date?: string | null
          last_updated?: string | null
          note?: string | null
          action?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          is_demo?: boolean
          created_at?: string
          updated_at?: string
          household_id?: string
          withdrawal_date?: string | null
          estimated_monthly_payout?: number | null
          joint_member_id?: string | null
          currency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "savings_accounts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "savings_accounts_action_member_id_fkey"
            columns: ["action_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "savings_accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "savings_accounts_joint_member_id_fkey"
            columns: ["joint_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_checklist_items: {
        Row: {
          id: string
          household_id: string
          label: string
          checked: boolean
          sort_order: number
          category: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          household_id: string
          label: string
          checked?: boolean
          sort_order?: number
          category?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          household_id?: string
          label?: string
          checked?: boolean
          sort_order?: number
          category?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "travel_checklist_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          user_id: string
          email: string | null
          display_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          email?: string | null
          display_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          email?: string | null
          display_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      entity_type:
        | "property"
        | "loan"
        | "insurance"
        | "investment"
        | "savings"
        | "health"
        | "inventory"
        | "other_asset"
        | "other_assets"
      property_purpose: "capital_growth" | "rental_yield" | "own_home" | "mixed"
      record_status: "urgent" | "review" | "settled"
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
      entity_type: [
        "property",
        "loan",
        "insurance",
        "investment",
        "savings",
        "health",
        "inventory",
        "other_asset",
        "other_assets",
      ],
      property_purpose: ["capital_growth", "rental_yield", "own_home", "mixed"],
      record_status: ["urgent", "review", "settled"],
    },
  },
} as const
