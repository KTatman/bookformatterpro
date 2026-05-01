import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pofrdafqjzutzxyygpgu.supabase.co'
const supabaseAnonKey = 'sb_publishable_mp_IZqov4BLWayDXerxb8A_Zs23etyp'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
