import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url));
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(new URL("/", request.url));
}
