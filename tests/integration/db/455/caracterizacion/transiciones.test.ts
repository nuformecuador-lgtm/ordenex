import { describe, it, expect } from "vitest";

import { ESTADOS_CREACION, ESTADOS_TERMINALES, TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { INVENTARIO_CREACION, INVENTARIO_FLUJO } from "../../../../fixtures/inventario-transiciones-140";
import { claveDe } from "../../../../fixtures/codigos-455";

/**
 * FEATURE 455 — FASE 0 · C10 (R48). EL GRAFO DE TRANSICIONES, LEIDO EN CLAVES DEL INTERRUPTOR.
 *
 * La 455 renombra codigos, no aristas: el grafo `TRANSICIONES` tiene que tener EXACTAMENTE las mismas
 * aristas antes y despues, leidas con la correspondencia de §0.1. Aqui cada arista se escribe como
 * `<clave origen> -> <clave destino> @ <familia>`, con las claves de `tests/fixtures/codigos-455.ts`, y:
 *  - el grafo es igual al inventario de la 140 (`inventario-transiciones-140.ts`) leido igual;
 *  - y los dos son iguales a la LISTA LITERAL de abajo, escrita a mano en claves (contrato: si T1.4
 *    reemplaza mal un codigo en el grafo o en el inventario, esta lista no se mueve y el test cae).
 * Las familias (`via`) NO son codigos de estado y no cambian (requirements, Fuera de alcance).
 * Test puro: no toca la base.
 */

function aristasDelGrafo(): string[] {
  const grafo = TRANSICIONES as unknown as Record<string, readonly { to: string; via: string }[]>;
  const salida: string[] = [];
  for (const [origen, destinos] of Object.entries(grafo)) {
    for (const d of destinos) salida.push(`${claveDe(origen)} -> ${claveDe(d.to)} @ ${d.via}`);
  }
  return salida.sort();
}

function aristasDelInventario(): string[] {
  return INVENTARIO_FLUJO.map((a) => `${claveDe(a.origen)} -> ${claveDe(a.destino)} @ ${a.via}`).sort();
}

describe("455/C10 — el grafo de transiciones leido en claves", () => {
  it("ninguna arista nombra un codigo que el interruptor no conozca", () => {
    const ajenas = aristasDelGrafo().filter((a) => a.includes("?"));
    expect(ajenas).toEqual([]);
  });

  it("el grafo es igual al inventario de la 140", () => {
    expect(aristasDelGrafo()).toEqual(aristasDelInventario());
  });

  it("el grafo es igual a la lista literal de aristas en claves", () => {
    expect(ARISTAS_ESPERADAS).toHaveLength(59);
    expect(aristasDelGrafo()).toEqual([...ARISTAS_ESPERADAS].sort());
  });

  it("los estados de creacion y los terminales, en claves", () => {
    expect(ESTADOS_CREACION.map(claveDe)).toEqual(["enPreparacion", "porRecolectarEnTienda"]);
    expect(INVENTARIO_CREACION.map((a) => claveDe(a.destino))).toEqual(["enPreparacion", "porRecolectarEnTienda"]);
    expect(ESTADOS_TERMINALES.map(claveDe)).toEqual(["entregado", "devueltaATienda", "incidente"]);
  });
});

// Transcrita del grafo de HOY (2026-09-24, `dev` @ 0bd66809) y leida en claves. 59 aristas.
const ARISTAS_ESPERADAS: readonly string[] = [
  "devolviendoABodegaCentral -> porDevolverATienda @ recepcion_bodega_central",
  "devolviendoATienda -> devueltaATienda @ ajuste_estado",
  "enBodegaCentral -> devolviendoATienda @ cancelacion_api",
  "enBodegaCentral -> enReparto @ deshacer_gestion",
  "enBodegaCentral -> enRutaBodegaSatelite @ ruteo_satelite",
  "enBodegaCentral -> incidente @ incidente",
  "enBodegaCentral -> recogiendo @ asignacion_bodega",
  "enBodegaSatelite -> enReparto @ deshacer_gestion",
  "enBodegaSatelite -> incidente @ incidente",
  "enBodegaSatelite -> recogiendo @ asignacion_satelite",
  "enPreparacion -> enBodegaCentral @ generacion_guia",
  "enReparto -> entregado @ gestion",
  "enReparto -> incidente @ incidente",
  "enReparto -> novedad @ anclaje_devolucion",
  "enReparto -> novedadInterna @ corte_sin_gestionar",
  "enReparto -> rechazo @ gestion",
  "enReparto -> rechazo @ gestion_tienda_ayuda",
  "enReparto -> reprogramado @ gestion",
  "enReparto -> reprogramado @ gestion_tienda_ayuda",
  "enRutaBodegaCentral -> devolviendoATienda @ cancelacion_api",
  "enRutaBodegaCentral -> enBodegaCentral @ recepcion_bodega_central",
  "enRutaBodegaCentral -> incidente @ incidente",
  "enRutaBodegaSatelite -> enBodegaCentral @ deshacer_asignacion",
  "enRutaBodegaSatelite -> enBodegaSatelite @ recepcion_satelite",
  "enRutaBodegaSatelite -> incidente @ incidente",
  "entregado -> enReparto @ deshacer_gestion",
  "entregado -> rechazo @ correccion_resultado_gestion",
  "incidente -> enBodegaCentral @ incidente",
  "incidente -> enBodegaSatelite @ incidente",
  "incidente -> enReparto @ deshacer_gestion",
  "incidente -> enRutaBodegaCentral @ incidente",
  "incidente -> enRutaBodegaSatelite @ incidente",
  "incidente -> recogiendo @ incidente",
  "novedad -> enBodegaCentral @ liberacion_devuelta_sla",
  "novedad -> enBodegaCentral @ recuperacion_manual",
  "novedad -> enBodegaSatelite @ liberacion_devuelta_sla",
  "novedad -> enBodegaSatelite @ recuperacion_manual",
  "novedad -> enReparto @ deshacer_gestion",
  "novedad -> rechazo @ escalado_devuelta_sla",
  "novedad -> rechazo @ rechazo_tienda",
  "novedad -> reprogramado @ reprogramacion_tienda",
  "novedadInterna -> enBodegaCentral @ liberacion_sin_gestionar",
  "novedadInterna -> enBodegaSatelite @ liberacion_sin_gestionar",
  "novedadInterna -> rechazo @ rechazo_tope_intentos",
  "porDevolverATienda -> devolviendoATienda @ ajuste_estado",
  "porDevolverCentral -> devolviendoABodegaCentral @ ajuste_estado",
  "porRecolectarEnTienda -> recolectando @ asignacion_recoleccion",
  "rechazo -> enReparto @ deshacer_gestion",
  "rechazo -> porDevolverATienda @ devolucion_rechazada",
  "rechazo -> porDevolverCentral @ devolucion_rechazada",
  "recogiendo -> enBodegaCentral @ deshacer_asignacion",
  "recogiendo -> enBodegaSatelite @ deshacer_asignacion",
  "recogiendo -> enReparto @ recoleccion",
  "recogiendo -> incidente @ incidente",
  "recolectando -> enRutaBodegaCentral @ recoleccion_tienda",
  "recolectando -> porRecolectarEnTienda @ deshacer_asignacion",
  "reprogramado -> enBodegaCentral @ liberacion_reprogramada",
  "reprogramado -> enBodegaSatelite @ liberacion_reprogramada",
  "reprogramado -> enReparto @ deshacer_gestion",
];
