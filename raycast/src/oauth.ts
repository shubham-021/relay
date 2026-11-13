import { OAuth } from "@raycast/api";
import { getServerUrl } from "./preferences";

export const oauthClient = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Relay",
  providerIcon: "icon.png",
  description:
    "Sign in to your Relay account to browse your library and fetch CDN links.",
});

const CLIENT_ID = "raycast-relay";
const OAUTH_SCOPE = "mcp";

let inFlightAuth: Promise<string> | null = null;

async function runAuthorizeFlow(): Promise<string> {
  const baseUrl = getServerUrl();

  const authRequest = await oauthClient.authorizationRequest({
    endpoint: `${baseUrl}/api/oauth/authorize`,
    clientId: CLIENT_ID,
    scope: OAUTH_SCOPE,
  });

  const { authorizationCode } = await oauthClient.authorize(authRequest);

  const tokenRes = await fetch(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: authorizationCode,
      code_verifier: authRequest.codeVerifier,
      redirect_uri: authRequest.redirectURI,
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => "");
    throw new Error(
      `OAuth token exchange failed (${tokenRes.status}): ${errBody}`,
    );
  }

  const tokenData = (await tokenRes.json()) as OAuth.TokenResponse;
  await oauthClient.setTokens(tokenData);
  return tokenData.access_token;
}

export async function getAccessToken(forceReauth = false): Promise<string> {
  if (!forceReauth) {
    const tokenSet = await oauthClient.getTokens();
    if (tokenSet?.accessToken && !tokenSet.isExpired()) {
      return tokenSet.accessToken;
    }
  }

  if (!inFlightAuth) {
    inFlightAuth = runAuthorizeFlow().finally(() => {
      inFlightAuth = null;
    });
  }

  return inFlightAuth;
}

export async function clearAuthTokens(): Promise<void> {
  await oauthClient.removeTokens();
}
