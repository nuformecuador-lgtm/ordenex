import { describe, expect, it } from "vitest";

import { GESTION_ADMIN_SELECT, toPendienteRowDesdeSnapshot } from "@/lib/repositories/CierresAdminRepository";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import {
  esGestionDeLaTienda,
  ORIGENES_GESTION_DE_LA_TIENDA,
} from "@/lib/utils/gestion-de-la-tienda-flag";
import { ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";

// 💰 Feature 237 (D6 firmada por el HUMANO el 2026-08-20, R41) — QUE EL DATO LLEGUE HASTA LA FILA.
//
// El requisito no se cumple con que el repositorio lo derive: tiene que **cruzar los dos tipos** y
// aterrizar en el DTO que la pantalla lee. Aqui se prueba ese tramo, y la derivacion pura que lo
// alimenta, con casos EMPAREJADOS: una bandera que siempre vale `true` pasa igual de verde.

/** Fila de dominio minima; sólo importa el par de banderas. */
function fila(over: Partial<CierreGestionPendienteRow> = {}): CierreGestionPendienteRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 1,
    numRemision: "R-1",
    destinatario: "D",
    direccion: "Dir",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: null,
    producto: "Prod",
    tiendaNombre: "T",
    resultado: "rechazada",
    montoRecibido: null,
    metodoPago: null,
    pagos: [],
    motivo: "m",
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

describe("💰 R41 — el dato CRUZA hasta el DTO que lee la pantalla", () => {
  it("caso emparejado: la de la tienda llega `true` y la del mensajero `false`", () => {
    const deLaTienda = toDetalleDTO(fila({ desdeAyudaTienda: true }), {});
    const delMensajero = toDetalleDTO(fila({ desdeAyudaTienda: false }), {});

    expect(deLaTienda.desdeAyudaTienda).toBe(true);
    expect(delMensajero.desdeAyudaTienda).toBe(false);
  });

  it("es PASSTHROUGH: el servicio no re-deriva ni inventa la clasificacion", () => {
    // Si el mapper decidiera por su cuenta (por `resultado`, por el motivo, por lo que fuera),
    // habria DOS definiciones de «la gestiono la tienda» y podrian divergir. Sólo hay una, y vive
    // en el repositorio.
    for (const valor of [true, false]) {
      expect(toDetalleDTO(fila({ desdeAyudaTienda: valor }), {}).desdeAyudaTienda).toBe(valor);
    }
  });

  it("las dos banderas del historial son INDEPENDIENTES: una no arrastra a la otra", () => {
    // `esRechazoSla` y `desdeAyudaTienda` salen de la MISMA lectura en el camino de admin. Si
    // alguien las cruzara, un rechazo del cron SLA se leeria como «lo hizo la tienda».
    const soloSla = toDetalleDTO(fila({ esRechazoSla: true, desdeAyudaTienda: false }), {});
    const soloTienda = toDetalleDTO(fila({ esRechazoSla: false, desdeAyudaTienda: true }), {});
    expect([soloSla.esRechazoSla, soloSla.desdeAyudaTienda]).toEqual([true, false]);
    expect([soloTienda.esRechazoSla, soloTienda.desdeAyudaTienda]).toEqual([false, true]);
  });
});

describe("R41 — la derivacion pura, y lo que significa `false`", () => {
  it("con la fila de la familia -> `true`; con la del mensajero -> `false`", () => {
    expect(esGestionDeLaTienda([{ origenTipo: "gestion_tienda_ayuda" }])).toBe(true);
    expect(esGestionDeLaTienda([{ origenTipo: "gestion" }])).toBe(false);
  });

  it("SIN historial -> `false`, y eso NO es «no lo se»", () => {
    // Es una afirmacion, no un default perezoso: la fila de historial se escribe en la MISMA
    // transaccion que la gestion (choke point), asi que una gestion de esta familia SIEMPRE tiene
    // la suya. El unico hueco son las gestiones legadas anteriores al historial (49), y esas son
    // anteriores al estatus `ayuda_tienda` (235), asi que ninguna pudo nacer por esta via.
    expect(esGestionDeLaTienda([])).toBe(false);
  });

  it("no confunde la familia del cron SLA con la de la tienda", () => {
    expect(esGestionDeLaTienda([{ origenTipo: ORIGEN_TIPO_RECHAZO_SLA }])).toBe(false);
  });
});

describe("R41 — el camino de ADMIN deriva las DOS banderas sin una consulta de mas", () => {
  it("la proyeccion pide TODAS las familias derivadas en UNA sola relacion", () => {
    // ⭑ EL COSTE. Si esto se partiera en dos relaciones —o peor, en una segunda lectura—, el
    // detalle de admin pagaria una consulta extra en la pagina que mas filas trae. Se comprueba el
    // `select` real, no el comentario.
    //
    // ⏳ 2026-08-20 (feature 240): la lista pasa de DOS a TRES con `rechazo_tienda`, que es la
    // segunda via por la que la tienda registra una gestion. El literal se actualiza A MANO: es el
    // censo de lo que esta pagina lee, y derivarlo de `GESTION_ADMIN_SELECT` lo dejaria verde para
    // siempre.
    const rel = GESTION_ADMIN_SELECT.historialEstados;
    expect(rel.where.origenTipo.in).toEqual([
      ORIGEN_TIPO_RECHAZO_SLA,
      "gestion_tienda_ayuda",
      "rechazo_tienda",
    ]);
    // ⚠️ El `take` tiene que cubrir TODAS las familias filtradas: una gestion podria, en teoria,
    // tener fila de varias, y un `take` corto haria que una tapase a la otra segun el orden de
    // lectura. Hasta la 240 era un `2` literal, que con tres familias habria truncado en silencio.
    expect(rel.take).toBe(rel.where.origenTipo.in.length);
    expect(rel.take).toBe(3);
  });

  // ---------------------------------------------------------------------------------------------
  // 💰 FEATURE 240 (T4.1, D6/R43) — la lista de familias de la tienda, que es una LISTA DE DINERO.
  // De ella cuelga el bloqueo del deshacer del mensajero: quien entre aqui deja de poder ser
  // revertido, y quien no entre puede serlo en silencio.
  // ---------------------------------------------------------------------------------------------
  it("240/R43: el rechazo MANUAL de la tienda cuenta como registrado por la tienda", () => {
    expect(esGestionDeLaTienda([{ origenTipo: "rechazo_tienda" }])).toBe(true);
  });

  it("💰 240/D6: `reprogramacion_tienda` NO entra, y la ausencia es una DECISION", () => {
    // Esa gestion sintetica (100) TAMBIEN pasa las ocho guardias del deshacer y HOY SE PUEDE
    // deshacer. Es el agujero hermano que la auditoria dejo como «no se pudo determinar»: aqui
    // queda determinado. No se cierra desde la 240 porque es dinero NEUTRO (`reprogramada` no emite
    // ningun concepto) y cambiar la conducta de la 100 sin pedirlo es alcance ajeno. Se afirma para
    // que quede como decision y no como olvido — y para que quien la meta tenga que venir aqui.
    expect(esGestionDeLaTienda([{ origenTipo: "reprogramacion_tienda" }])).toBe(false);
  });

  it("240/R43: la lista es EXACTAMENTE las dos vias de la tienda (censo cerrado)", () => {
    // ⚠️ ESTE LITERAL ES EL CONTRATO. Se actualiza a mano cuando alguien decide un alta, y jamas se
    // sustituye por una derivacion de su propia fuente: con lista blanca, lo que una familia nueva
    // hace por defecto es quedarse fuera (deshacible), y esa es la direccion segura del error solo
    // mientras alguien tenga que venir aqui a decidirlo.
    expect([...ORIGENES_GESTION_DE_LA_TIENDA]).toEqual([
      "gestion_tienda_ayuda",
      "rechazo_tienda",
    ]);
  });

  it("caso emparejado sobre el mapper de admin: mismas filas, banderas distintas", () => {
    const gestion = (origenTipos: string[]) =>
      ({
        id: "g1",
        ordenId: "o1",
        resultado: "rechazada",
        montoRecibido: null,
        metodoPago: null,
        motivo: "m",
        fechaReprogramacion: null,
        evidenciaStoragePath: null,
        pagoMensajero: null,
        ingresoBodegaRechazo: null,
        causaIncidente: null,
        indemnizacion: null,
        pagos: [],
        historialEstados: origenTipos.map((origenTipo) => ({ origenTipo })),
      }) as unknown as Parameters<typeof toPendienteRowDesdeSnapshot>[0];
    const snapshot = {
      numGuia: 1,
      numRemision: "R-1",
      destinatario: "D",
      direccion: "Dir",
      zonaNombre: "Z",
      provinciaNombre: "P",
      cantonNombre: "C",
      distritoNombre: null,
      producto: "Prod",
      tiendaNombre: "T",
      montoCobrar: null,
      cobraComision: true,
      esCentral: true,
      // `tarifaId: null` = la tienda no tenia tarifa congelada (gap R9). Es el camino que NO
      // toca `tarifaDe`, y basta: estos casos no miran dinero, miran de quien es la gestion.
      tarifaId: null,
    } as unknown as Parameters<typeof toPendienteRowDesdeSnapshot>[1];

    const deLaTienda = toPendienteRowDesdeSnapshot(
      gestion(["gestion_tienda_ayuda"]),
      snapshot,
    );
    const delCron = toPendienteRowDesdeSnapshot(gestion([ORIGEN_TIPO_RECHAZO_SLA]), snapshot);

    expect([deLaTienda.desdeAyudaTienda, deLaTienda.esRechazoSla]).toEqual([true, false]);
    expect([delCron.desdeAyudaTienda, delCron.esRechazoSla]).toEqual([false, true]);
  });
});
