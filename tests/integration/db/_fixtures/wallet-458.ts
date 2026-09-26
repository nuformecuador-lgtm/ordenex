import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { SaldosSatelitesRepository } from "@/lib/repositories/SaldosSatelitesRepository";
import { ConciliacionSatelitesService } from "@/lib/services/ConciliacionSatelitesService";

import type { TxDeTest } from "../_postgres-real";
import { montarServicios459, type Catalogo459, type Servicios459 } from "./caja-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.1 — EL ESCENARIO DE LA FOTOGRAFIA DE LAS CUENTAS (design §8.1).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// La fotografia de la 459 (`caja-caracterizacion-459`) ya ejerce TODOS los caminos de escritura
// con sus servicios reales. Lo que la 458 añade es la lectura POR CUENTA (saldo, cuenta por pagar,
// pendiente de la bodega, y desde TB.6 el saldo corrido, el saldo inicial y los totales netos),
// y esa lectura necesita algo que los servicios no pueden producir: INSTANTES FIJOS y EMPATES
// CONTROLADOS. Por eso aqui:
//
//   · las filas de la tienda C y del mensajero M se escriben A MANO con `fecha_movimiento`,
//     `created_at` e `id` elegidos (dos filas del mismo instante y MISMO `created_at`, que desempata
//     el id; y dos del mismo instante con `created_at` distinto y el id AL REVES, que solo desempata
//     bien el `created_at`). Cada fila de la tienda lleva su CONTRAPARTIDA en la caja
//     (`CONTRAPARTIDA_EN_CAJA`), escrita tambien a mano, para que R8 siga midiendo algo;
//   · el pago de un gasto de la tienda C lo escribe el SERVICIO REAL (`PagoPorCuentaTiendaService`):
//     es el control positivo de la fase 0 (quitar `emitirEgresoDePagoPorCuenta` → R8 en rojo);
//   · la bodega Z tiene tres consolidaciones: una sin marcar, una recibida de menos y una
//     RECHAZADA (que no cuenta en el pendiente).
//
// Instantes (UTC) y su dia en Costa Rica (UTC−6):
//   T1 = 2026-09-10T16:00Z → 10 sep 10:00 CR
//   T2 = 2026-09-12T05:30Z → 11 sep 23:30 CR   (borde: sigue siendo el 11 en CR, ya es el 12 en UTC)
//   T3 = 2026-09-12T06:30Z → 12 sep 00:30 CR
//   T4 = 2026-09-15T16:00Z → 15 sep 10:00 CR

export const T1 = new Date("2026-09-10T16:00:00.000Z");
export const T2 = new Date("2026-09-12T05:30:00.000Z");
export const T3 = new Date("2026-09-12T06:30:00.000Z");
export const T4 = new Date("2026-09-15T16:00:00.000Z");

const mas = (d: Date, segundos: number) => new Date(d.getTime() + segundos * 1000);

export interface Escenario458 {
  maestro: Actor;
  tiendaC: string;
  mensajeroM: string;
  zonaZ: string;
  /** Los ids de las seis filas a mano de la tienda C, por su nombre en el comentario. */
  filasC: Record<"c1" | "c2" | "c3" | "c4" | "c5" | "c6", string>;
  /** Los ids de las seis filas a mano del mensajero M. */
  filasM: Record<"m1" | "m2" | "m3" | "m4" | "m5" | "m6", string>;
  pagoPorCuentaId: string;
  pasos: Record<string, string>;
}

/**
 * Un id con forma de uuid cuyo ORDEN de texto lo decide `n`: el prefijo es el mismo para toda la
 * siembra (aleatorio, para que dos siembras no choquen) y el sufijo lleva el orden.
 */
