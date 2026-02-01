export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      products: {
        Row: {
          id: string
          item_code: string
          barcode: string | null
          name: string
          unit: string
          cost: number
          price: number
          stock: number
          avg_cost: number
          allow_negative: boolean
          is_active: boolean
          image_url: string | null
          search_text: unknown | null
          tags: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          item_code: string
          barcode?: string | null
          name: string
          unit?: string
          cost?: number
          price?: number
          stock?: number
          avg_cost?: number
          allow_negative?: boolean
          is_active?: boolean
          image_url?: string | null
          search_text?: unknown | null
          tags?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          item_code?: string
          barcode?: string | null
          name?: string
          unit?: string
          cost?: number
          price?: number
          stock?: number
          avg_cost?: number
          allow_negative?: boolean
          is_active?: boolean
          image_url?: string | null
          search_text?: unknown | null
          tags?: Json
          created_at?: string
          updated_at?: string
        }
      }
      customers: {
        Row: {
          id: string
          customer_code: string
          customer_name: string
          phone: string | null
          line_id: string | null
          email: string | null
          address: string | null
          payment_method: string | null
          note: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_code: string
          customer_name: string
          phone?: string | null
          line_id?: string | null
          email?: string | null
          address?: string | null
          payment_method?: string | null
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_code?: string
          customer_name?: string
          phone?: string | null
          line_id?: string | null
          email?: string | null
          address?: string | null
          payment_method?: string | null
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      vendors: {
        Row: {
          id: string
          vendor_code: string
          vendor_name: string
          contact_person: string | null
          phone: string | null
          email: string | null
          address: string | null
          payment_terms: string | null
          bank_account: string | null
          note: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          vendor_code: string
          vendor_name: string
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          payment_terms?: string | null
          bank_account?: string | null
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          vendor_code?: string
          vendor_name?: string
          contact_person?: string | null
          phone?: string | null
          email?: string | null
          address?: string | null
          payment_terms?: string | null
          bank_account?: string | null
          note?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      sales: {
        Row: {
          id: string
          sale_no: string
          customer_code: string | null
          sale_date: string
          source: string
          payment_method: string
          account_id: string | null
          is_paid: boolean
          subtotal: number // 原始銷售額 (Gross Sales)
          discount_amount: number // 折扣金額
          store_credit_used: number // 使用的購物金
          total: number // 實收金額 (Net Collected)
          status: string
          note: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sale_no: string
          customer_code?: string | null
          sale_date?: string
          source?: string
          payment_method?: string
          account_id?: string | null
          is_paid?: boolean
          subtotal?: number
          discount_amount?: number
          store_credit_used?: number
          total?: number
          status?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sale_no?: string
          customer_code?: string | null
          sale_date?: string
          source?: string
          payment_method?: string
          account_id?: string | null
          is_paid?: boolean
          subtotal?: number
          discount_amount?: number
          store_credit_used?: number
          total?: number
          status?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      sale_items: {
        Row: {
          id: string
          sale_id: string
          product_id: string
          quantity: number
          price: number
          subtotal: number
          snapshot_name: string | null
          store_credit_qty: number
          store_credit_amount: number
        }
        Insert: {
          id?: string
          sale_id: string
          product_id: string
          quantity: number
          price: number
          subtotal?: number
          snapshot_name?: string | null
          store_credit_qty?: number
          store_credit_amount?: number
        }
        Update: {
          id?: string
          sale_id?: string
          product_id?: string
          quantity?: number
          price?: number
          subtotal?: number
          snapshot_name?: string | null
          store_credit_qty?: number
          store_credit_amount?: number
        }
      }
      purchases: {
        Row: {
          id: string
          purchase_no: string
          vendor_code: string
          purchase_date: string
          total: number
          status: string
          note: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          purchase_no: string
          vendor_code: string
          purchase_date?: string
          total?: number
          status?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          purchase_no?: string
          vendor_code?: string
          purchase_date?: string
          total?: number
          status?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      purchase_items: {
        Row: {
          id: string
          purchase_id: string
          product_id: string
          quantity: number
          cost: number
          subtotal: number
        }
        Insert: {
          id?: string
          purchase_id: string
          product_id: string
          quantity: number
          cost: number
          subtotal?: number
        }
        Update: {
          id?: string
          purchase_id?: string
          product_id?: string
          quantity?: number
          cost?: number
          subtotal?: number
        }
      }
      partner_accounts: {
        Row: {
          id: string
          partner_type: string
          partner_code: string
          direction: string
          ref_type: string
          ref_id: string
          ref_no: string
          purchase_item_id: string | null
          amount: number
          received_paid: number
          balance: number
          due_date: string
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          partner_type: string
          partner_code: string
          direction: string
          ref_type: string
          ref_id: string
          ref_no: string
          purchase_item_id?: string | null
          amount: number
          received_paid?: number
          balance?: number
          due_date?: string
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          partner_type?: string
          partner_code?: string
          direction?: string
          ref_type?: string
          ref_id?: string
          ref_no?: string
          purchase_item_id?: string | null
          amount?: number
          received_paid?: number
          balance?: number
          due_date?: string
          status?: string
          created_at?: string
          updated_at?: string
        }
      }
      users: {
        Row: {
          id: string
          username: string
          password_hash: string
          role: string
          full_name: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          username: string
          password_hash: string
          role?: string
          full_name?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          password_hash?: string
          role?: string
          full_name?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      accounts: {
        Row: {
          id: string
          account_name: string
          account_type: 'cash' | 'bank' | 'petty_cash'
          payment_method_code: string | null
          display_name: string | null
          sort_order: number
          auto_mark_paid: boolean
          balance: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          account_name: string
          account_type: 'cash' | 'bank' | 'petty_cash'
          payment_method_code?: string | null
          display_name?: string | null
          sort_order?: number
          auto_mark_paid?: boolean
          balance?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          account_name?: string
          account_type?: 'cash' | 'bank' | 'petty_cash'
          payment_method_code?: string | null
          display_name?: string | null
          sort_order?: number
          auto_mark_paid?: boolean
          balance?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      expenses: {
        Row: {
          id: number
          date: string
          category: string
          amount: number
          account_id: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: number
          date: string
          category: string
          amount: number
          account_id?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          date?: string
          category?: string
          amount?: number
          account_id?: string | null
          note?: string | null
          created_at?: string
        }
      }
      business_day_closings: {
        Row: {
          id: string
          source: 'pos' | 'live'
          closing_time: string
          sales_count: number
          total_sales: number
          total_cash: number
          total_card: number
          total_transfer: number
          total_cod: number
          paid_count: number
          paid_sales: number
          paid_cash: number
          paid_card: number
          paid_transfer: number
          paid_cod: number
          unpaid_count: number
          unpaid_sales: number
          unpaid_cash: number
          unpaid_card: number
          unpaid_transfer: number
          unpaid_cod: number
          sales_by_account: Json | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          source: 'pos' | 'live'
          closing_time?: string
          sales_count?: number
          total_sales?: number
          total_cash?: number
          total_card?: number
          total_transfer?: number
          total_cod?: number
          paid_count?: number
          paid_sales?: number
          paid_cash?: number
          paid_card?: number
          paid_transfer?: number
          paid_cod?: number
          unpaid_count?: number
          unpaid_sales?: number
          unpaid_cash?: number
          unpaid_card?: number
          unpaid_transfer?: number
          unpaid_cod?: number
          sales_by_account?: Json | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          source?: 'pos' | 'live'
          closing_time?: string
          sales_count?: number
          total_sales?: number
          total_cash?: number
          total_card?: number
          total_transfer?: number
          total_cod?: number
          paid_count?: number
          paid_sales?: number
          paid_cash?: number
          paid_card?: number
          paid_transfer?: number
          paid_cod?: number
          unpaid_count?: number
          unpaid_sales?: number
          unpaid_cash?: number
          unpaid_card?: number
          unpaid_transfer?: number
          unpaid_cod?: number
          sales_by_account?: Json | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      settlements: {
        Row: {
          id: string
          partner_type: 'customer' | 'vendor'
          partner_code: string
          trans_date: string
          direction: 'payment' | 'receipt'
          method: string
          amount: number
          note: string | null
          account_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          partner_type: 'customer' | 'vendor'
          partner_code: string
          trans_date?: string
          direction: 'payment' | 'receipt'
          method?: string
          amount: number
          note?: string | null
          account_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          partner_type?: 'customer' | 'vendor'
          partner_code?: string
          trans_date?: string
          direction?: 'payment' | 'receipt'
          method?: string
          amount?: number
          note?: string | null
          account_id?: string | null
          created_at?: string
        }
      }
      account_transactions: {
        Row: {
          id: string
          account_id: string
          transaction_type: 'expense' | 'sale' | 'purchase_payment' | 'customer_payment' | 'adjustment'
          amount: number
          balance_before: number
          balance_after: number
          ref_type: string | null
          ref_id: string | null
          ref_no: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          account_id: string
          transaction_type: 'expense' | 'sale' | 'purchase_payment' | 'customer_payment' | 'adjustment'
          amount: number
          balance_before: number
          balance_after: number
          ref_type?: string | null
          ref_id?: string | null
          ref_no?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          account_id?: string
          transaction_type?: 'expense' | 'sale' | 'purchase_payment' | 'customer_payment' | 'adjustment'
          amount?: number
          balance_before?: number
          balance_after?: number
          ref_type?: string | null
          ref_id?: string | null
          ref_no?: string | null
          note?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
