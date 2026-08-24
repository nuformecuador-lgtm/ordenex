import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
  RESULTADOS_QUE_CUENTAN_COMO_INTENTO,
} from "@/lib/types/orden-historial";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { RESULTADOS_PERMITIDOS_EN_EL_TOPE } from "@/lib/types/tope-intentos";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

/**
 * GUARDIA DE LA FEATURE 273 (T13) — EL INVARIANTE DEL TOPE. R31, R32, R33.
 *
 * QUE PROTEGE, y por que hace falta ADEMAS de los tests de cada puerta.
 *
 * Los tests de cada superficie afirman que ESA puerta esta cerrada hoy. Ninguno se pone rojo el
 * dia en que alguien abra una SEXTA via hacia la circulacion —una arista nueva del grafo con un
 * productor nuevo— ni el dia en que alguien ensanche el criterio de conteo «para arreglar otra
 * cosa». Los dos agujeros viven FUERA de cualquier modulo concreto: uno en el inventario de
 * transiciones y el otro en dos listas de `lib/types/orden-historial.ts`.
 *
 * 💰 Y los dos cuestan DINERO en la misma direccion desde esta ficha: el contador dejo de ser un
 * numero que solo RETRASA un escalado y paso a ser uno que CIERRA PUERTAS y TERMINA ordenes en
 * `rechazada` (`cobroRechazado`, 56). Un error de conteo hacia arriba ya no retrasa nada: cobra de
 * mas, y antes.
 *
 * La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
 */

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/* ========================================================================== */
/* 1 · R33 — EL CRITERIO DE CONTEO NO SE MOVIO                                */
/* ========================================================================== */

describe("273/R33 — esta feature NO toca el criterio de conteo de intentos", () => {
  it("`RESULTADOS_QUE_CUENTAN_COMO_INTENTO` sigue siendo EXACTAMENTE los tres de la 215", () => {
    // ⚠️ LITERAL A PROPOSITO: esto es el CONTRATO, no una copia de su propia fuente. Ensanchar
    // esta lista desde la 273 —o desde cualquier ficha que no sea la que decida cambiar el
    // criterio— sube el numero de casi toda orden, cierra puertas antes de tiempo y COBRA DE MAS.
    expect([...RESULTADOS_QUE_CUENTAN_COMO_INTENTO]).toEqual([
      "rechazada",
      "devuelta",
      "reprogramada",
    ]);
  });

  it("`ORIGEN_TIPOS_VISITA_REAL` sigue siendo EXACTAMENTE las dos familias de la 215/237", () => {
    // Mismo argumento, y con mas filo: esta lista es la SEXTA condicion del predicado. Meter una
    // familia sintetica aqui hace que gestiones que nadie hizo cuenten como visitas.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toEqual(["gestion", "gestion_tienda_ayuda"]);
  });

  it("la familia NUEVA de esta ficha no entra en NINGUNA de las dos listas", () => {
    // `rechazo_tope_intentos` es una decision administrativa sobre una orden que ese dia no
    // visito nadie —ese es justo el hecho que la lleva a `sin_gestionar`—. Si entrara en
    // `ORIGEN_TIPOS_VISITA_REAL`, cada rechazo por tope sumaria un intento A SU PROPIA ORDEN.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("rechazo_tope_intentos");
    // Y tampoco en la lista que desambigua la nulidad del enlace: su fila NACE con
    // `gestion_orden_id` poblado, igual que `escalado_devuelta_sla` y `anclaje_devolucion`, que
    // tampoco estan.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain("rechazo_tope_intentos");
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });

  it("el predicado unico sigue declarandose UNA sola vez y con las seis condiciones", () => {
    // R33 dicho sobre el codigo: `whereIntentosVigentes` no se duplico ni perdio ninguna de sus
    // condiciones al pasar a tener DOS lectores nuevos (el bloque de la aprobacion del cierre y,
    // por el servicio, las puertas de asignacion).
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "repositories", "OrdenHistorialRepository.ts"),
      "utf8",
    );
    expect([...fuente.matchAll(/export\s+function\s+whereIntentosVigentes\b/g)]).toHaveLength(1);
    for (const condicion of [
      "RESULTADOS_QUE_CUENTAN_COMO_INTENTO",
      "anuladaAt: null",
      "cierreId: { not: null }",
      'cierre: { estado: "aprobado" }',
      "ORIGEN_TIPOS_VISITA_REAL",
    ]) {
      expect(fuente, `falta la condicion \`${condicion}\` del predicado unico`).toContain(
        condicion,
      );
    }
  });

  it("la lista del TOPE es una lista distinta de la del CONTEO, y no se derivan una de otra", () => {
    // Son dos preguntas: «¿esto cuenta como intento?» y «¿esto se puede registrar en el ultimo
    // intento?». Hoy son casi complementarias y por eso la tentacion de derivar una de la otra es
    // real. No lo son: `entregada` no cuenta como intento Y esta permitida en el tope; `rechazada`
    // SI cuenta como intento Y esta permitida. Derivar una de otra romperia los dos casos.
    expect([...RESULTADOS_PERMITIDOS_EN_EL_TOPE]).toEqual([
      "entregada",
      "rechazada",
      "incidente",
    ]);
    // La prueba de que NO son complementarias: `rechazada` esta en las dos.
    expect([...RESULTADOS_PERMITIDOS_EN_EL_TOPE]).toContain("rechazada");
    expect([...RESULTADOS_QUE_CUENTAN_COMO_INTENTO]).toContain("rechazada");
    // Y el modulo del tope no importa el del conteo. Se mira el CODIGO, sin comentarios: la prosa
    // de ese fichero SI nombra la otra lista —para explicar que comparte forma y no fuente— y eso
    // es deseable.
    const codigoTope = quitarComentarios(
      fs.readFileSync(path.join(REPO_ROOT, "lib", "types", "tope-intentos.ts"), "utf8"),
    );
    expect(codigoTope).not.toContain("RESULTADOS_QUE_CUENTAN_COMO_INTENTO");
    expect(codigoTope).not.toContain("@/lib/types/orden-historial");
  });
});

