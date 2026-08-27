/**
 * Feature 289 — enlaces a las apps de navegación del mensajero.
 *
 * Único sitio del repo donde se escribe una URL de mapas: `mapsNavUrl` (la card POS) delega
 * aquí en vez de tener su propia plantilla. Módulo PURO: sin React, sin `navigator`, sin el
 * DTO de la orden. Así se puede testear con objetos literales y desde `environment: node`.
 *
 * Por qué enlaces universales `https:` y no esquemas nativos (`waze://`, `comgooglemaps://`):
 * un esquema nativo hacia una app que NO está instalada no hace nada -- ni error ni aviso --
 * y no hay forma fiable de detectarlo desde la web. El enlace universal abre la app si está
 * y la web si no. La única excepción es `geo:`, que en Android NO apunta a una app concreta:
 * es el que levanta el selector del sistema, que es justamente lo que se quiere ofrecer ahí.
 */

/** `sistema` = `geo:`, el selector de apps de Android. El resto son apps concretas. */
export type AppNavegacion = "sistema" | "waze" | "google" | "apple";

export type Plataforma = "android" | "ios" | "escritorio";

/** Destino ya resuelto: coordenadas si la orden está geocodificada (feature 91), y siempre un texto. */
export interface DestinoNavegacion {
  lat: number | null;
  lng: number | null;
  /** Dirección legible (dirección + distrito/cantón/provincia). Puede ir vacío. */
  texto: string;
}

/** Lista cerrada, usada para validar lo que se lee del almacenamiento del dispositivo. */
export const APPS_NAVEGACION: readonly AppNavegacion[] = [
  "sistema",
  "waze",
  "google",
  "apple",
];

export const ETIQUETAS_APP: Record<AppNavegacion, string> = {
  sistema: "otra app de mapas",
  waze: "Waze",
  google: "Google Maps",
  apple: "Apple Maps",
};

/**
 * Plataforma a partir del user agent. NO lee `navigator`: recibe los dos datos, para que el
 * caso difícil sea testeable.
 *
 * El caso difícil es el iPad moderno: desde iPadOS 13 se anuncia como `Macintosh` y es
 * indistinguible de un Mac de escritorio salvo por tener pantalla táctil. Sin este apaño, un
 * iPad recibiría solo Google Maps.
 */
export function detectarPlataforma(
  userAgent: string,
  maxTouchPoints: number,
): Plataforma {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/macintosh|mac os x/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "escritorio";
}

/**
 * Apps que tiene sentido ofrecer, en el orden por defecto (la preferida del dispositivo se
 * antepone después, en el componente).
 *
 * `sistema` (`geo:`) SOLO en Android: iOS lo ignora en silencio, así que ofrecerlo allí sería
 * un botón que no hace nada. En escritorio se ofrece solo Google Maps: Waze web es un mapa sin
 * navegación y Apple Maps no abre fuera del ecosistema Apple.
 */
export function appsPara(plataforma: Plataforma): AppNavegacion[] {
  switch (plataforma) {
    case "android":
      return ["sistema", "waze", "google"];
    case "ios":
      return ["apple", "google", "waze"];
    case "escritorio":
      return ["google"];
  }
}

/** `geo:` abre una app del sistema: en pestaña nueva dejaría una pestaña en blanco detrás. */
export function abreEnPestanaNueva(app: AppNavegacion): boolean {
  return app !== "sistema";
}

/**
 * URL de navegación hacia el destino. Prefiere las coordenadas; sin ellas cae a la búsqueda
 * por texto, que es lo que resuelve una orden aún no geocodificada.
 */
export function urlNavegacion(
  app: AppNavegacion,
  destino: DestinoNavegacion,
): string {
  const { lat, lng, texto } = destino;
  const hayCoords = lat !== null && lng !== null;
  const coords = `${lat},${lng}`;
  const q = encodeURIComponent(texto);

  switch (app) {
    case "sistema":
      // El paréntesis lleva la etiqueta que Android muestra sobre el pin. Sin coordenadas se
      // usa `geo:0,0?q=`, la forma documentada de buscar por texto.
      return hayCoords
        ? `geo:${coords}?q=${coords}(${q})`
        : `geo:0,0?q=${q}`;
    case "waze":
      return hayCoords
        ? `https://waze.com/ul?ll=${coords}&navigate=yes`
        : `https://waze.com/ul?q=${q}&navigate=yes`;
    case "google":
      // Mismo formato que usaba `mapsNavUrl` antes de delegar aquí: no fuerza permisos ni GPS,
      // Maps resuelve el origen por su cuenta.
      return `https://www.google.com/maps/dir/?api=1&destination=${hayCoords ? coords : q}`;
    case "apple":
      return `https://maps.apple.com/?daddr=${hayCoords ? coords : q}&dirflg=d`;
  }
}
