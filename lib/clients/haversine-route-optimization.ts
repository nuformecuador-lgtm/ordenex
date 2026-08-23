// Feature 92 (design §9.A) — cliente de optimizacion de ruta LOCAL y GRATIS. Ordena las
// paradas con la heuristica del VECINO MAS CERCANO (nearest-neighbor) sobre la distancia
// Haversine (circulo maximo). Es el FALLBACK que usa `FallbackRouteOptimizationClient`
// cuando falta la credencial de Route Optimization: sin este cliente, un despliegue sin
// credencial dejaria la ruta del mensajero sin ordenar.
//
// CUATRO PROPIEDADES DELIBERADAS:
//
// 1. NO toca la red, NO necesita credencial y NUNCA lanza: solo puede devolver
//    `{ status: "ok" }`. Los desenlaces `transitorio` / `config_invalida` de la interfaz no
//    aplican a un calculo local — no hay proveedor que falle.
// 2. DETERMINISTA: ante empate de distancia gana el indice MENOR (el `<` estricto conserva
//    el primero encontrado). Misma entrada -> misma secuencia, para que la huella de R36 del
//    servicio no dispare recalculos fantasma.
// 3. Distancia en LINEA RECTA, no por carretera: ignora calles, sentidos y trafico. Da un
//    orden RAZONABLE para paradas urbanas cercanas, no un optimo real (design §9.A, Q9).
// 4. Sin PII por log ni por error (R14): este archivo no emite coordenadas ni ids.
import type {
  IRouteOptimizationClient,
  OptimizarInput,
  OptimizarOutcome,
} from "@/lib/interfaces/external/IRouteOptimizationClient";
// La formula vive en `lib/geo/polilinea.ts` desde que el trazado local la necesito tambien.
// Solo se usa para COMPARAR distancias, asi que el radio es indiferente al orden resultante.
import { distanciaHaversineKm } from "@/lib/geo/polilinea";

export class HaversineRouteOptimizationClient implements IRouteOptimizationClient {
  // La interfaz es async (un proveedor real hace red); aqui el calculo es local y sincrono,
  // pero cumplimos el contrato devolviendo una promesa.
  async optimizar(input: OptimizarInput): Promise<OptimizarOutcome> {
    const { origen, paradas } = input;

    // Vecino mas cercano: se parte del origen y en cada paso se salta a la parada pendiente
    // mas proxima, que pasa a ser el nuevo punto actual. O(n^2), holgado para RUTA_MAX_PARADAS.
    const pendientes = new Set(paradas.keys());
    const secuencia: string[] = [];
    let actual: { lat: number; lng: number } = origen;

    while (pendientes.size > 0) {
      let mejor = -1;
      let mejorDist = Infinity;
      for (const i of pendientes) {
        const d = distanciaHaversineKm(actual, paradas[i]);
        // `<` estricto: ante empate gana el indice menor -> resultado determinista.
        if (d < mejorDist) {
          mejorDist = d;
          mejor = i;
        }
      }
      pendientes.delete(mejor);
      const parada = paradas[mejor];
      secuencia.push(parada.ordenId);
      actual = { lat: parada.lat, lng: parada.lng };
    }

    // Feature 265 (R35, design §13.3): `local` SIEMPRE. Este cliente no habla con nadie, asi
    // que no hay ningun camino por el que su orden pueda venir del proveedor. Lo declara el
    // productor —no lo supone el que lo llama— para que la marca que acaba en la fila y en la
    // pantalla del mensajero sea la de quien de verdad ordeno.
    return { status: "ok", secuencia, fuente: "local" };
  }
}
