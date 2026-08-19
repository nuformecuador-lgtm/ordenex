// Feature 92 (seguimiento) — codificador del "Encoded Polyline Algorithm Format" de Google
// y distancia Haversine, compartidos por el trazado real y el trazado local.
//
// POR QUE EXISTE: una polilinea NO es mas que una lista de lat/lng comprimida. Eso permite
// dibujar una ruta SIN llamar a ningun proveedor: se unen las paradas con segmentos rectos.
//
// ⚠️ LA DIFERENCIA ENTRE LOS DOS TRAZADOS NO ES COSMETICA:
//
//   Routes  -> cientos de puntos que SIGUEN LAS CALLES. Es "por donde se va".
//   local   -> un punto por parada, en linea recta. Es "en que orden se va".
//
// La linea local cruza manzanas, rios y sentidos prohibidos. Sirve para ver el recorrido de
// un vistazo, NO para navegar. Por eso el trazado lleva `fuente` y la UI debe distinguirlos
// (p.ej. linea punteada para el local); pintarlos igual seria mentirle al mensajero.

/** Radio medio de la Tierra en km. Constante para la formula Haversine. */
const RADIO_TIERRA_KM = 6371;

const gradosARadianes = (grados: number): number => (grados * Math.PI) / 180;

/**
 * Distancia de circulo maximo (Haversine) entre dos puntos, en km. Vivia en
 * `haversine-route-optimization.ts`; se movio aqui cuando el trazado local necesito la misma
 * formula, para que exista UNA sola definicion.
 */
export function distanciaHaversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = gradosARadianes(b.lat - a.lat);
  const dLng = gradosARadianes(b.lng - a.lng);
  const lat1 = gradosARadianes(a.lat);
  const lat2 = gradosARadianes(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h));
}

/** Precision del formato: 5 decimales (~1 m). Es la que asumen los decodificadores. */
const FACTOR = 1e5;

/**
 * Codifica UN valor ya convertido a entero, segun el algoritmo de Google: diferencia con el
 * anterior, desplazamiento a la izquierda, complemento si es negativo, y troceado en grupos
 * de 5 bits en base 64 imprimible.
 */
function codificarValor(valor: number): string {
  // `<< 1` sobre el complemento a dos: los negativos se invierten bit a bit (~).
  let v = valor < 0 ? ~(valor << 1) : valor << 1;
  let salida = "";
  while (v >= 0x20) {
    // Cada trozo de 5 bits lleva el 6º encendido para decir "sigue"; +63 lo hace imprimible.
    salida += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  salida += String.fromCharCode(v + 63);
  return salida;
}

/**
 * Codifica una secuencia de puntos como polilinea de Google. Compatible con
 * `google.maps.geometry.encoding.decodePath` y con los decodificadores de Leaflet/Mapbox.
 *
 * El redondeo se hace sobre el valor ABSOLUTO acumulado (no sobre la diferencia): asi el
 * error de redondeo no se acumula punto a punto, que es justo lo que exige el formato.
 */
export function codificarPolilinea(puntos: { lat: number; lng: number }[]): string {
  let salida = "";
  let latPrevia = 0;
  let lngPrevia = 0;
  for (const punto of puntos) {
    const lat = Math.round(punto.lat * FACTOR);
    const lng = Math.round(punto.lng * FACTOR);
    salida += codificarValor(lat - latPrevia);
    salida += codificarValor(lng - lngPrevia);
    latPrevia = lat;
    lngPrevia = lng;
  }
  return salida;
}

/**
 * Decodifica una polilinea de Google a la lista de puntos que la componen. Es la inversa
 * exacta de `codificarPolilinea`, y tambien entiende las que devuelve Routes (mismo
 * formato, solo que con muchos mas puntos porque siguen las calles).
 *
 * Ante una cadena corrupta devuelve los puntos que haya podido leer en vez de lanzar: el
 * mapa es una ayuda visual, y media ruta dibujada es mejor que una pantalla rota.
 */
export function decodificarPolilinea(encoded: string): { lat: number; lng: number }[] {
  const puntos: { lat: number; lng: number }[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;

  /** Lee UN valor: grupos de 5 bits hasta uno sin el bit de continuacion. */
  function leerValor(): number | null {
    let resultado = 0;
    let desplazamiento = 0;
    let byte: number;
    do {
      if (i >= encoded.length) return null; // cadena truncada
      byte = encoded.charCodeAt(i++) - 63;
      resultado |= (byte & 0x1f) << desplazamiento;
      desplazamiento += 5;
    } while (byte >= 0x20);
    // El bit 0 marca el signo (complemento aplicado al codificar).
    return resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
  }

  while (i < encoded.length) {
    const dLat = leerValor();
    if (dLat === null) break;
    const dLng = leerValor();
    if (dLng === null) break;
    lat += dLat;
    lng += dLng;
    puntos.push({ lat: lat / FACTOR, lng: lng / FACTOR });
  }
  return puntos;
}

/**
 * Longitud total del recorrido en METROS, sumando los tramos en linea recta. Es una COTA
 * INFERIOR de la distancia real por carretera (siempre mas larga): sirve para dar una idea
 * de magnitud, no para prometerle un tiempo de llegada a nadie.
 */
export function distanciaTotalM(puntos: { lat: number; lng: number }[]): number {
  let km = 0;
  for (let i = 1; i < puntos.length; i++) {
    km += distanciaHaversineKm(puntos[i - 1], puntos[i]);
  }
  return Math.round(km * 1000);
}
