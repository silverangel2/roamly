import { ImageResponse } from "next/og";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "edge";

function clean(value?: string | null) {
  return (value || "").trim();
}

function fitText(value: string) {
  const text = clean(value) || "Travel should feel easier to plan.";
  return text.length > 96 ? `${text.slice(0, 93).trim()}...` : text;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let statement = "Travel should feel easier to plan.";
  let topic = "Plan smarter with Roamly";

  try {
    const admin = createSupabaseAdminClient();
    if (admin && !id.startsWith("pending-")) {
      const { data } = await admin
        .from("roamly_social_drafts")
        .select("hook,on_screen_text,topic")
        .eq("id", id)
        .maybeSingle();
      statement = fitText(clean(data?.on_screen_text) || clean(data?.hook) || statement);
      topic = fitText(clean(data?.topic) || topic);
    }
  } catch {
    statement = fitText(statement);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f7fcff",
          color: "#102033",
          padding: "82px",
          fontFamily: "Inter, Arial, sans-serif"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: "34px", fontWeight: 900 }}>
          <div
            style={{
              width: "62px",
              height: "62px",
              borderRadius: "18px",
              background: "#54D6C6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            R
          </div>
          <div>Roamly</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "28px",
            maxWidth: "880px"
          }}
        >
          <div style={{ fontSize: statement.length > 70 ? "62px" : "76px", lineHeight: 1.05, fontWeight: 950, letterSpacing: 0 }}>
            {statement}
          </div>
          <div style={{ width: "160px", height: "10px", borderRadius: "999px", background: "#1B9AAA" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "32px" }}>
          <div style={{ fontSize: "30px", lineHeight: 1.3, fontWeight: 800, color: "#42526a", maxWidth: "700px" }}>{topic}</div>
          <div style={{ fontSize: "28px", fontWeight: 900, color: "#1B9AAA" }}>roamlyhq.com</div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080
    }
  );
}
