import { NextResponse } from "next/server";
import {
  exchangeRoamlyFacebookCodeForUserToken,
  exchangeForLongLivedRoamlyFacebookToken,
  getRoamlyFacebookPages,
  getRoamlyFacebookOAuthConfig,
  getRoamlyFacebookScopes,
  ROAMLY_FACEBOOK_STATE_COOKIE,
  storeRoamlyFacebookConnection,
  verifyRoamlyFacebookPageToken
} from "@/lib/roamly/facebookConnector";

export const dynamic = "force-dynamic";

function readCookie(cookieHeader: string, name: string) {
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return match
    ? decodeURIComponent(match.split("=").slice(1).join("="))
    : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  console.info("[Roamly Facebook OAuth] CALLBACK ENTERED", {
    pathname: url.pathname,
    hasCode: Boolean(url.searchParams.get("code")),
    hasState: Boolean(url.searchParams.get("state")),
    hasError: Boolean(url.searchParams.get("error"))
  });

  const error = url.searchParams.get("error");
  const errorDescription =
    url.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/admin?facebook=error&message=${encodeURIComponent(
          errorDescription || error
        )}`,
        request.url
      )
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieHeader = request.headers.get("cookie") || "";
  const expectedState = readCookie(
    cookieHeader,
    ROAMLY_FACEBOOK_STATE_COOKIE
  );

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(
      new URL(
        "/admin?facebook=error&message=Invalid%20Facebook%20OAuth%20state",
        request.url
      )
    );
  }

  try {
    getRoamlyFacebookOAuthConfig();

    const shortToken =
      await exchangeRoamlyFacebookCodeForUserToken(code);

    const longToken =
      await exchangeForLongLivedRoamlyFacebookToken(
        shortToken.access_token
      );

    const pages = await getRoamlyFacebookPages(
      longToken.access_token
    );

    const configuredPageId =
      process.env.ROAMLY_META_PAGE_ID?.trim() || "";

    console.info("[Roamly Facebook OAuth] PAGES RETURNED", {
      configuredPageId,
      pages: pages.map((item) => ({
        id: item.id,
        name: item.name || null,
        tasks: item.tasks || []
      }))
    });

    const page = configuredPageId
      ? pages.find((item) => item.id === configuredPageId)
      : pages[0];

    if (!page) {
      throw new Error(
        configuredPageId
          ? "The configured Roamly Facebook Page was not returned by Meta."
          : "No Facebook Page is available for this account."
      );
    }

    if (!page.access_token) {
      throw new Error(
        "Meta did not return a Page access token for the Roamly Page."
      );
    }

    const verified =
      await verifyRoamlyFacebookPageToken(
        page.id,
        page.access_token
      );

    console.info("[Roamly Facebook OAuth] ABOUT TO SAVE", {
      pageId: page.id,
      pageName: verified.name || page.name || "Roamly"
    });

    const saved = await storeRoamlyFacebookConnection({
      pageId: page.id,
      pageName: verified.name || page.name || "Roamly",
      pageAccessToken: page.access_token,
      scopes: getRoamlyFacebookScopes(),
      metadata: {
        connectedAt: new Date().toISOString(),
        userTokenExpiresIn:
          longToken.expires_in ?? null
      }
    });

    console.info("[Roamly Facebook OAuth] SAVE VERIFIED", {
      pageId: saved.pageId,
      pageName: saved.pageName,
      connected: saved.connected
    });

    const response = NextResponse.redirect(
      new URL("/admin?facebook=connected", request.url)
    );

    response.cookies.set(
      ROAMLY_FACEBOOK_STATE_COOKIE,
      "",
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0
      }
    );

    return response;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Facebook connection failed.";

    console.error("[Roamly Facebook OAuth] callback failed", {
      message
    });

    return NextResponse.redirect(
      new URL(
        `/admin?facebook=error&message=${encodeURIComponent(
          message
        )}`,
        request.url
      )
    );
  }
}
