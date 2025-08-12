import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mbpgasbvzhmvxnebjutm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1icGdhc2J2emhtdnhuZWJqdXRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwMjEzNjIsImV4cCI6MjA3MDU5NzM2Mn0.Nvy9LUZCMXVnK41AeTwXcexHKLjRcZqG9QeBdBjN1fs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
