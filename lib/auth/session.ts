import { NextResponse } from "next/server";

export const ACCESS_TOKEN_COOKIE = "lf_access_token";
export const REFRESH_TOKEN_COOKIE = "lf_refresh_token";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export const setSessionCookies = (
  response: NextResponse,
  accessToken: string,
  refreshToken?: string | null
) => {
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions,
    maxAge: COOKIE_MAX_AGE,
  });

  if (refreshToken) {
    response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...baseCookieOptions,
      maxAge: COOKIE_MAX_AGE,
    });
  }
};

export const clearSessionCookies = (response: NextResponse) => {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", {
    ...baseCookieOptions,
    maxAge: 0,
  });

  response.cookies.set(REFRESH_TOKEN_COOKIE, "", {
    ...baseCookieOptions,
    maxAge: 0,
  });
};
