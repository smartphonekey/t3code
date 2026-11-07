const CLOUDFLARE_ACCESS_HOST_SUFFIX = ".cloudflareaccess.com";

export function isCloudflareAccessLoginUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "cloudflareaccess.com" || hostname.endsWith(CLOUDFLARE_ACCESS_HOST_SUFFIX);
  } catch {
    return url.includes("cloudflareaccess.com");
  }
}

export function isCloudflareAccessChallengeResponse(
  response: Response,
  requestUrl: string,
): boolean {
  if (response.status === 401) {
    return true;
  }

  const location = response.headers.get("location");
  if (
    response.status >= 300 &&
    response.status < 400 &&
    location !== null &&
    isCloudflareAccessLoginUrl(location)
  ) {
    return true;
  }

  if (response.redirected && isCloudflareAccessLoginUrl(response.url)) {
    return true;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (
    requestUrl.includes("/.well-known/t3/") &&
    contentType.includes("text/html") &&
    response.status !== 204
  ) {
    return true;
  }

  return false;
}

export function cloudflareAccessLoginStartUrl(response: Response, requestUrl: string): string {
  const location = response.headers.get("location");
  if (location !== null && isCloudflareAccessLoginUrl(location)) {
    return new URL(location, requestUrl).toString();
  }
  if (response.redirected && isCloudflareAccessLoginUrl(response.url)) {
    return response.url;
  }
  return requestUrl;
}
