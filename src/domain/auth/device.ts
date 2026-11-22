/** A name a person recognises a device by, read from what its browser says about itself. */
export function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "أندرويد"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "جهاز";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${system} · ${browser}` : system;
}
