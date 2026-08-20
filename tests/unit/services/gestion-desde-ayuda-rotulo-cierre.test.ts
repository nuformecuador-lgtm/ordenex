import { describe, expect, it } from "vitest";

import { GESTION_ADMIN_SELECT, toPendienteRowDesdeSnapshot } from "@/lib/repositories/CierresAdminRepository";
import { toDetalleDTO } from "@/lib/services/CierreDiaService";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import {
  esGestionDesdeAyudaTienda,
  ORIGEN_TIPO_GESTION_TIENDA_AYUDA,
} from "@/lib/utils/gestion-tienda-ayuda-flag";
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
    expect(esGestionDesdeAyudaTienda([{ origenTipo: ORIGEN_TIPO_GESTION_TIENDA_AYUDA }])).toBe(true);
    expect(esGestionDesdeAyudaTienda([{ origenTipo: "gestion" }])).toBe(false);
  });

  it("SIN historial -> `false`, y eso NO es «no lo se»", () => {
    // Es una afirmacion, no un default perezoso: la fila de historial se escribe en la MISMA
    // transaccion que la gestion (choke point), asi que una gestion de esta familia SIEMPRE tiene
    // la suya. El unico hueco son las gestiones legadas anteriores al historial (49), y esas son
    // anteriores al estatus `ayuda_tienda` (235), asi que ninguna pudo nacer por esta via.
    expect(esGestionDesdeAyudaTienda([])).toBe(false);
  });

  it("no confunde la familia del cron SLA con la de la tienda", () => {
    expect(esGestionDesdeAyudaTienda([{ origenTipo: ORIGEN_TIPO_RECHAZO_SLA }])).toBe(false);
  });
});

describe("R41 — el camino de ADMIN deriva las DOS banderas sin una consulta de mas", () => {
  it("la proyeccion pide las dos familias en UNA sola relacion", () => {
    // ⭑ EL COSTE. Si esto se partiera en dos relaciones —o peor, en una segunda lectura—, el
    // detalle de admin pagaria una consulta extra en la pagina que mas filas trae. Se comprueba el
    // `select` real, no el comentario.
    const rel = GESTION_ADMIN_SELECT.historialEstados;
    expect(rel.where.origenTipo.in).toEqual([
      ORIGEN_TIPO_RECHAZO_SLA,
      ORIGEN_TIPO_GESTION_TIENDA_AYUDA,
    ]);
    // `take: 2` y no 1: son dos familias y una no puede tapar a la otra segun el orden de lectura.
    expect(rel.take).toBe(2);
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
      gestion([ORIGEN_TIPO_GESTION_TIENDA_AYUDA]),
      snapshot,
    );
    const delCron = toPendienteRowDesdeSnapshot(gestion([ORIGEN_TIPO_RECHAZO_SLA]), snapshot);

    expect([deLaTienda.desdeAyudaTienda, deLaTienda.esRechazoSla]).toEqual([true, false]);
    expect([delCron.desdeAyudaTienda, delCron.esRechazoSla]).toEqual([false, true]);
  });
});
