import { createClient } from '@supabase/supabase-js'

// Load env vars the right way
const supabaseUrl = process.env.REACT_APP_PROJECT_URL
const supabaseAnonKey = process.env.REACT_APP_PROJECT_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
