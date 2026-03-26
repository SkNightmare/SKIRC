/**
 * Détecte si l'app tourne sur mobile (Android/iOS via Tauri)
 * ou sur un écran étroit (< 768px).
 */
export function detectPlatform() {
    // Tauri v2 expose __TAURI_OS_PLUGIN_INTERNALS__ ou TAURI_PLATFORM
    const tauriPlatform = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.platform
                       || window.__TAURI_METADATA__?.tauriVersion;

    // Variable injectée par Tauri mobile au runtime
    if (window.__TAURI_MOBILE__ === true)     return 'mobile';

    // Détection par user-agent Android / iOS
    const ua = navigator.userAgent || "";
    if (/android|iphone|ipad|ipod/i.test(ua)) return 'mobile';

    // Détection par taille d'écran
    if (window.innerWidth < 768)              return 'mobile';

    return 'desktop';
}

export const isMobile = () => detectPlatform() === 'mobile';