/* ========================================================================== */
/* 2 · R31/R32 — LAS VIAS HACIA LA CIRCULACION, ENUMERADAS Y CON PUERTA       */
/* ========================================================================== */

/**
 * «Volver a circulacion» = que la orden vuelva a estar disponible para que alguien la reparta:
 * pasar a una bodega o quedar asignada a un mensajero. Esos son los TRES destinos.
 */
const DESTINOS_DE_CIRCULACION = [
  "en_bodega_central",
  "en_bodega_satelite",
  "por_recoger",
] as const;

/**
 * EL CENSO. Cada arista del grafo que lleva a uno de esos tres destinos, con QUE la cierra o POR
 * QUE no necesita cerrarse. Escrito a mano —es el contrato—, y CONTRASTADO contra `TRANSICIONES`,
 * que es de donde se deriva la lista real.
 *
 * Si manana aparece una arista nueva hacia la circulacion y nadie la clasifica aqui, el caso de
 * abajo se pone ROJO. Eso es exactamente lo que R31 pide: que abrir una sexta via cueste una
 * decision explicita y no un descuido.
 */
const CENSO_DE_CIRCULACION: Record<string, string> = {
  // ── Las que la ficha 273 CIERRA ────────────────────────────────────────────────────────────
  "reprogramada -> en_bodega_central via liberacion_reprogramada":
    "T6 · `LiberacionReprogramadaService.puedeLiberarse` — no libera mientras la gestion vigente pueda subir el contador",
  "reprogramada -> en_bodega_satelite via liberacion_reprogramada":
    "T6 · `LiberacionReprogramadaService.puedeLiberarse`",
  "en_bodega_central -> por_recoger via asignacion_bodega":
    "T7 · `GuiaAsignacionService.asignarDesdeBodega` — guarda por lote con `MSG_TOPE_INTENTOS_ASIGNACION`",
  "en_bodega_satelite -> por_recoger via asignacion_satelite":
    "T8 · `AsignacionSateliteService.asignar` — la misma guarda y el MISMO motivo",
  "sin_gestionar -> en_bodega_central via liberacion_sin_gestionar":
    "T9 · `resolverCierre` parte el bloque: `>= umbral` va a `rechazada`, no a bodega",
  "sin_gestionar -> en_bodega_satelite via liberacion_sin_gestionar":
    "T9 · `resolverCierre` parte el bloque",
  "devuelta -> en_bodega_central via liberacion_devuelta_sla":
    "T10 · `DevolucionSlaService` — la rama `not_found` ya escalaba en el umbral en vez de liberar (99/R16)",
  "devuelta -> en_bodega_satelite via liberacion_devuelta_sla":
    "T10 · `DevolucionSlaService` — idem",

  // ── Las que quedan ABIERTAS, con su razon firmada ──────────────────────────────────────────
  "devuelta -> en_bodega_central via recuperacion_manual":
    "Q3 (firmada 2026-08-24): SE CONSERVA INTACTA. Es un movimiento FISICO que la bodega necesita registrar; la orden queda en el estante y R18 impide que salga a repartir",
  "devuelta -> en_bodega_satelite via recuperacion_manual": "Q3 (firmada): se conserva intacta",
  "por_recoger -> en_bodega_central via deshacer_asignacion":
    "design §5.4: REVIERTE una asignacion, no crea una. Bloquearlo dejaria la orden atrapada en la mano de un mensajero",
  "por_recoger -> en_bodega_satelite via deshacer_asignacion": "design §5.4: reversion, no salida",
  "en_ruta_bodega_satelite -> en_bodega_central via deshacer_asignacion":
    "design §5.4: reversion de un ruteo, no salida a reparto",

  // ── Las que NO son «volver» a circulacion: es la PRIMERA vez que entra ─────────────────────
  "en_preparacion -> en_bodega_central via generacion_guia":
    "una orden recien numerada tiene CERO intentos por construccion; no ha salido nunca",
  "en_ruta_bodega_central -> en_bodega_central via recepcion_bodega_central":
    "recepcion FISICA en bodega, no salida a reparto",
  "en_ruta_bodega_satelite -> en_bodega_satelite via recepcion_satelite":
    "recepcion FISICA en el satelite, no salida a reparto",

  // ── El flujo del incidente ─────────────────────────────────────────────────────────────────
  "incidente -> en_bodega_central via incidente":
    "resolucion de un incidente (158): decision del admin sobre un paquete dañado/perdido, fuera del alcance de la 273",
  "incidente -> en_bodega_satelite via incidente": "resolucion de un incidente (158)",
  "incidente -> por_recoger via incidente":
    "resolucion de un incidente (158). ⚠️ ES LA UNICA de esta lista que SI pone la orden en la mano de un mensajero sin pasar por la puerta del tope. Queda declarada como limite conocido de esta ficha: la decide un admin caso a caso sobre un paquete con incidente, no un flujo automatico",
};

