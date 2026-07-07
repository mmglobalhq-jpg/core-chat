import "@testing-library/jest-dom/vitest";

// Supabase client (lib/supabaseClient) throws at import time when these are
// absent. Tests never hit the network — chatHistory helpers short-circuit when
// there is no auth session — but the client must still construct. Provide inert
// placeholders so importing the store (which pulls in chatHistory) doesn't throw.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
