import { estaDisponible } from "@/lib/repositories/_shared/geografia-activa";
import type { NivelGeografico, ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

// FICHA 374 (design §7.3 · R44) — QUE ZONAS SE QUEDARIAN SIN NINGUN DISTRITO DISPONIBLE.
//
// Modulo PURO: ni React ni Prisma. Se resuelve sobre el arbol que el cliente YA tiene en memoria y
// NO añade ni una consulta — a diferencia del conteo de ordenes de R60, que si necesita servidor
// porque las ordenes no estan en el arbol ni deben estarlo.
//
// AVISA; NO BLOQUEA. Vetar la desactivacion del ultimo distrito de una zona esta descartado
// (design §9, A4) y la decision se deja escrita para que no vuelva: una zona sin distritos YA es
// representable —`ZonaRepository.update` acepta `distritoIds: []`—, desactivar no toca
// `zona_distrito` (R50), y el veto acoplaria una regla de Tarifas dentro de Geografia.

/** El nodo que se va a retirar. `activo` no viaja: aqui siempre se simula apagarlo. */
export interface NodoObjetivo {
  nivel: NivelGeografico;
  id: string;
}

/**
 * Los nombres de las zonas que hoy tienen al menos un distrito disponible y que se quedarian con
 * CERO si se retirase `objetivo`. Orden alfabetico y sin repetidos.
 *
 * ⚠️ SOLO VE LAS ZONAS QUE EL ARBOL NOMBRA, y eso es exactamente lo correcto: `zonaId` es la zona
 * UTILIZABLE del distrito (colapso 1/0/>1). Un distrito con dos zonas llega con `null` y no
 * sostiene a ninguna, que es lo mismo que ya opina la carga masiva sobre el.
 */
export function zonasQueQuedarianSinDistritos(
  arbol: readonly ProvinciaArbolDTO[],
  objetivo: NodoObjetivo,
): string[] {
  /** zonaId -> { nombre, antes, despues } */
  const zonas = new Map<string, { nombre: string; antes: number; despues: number }>();

  for (const provincia of arbol) {
    const provinciaTrasRetirar =
      objetivo.nivel === "provincia" && objetivo.id === provincia.id ? false : provincia.activo;

    for (const canton of provincia.cantones) {
      const cantonTrasRetirar =
        objetivo.nivel === "canton" && objetivo.id === canton.id ? false : canton.activo;

      for (const distrito of canton.distritos) {
        if (distrito.zonaId === null || distrito.zonaNombre === null) continue;

        const distritoTrasRetirar =
          objetivo.nivel === "distrito" && objetivo.id === distrito.id ? false : distrito.activo;

        const acumulado = zonas.get(distrito.zonaId) ?? {
          nombre: distrito.zonaNombre,
          antes: 0,
          despues: 0,
        };
        if (
          estaDisponible({
            provincia: provincia.activo,
            canton: canton.activo,
            distrito: distrito.activo,
          })
        ) {
          acumulado.antes += 1;
        }
        if (
          estaDisponible({
            provincia: provinciaTrasRetirar,
            canton: cantonTrasRetirar,
            distrito: distritoTrasRetirar,
          })
        ) {
          acumulado.despues += 1;
        }
        zonas.set(distrito.zonaId, acumulado);
      }
    }
  }

  // `antes > 0` no es un detalle: una zona que YA estaba vacia no se queda vacia por este cambio,
  // y nombrarla en la confirmacion seria echarle la culpa a quien no la tiene.
  return [...zonas.values()]
    .filter((zona) => zona.antes > 0 && zona.despues === 0)
    .map((zona) => zona.nombre)
    .sort((a, b) => a.localeCompare(b, "es"));
}