/** Todas las aristas de `TRANSICIONES` que llevan a un destino de circulacion. DERIVADAS. */
function aristasDeCirculacion(): string[] {
  const salida: string[] = [];
  for (const [origen, destinos] of Object.entries(TRANSICIONES)) {
    for (const a of destinos as readonly { to: string; via: string }[]) {
      if ((DESTINOS_DE_CIRCULACION as readonly string[]).includes(a.to)) {
        salida.push(`${origen} -> ${a.to} via ${a.via}`);
      }
    }
  }
  return salida.sort();
}

describe("273/R31/R32 — todas las vias hacia la circulacion estan enumeradas", () => {
  it("el censo cubre EXACTAMENTE las aristas que el grafo declara hoy", () => {
    // La lista de la izquierda se DERIVA de `TRANSICIONES`; la de la derecha esta escrita a mano.
    // Si alguien anade una arista nueva hacia una bodega o hacia `por_recoger` y no la clasifica,
    // este caso falla con su nombre delante. Y si alguien borra una del censo sin borrarla del
    // grafo, tambien.
    const reales = aristasDeCirculacion();
    const censadas = Object.keys(CENSO_DE_CIRCULACION).sort();

    const sinCensar = reales.filter((a) => !censadas.includes(a));
    expect(
      sinCensar,
      "aparecio una via hacia la circulacion que nadie clasifico. Antes de anadirla al censo, " +
        "decide si necesita la puerta del tope: si la necesita y no la tiene, la ficha 273 acaba " +
        "de quedar incompleta y una orden agotada puede volver a salir a reparto.",
    ).toEqual([]);

    const fantasmas = censadas.filter((a) => !reales.includes(a));
    expect(
      fantasmas,
      "el censo vigila una arista que ya no existe en `TRANSICIONES`. Una guardia que vigila algo " +
        "muerto esta verde para siempre y no dice nada.",
    ).toEqual([]);
  });

  it("el censo mide algo de verdad: hay al menos las cinco vias del design §1", () => {
    // Contrapunto obligatorio: si `aristasDeCirculacion()` devolviera `[]` por un error de
    // derivacion, las dos igualdades de arriba pasarian sin comprobar nada.
    const reales = aristasDeCirculacion();
    expect(reales.length).toBeGreaterThanOrEqual(15);
    // Y las CUATRO que la ficha cierra estan, nombradas.
    expect(reales).toContain("reprogramada -> en_bodega_central via liberacion_reprogramada");
    expect(reales).toContain("en_bodega_central -> por_recoger via asignacion_bodega");
    expect(reales).toContain("en_bodega_satelite -> por_recoger via asignacion_satelite");
    expect(reales).toContain("sin_gestionar -> en_bodega_central via liberacion_sin_gestionar");
  });

  it("R32 — la salida de `reprogramada` hacia bodega sigue siendo la UNICA, y pasa por el cron", () => {
    // R32 dice que una orden no vuelve a estar disponible mientras exista sobre ella una gestion
    // de visita real que TODAVIA pueda subir su contador. La unica forma de sostenerlo es que
    // `reprogramada` no gane una segunda salida hacia bodega que no pase por `puedeLiberarse`.
    const salidas = (TRANSICIONES.reprogramada ?? []) as readonly { to: string; via: string }[];
    const aBodega = salidas.filter((a) =>
      (DESTINOS_DE_CIRCULACION as readonly string[]).includes(a.to),
    );
    expect(aBodega.map((a) => `${a.to}:${a.via}`).sort()).toEqual([
      "en_bodega_central:liberacion_reprogramada",
      "en_bodega_satelite:liberacion_reprogramada",
    ]);
  });

  it("R31 — `rechazada` NO tiene ninguna salida hacia la circulacion", () => {
    // Es el destino terminal de las tres rutas que la 273 usa (la gestion, el corte y el cron
    // SLA). Si `rechazada` ganara una arista hacia una bodega o hacia `por_recoger`, la orden que
    // la ficha acaba de terminar podria volver a repartirse.
    const salidas = (TRANSICIONES.rechazada ?? []) as readonly { to: string }[];
    const aCirculacion = salidas.filter((a) =>
      (DESTINOS_DE_CIRCULACION as readonly string[]).includes(a.to),
    );
    expect(aCirculacion).toEqual([]);
  });
});