function idOrdenado(prefijo: string, n: number): string {
  return `${prefijo}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export async function sembrarEscenario458(tx: TxDeTest, cat: Catalogo459): Promise<Escenario458> {
  const s = montarServicios459(tx);
  const sufijo = randomUUID().slice(0, 8);
  const pasos: Record<string, string> = {};
  let n = 0;

  const zona = await tx.zona.create({
    data: { sinpeNumero: "80000458", sinpeNombre: "Titular 458", nombre: `Zona satelite 458 ${sufijo}` },
    select: { id: true },
  });

  const crearUsuario = async (prefijo: string, rolId: string, zonaId: string | null) => {
    const clave = `${sufijo}-${(n += 1)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `${prefijo} 458 ${clave}`,
        email: `${prefijo.toLowerCase()}458-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa",
        cedula: `458-${prefijo}-${clave}`,
        tipoIdentificacionId: cat.tipoIdentificacionId,
        rolId,
        zonaId,
        estado: "activo",
        fulfillment: false,
      },
      select: { id: true },
    });
    return u.id;
  };

  const maestroId = await crearUsuario("Maestro", cat.rolId.maestro, null);
  const tiendaC = await crearUsuario("TiendaC", cat.rolId.adminTienda, null);
  const mensajeroM = await crearUsuario("MensajeroM", cat.rolId.mensajero, zona.id);
  const adminSat = await crearUsuario("AdminSatZ", cat.rolId.adminSatelite, zona.id);
  const maestro: Actor = { usuarioId: maestroId, rol: "maestro" };

  // ── Tienda C: seis filas a mano, cada una con su contrapartida en la caja ─────────────────
  //
  //   fila  instante  created_at  id     libro de la tienda                  caja (contrapartida)
  //   c1    T1        T1+1s       …001   credito cod_recaudado  10 000,00    ingreso_cod_recaudado
  //   c2    T1        T1+1s       …002   debito  flete           2 000,00    ingreso_flete
  //   c3    T2        T2+1s       …009   debito  cobro_manual    1 500,00    ingreso_cobro_tienda
  //   c4    T2        T2+2s       …003   debito  comision_cod      300,00    ingreso_comision_cod
  //   c5    T3        T3+1s       …005   debito  pago_tienda     3 000,00    egreso_pago_tienda
  //   c6    T4        T4+1s       …006   credito ajuste_credito  3 000,00    ingreso_reverso_pago_tienda
  //
  //   c1/c2: mismo instante Y mismo `created_at` → los ordena el id (…001 antes que …002).
  //   c3/c4: mismo instante, `created_at` c3 < c4 pero id c3 > c4 → SOLO el `created_at` los pone
  //          c3 antes que c4 (quitarlo del ORDER BY los invierte: mutacion 2 de §8.2).
  const pC = randomUUID().slice(0, 8);
  const filasC = {
    c1: idOrdenado(pC, 1),
    c2: idOrdenado(pC, 2),
    c3: idOrdenado(pC, 9),
    c4: idOrdenado(pC, 3),
    c5: idOrdenado(pC, 5),
    c6: idOrdenado(pC, 6),
  };
  type FilaTienda = {
    id: string;
    fecha: Date;
    creada: Date;
    tipo: "credito" | "debito";
    categoria: "cod_recaudado" | "flete" | "cobro_manual" | "comision_cod" | "pago_tienda" | "ajuste_credito";
    monto: string;
    origen: "cierre_dia" | "manual" | "pago_tienda";
    caja: {
      tipo: "ingreso" | "egreso";
      categoria:
        | "ingreso_cod_recaudado"
        | "ingreso_flete"
        | "ingreso_cobro_tienda"
        | "ingreso_comision_cod"
        | "egreso_pago_tienda"
        | "ingreso_reverso_pago_tienda";
      origen: "cierre_dia" | "cobro_tienda" | "pago_tienda";
    };
  };
  const cierreC = randomUUID();
  const pagoC = randomUUID();
  const filasTienda: FilaTienda[] = [
    { id: filasC.c1, fecha: T1, creada: mas(T1, 1), tipo: "credito", categoria: "cod_recaudado", monto: "10000.00", origen: "cierre_dia", caja: { tipo: "ingreso", categoria: "ingreso_cod_recaudado", origen: "cierre_dia" } },
    { id: filasC.c2, fecha: T1, creada: mas(T1, 1), tipo: "debito", categoria: "flete", monto: "2000.00", origen: "cierre_dia", caja: { tipo: "ingreso", categoria: "ingreso_flete", origen: "cierre_dia" } },
    { id: filasC.c3, fecha: T2, creada: mas(T2, 1), tipo: "debito", categoria: "cobro_manual", monto: "1500.00", origen: "manual", caja: { tipo: "ingreso", categoria: "ingreso_cobro_tienda", origen: "cobro_tienda" } },
    { id: filasC.c4, fecha: T2, creada: mas(T2, 2), tipo: "debito", categoria: "comision_cod", monto: "300.00", origen: "cierre_dia", caja: { tipo: "ingreso", categoria: "ingreso_comision_cod", origen: "cierre_dia" } },
    { id: filasC.c5, fecha: T3, creada: mas(T3, 1), tipo: "debito", categoria: "pago_tienda", monto: "3000.00", origen: "pago_tienda", caja: { tipo: "egreso", categoria: "egreso_pago_tienda", origen: "pago_tienda" } },
    { id: filasC.c6, fecha: T4, creada: mas(T4, 1), tipo: "credito", categoria: "ajuste_credito", monto: "3000.00", origen: "pago_tienda", caja: { tipo: "ingreso", categoria: "ingreso_reverso_pago_tienda", origen: "pago_tienda" } },
  ];
  for (const f of filasTienda) {
    const origenIdTienda = f.origen === "manual" ? null : f.origen === "cierre_dia" ? cierreC : pagoC;
    await tx.walletTiendaMovimiento.create({
      data: {
        id: f.id,
        tiendaId: tiendaC,
        tipo: f.tipo,
        categoria: f.categoria,
        monto: f.monto,
        origenTipo: f.origen,
        origenId: origenIdTienda,
        descripcion: `458 ${f.categoria}`,
        registradoPor: f.origen === "manual" ? maestroId : null,
        fechaMovimiento: f.fecha,
        createdAt: f.creada,
      },
    });
    // La contrapartida en la caja: mismo instante, mismo importe. `origen_id` propio por fila para
    // no chocar con el indice unico parcial `(origen_tipo, origen_id, categoria)`.
    await tx.walletMovimiento.create({
      data: {
        tipo: f.caja.tipo,
        categoria: f.caja.categoria,
        monto: f.monto,
        origenTipo: f.caja.origen,
        origenId: f.caja.origen === "cobro_tienda" ? f.id : randomUUID(),
        descripcion: `458 caja ${f.caja.categoria}`,
        registradoPor: null,
        fechaMovimiento: f.fecha,
        createdAt: f.creada,
      },
    });
  }

  // El pago de un gasto de la tienda C, por el SERVICIO REAL (control positivo de la fase 0).
  const pago = await s.pagoPorCuenta.registrar(
    {
      claveIdempotencia: randomUUID(),
      tiendaId: tiendaC,
      beneficiario: "Imprenta 458",
      monto: "1000.00",
      metodo: "SINPE",
      referencia: "INV-458",
      motivo: "Etiquetas 458",
    },
    null,
    maestro,
  );
  pasos.pagoPorCuentaC = pago.status;
  if (pago.status !== "ok") throw new Error(`escenario 458: pago por cuenta ${JSON.stringify(pago)}`);

  // ── Mensajero M: seis filas a mano ────────────────────────────────────────────────────────
  //
  //   fila  instante  created_at  id    tipo     categoria        monto
  //   m1    T1        T1+1s       …001  devengo  pago_devengado   4 500,00
  //   m2    T1        T1+1s       …002  pago     pago_efectivo    2 000,00
  //   m3    T2        T2+1s       …009  pago     liquidacion      1 000,00
  //   m4    T2        T2+2s       …003  devengo  ajuste_devengo   1 000,00   (la anulacion de m3)
  //   m5    T4        T4+1s       …005  devengo  pago_devengado   1 500,00
  //   m6    T4        T4+2s       …006  pago     liquidacion        700,00
  const pM = randomUUID().slice(0, 8);
  const filasM = {
    m1: idOrdenado(pM, 1),
    m2: idOrdenado(pM, 2),
    m3: idOrdenado(pM, 9),
    m4: idOrdenado(pM, 3),
    m5: idOrdenado(pM, 5),
    m6: idOrdenado(pM, 6),
  };
  const cierreM1 = randomUUID();
  const cierreM2 = randomUUID();
  const pagoM1 = randomUUID();
  const pagoM2 = randomUUID();
  const filasMensajero = [
    { id: filasM.m1, fecha: T1, creada: mas(T1, 1), tipo: "devengo", categoria: "pago_devengado", monto: "4500.00", origen: "cierre_dia", origenId: cierreM1 },
    { id: filasM.m2, fecha: T1, creada: mas(T1, 1), tipo: "pago", categoria: "pago_efectivo", monto: "2000.00", origen: "cierre_dia", origenId: cierreM1 },
    { id: filasM.m3, fecha: T2, creada: mas(T2, 1), tipo: "pago", categoria: "liquidacion", monto: "1000.00", origen: "pago_mensajero", origenId: pagoM1 },
    { id: filasM.m4, fecha: T2, creada: mas(T2, 2), tipo: "devengo", categoria: "ajuste_devengo", monto: "1000.00", origen: "pago_mensajero", origenId: pagoM1 },
    { id: filasM.m5, fecha: T4, creada: mas(T4, 1), tipo: "devengo", categoria: "pago_devengado", monto: "1500.00", origen: "cierre_dia", origenId: cierreM2 },
    { id: filasM.m6, fecha: T4, creada: mas(T4, 2), tipo: "pago", categoria: "liquidacion", monto: "700.00", origen: "pago_mensajero", origenId: pagoM2 },
  ] as const;
  for (const f of filasMensajero) {
    await tx.pagoMensajeroMovimiento.create({
      data: {
        id: f.id,
        mensajeroId: mensajeroM,
        tipo: f.tipo,
        categoria: f.categoria,
        monto: f.monto,
        origenTipo: f.origen,
        origenId: f.origenId,
        descripcion: `458 ${f.categoria}`,
        registradoPor: null,
        fechaMovimiento: f.fecha,
        createdAt: f.creada,
      },
    });
  }

  // ── Bodega Z: tres consolidaciones ────────────────────────────────────────────────────────
  //   b1  solicitada, sin marcar          efectivo 5 000,00                → pendiente 5 000,00
  //   b2  aprobada, recibida de MENOS     efectivo 4 500,00, recibido 4 000 → pendiente   500,00
  //   b3  RECHAZADA                       efectivo 9 999,00                → no cuenta
  await tx.cierreBodega.create({
    data: {
      zonaId: zona.id,
      solicitadoPor: adminSat,
      estado: "solicitado",
      totalEfectivo: "5000.00",
      totalGeneral: "5000.00",
      solicitadoAt: T1,
    },
  });
  await tx.cierreBodega.create({
    data: {
      zonaId: zona.id,
      solicitadoPor: adminSat,
      estado: "aprobado",
      totalEfectivo: "4500.00",
      totalGeneral: "6000.00",
      solicitadoAt: T2,
      resueltoPor: maestroId,
      resueltoAt: T3,
      conciliadoAt: T3,
      conciliadoPor: maestroId,
      montoRecibido: "4000.00",
    },
  });
  await tx.cierreBodega.create({
    data: {
      zonaId: zona.id,
      solicitadoPor: adminSat,
      estado: "rechazado",
      totalEfectivo: "9999.00",
      totalGeneral: "9999.00",
      solicitadoAt: T4,
      resueltoPor: maestroId,
      resueltoAt: T4,
      motivoRechazo: "Rechazada 458",
    },
  });

  return {
    maestro,
    tiendaC,
    mensajeroM,
    zonaZ: zona.id,
    filasC,
    filasM,
    pagoPorCuentaId: pago.pago.id,
    pasos,
  };
}

/** El pendiente de una bodega, por la lectura de `/wallet/satelites`. */
export async function leerBodega(tx: TxDeTest, s: Servicios459, actor: Actor, zonaId: string) {
  const servicio = new ConciliacionSatelitesService(new SaldosSatelitesRepository(s.cliente), {
    marcarConciliado: async () => {
      throw new Error("la fotografia 458 no marca conciliaciones");
    },
    revertirConciliacion: async () => {
      throw new Error("la fotografia 458 no revierte conciliaciones");
    },
  });
  void tx;
  const r = await servicio.listarSaldosSatelitesCompleto({}, actor);
  if (r.status !== "ok") throw new Error(`la lectura de las bodegas respondio ${r.status}`);
  const fila = r.items.find((z) => z.zonaId === zonaId);
  if (fila === undefined) throw new Error(`la bodega ${zonaId} no aparece en los saldos`);
  return {
    saldoSinConciliar: fila.saldoSinConciliar,
    totalEfectivo: fila.totalEfectivo,
    totalRecibido: fila.totalRecibido,
  };
}

/** Suma de importes STRING con `Prisma.Decimal`, escala 2. */
export function sumar(...xs: string[]): string {
  return xs.reduce((a, x) => a.add(new Prisma.Decimal(x)), new Prisma.Decimal(0)).toFixed(2);
}
