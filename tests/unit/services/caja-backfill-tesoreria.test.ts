import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaBackfillClient,
  InformeBackfillCaja,
  ModoBackfillCaja,
} from "@/lib/interfaces/services/ICajaBackfillTesoreriaService";
import {
  CajaBackfillTesoreriaService,
  RecolectorDeFilasDeCaja,
} from "@/lib/services/CajaBackfillTesoreriaService";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  WALLET_ORIGEN_TIPO_SEED,
} from "@/lib/types/wallet";
import { codigoSinComentarios } from "../../fixtures/money-safe";

/**
 * Feature 173 / T E.1 (R36, R37, R38, R40, R41, R42, R43, R44) — el registro RETROACTIVO.
 *
 * Lo que esta suite persigue no es «que inserte»: es **que no pueda hacer otra cosa**.
 *
 *  - Escribe dinero histórico en un libro append-only ⇒ se afirma **cero** `update`, `delete` y
 *    `upsert` con espías sobre los cinco delegados de Prisma, no con un comentario (R42).
 *  - Un movimiento fechado con el reloj cae en el mes en que alguien corrió el script y
 *    descuadra todo informe por rango, para siempre ⇒ el reloj de la prueba es **Navidad**, un
 *    día que no aparece en ningún dato, y ninguna fila puede llevarlo (R41).
 *  - Una segunda fórmula para el mismo dinero no da un error, da una discusión ⇒ el servicio
 *    real corre con el feed REAL de la Tanda B y el puerto REAL de la Tanda C, y se comprueba
 *    que su fuente **no nombra ni una categoría ni un `origen_tipo`** del catálogo.
 */

/* -------------------------------------------------------------------------- */
/* El mundo                                                                    */
/* -------------------------------------------------------------------------- */

type MetodoDePrueba = "efectivo" | "SINPE" | "transferencia";

interface FilaCierre {
  id: string;
  estado: "solicitado" | "aprobado" | "rechazado";
  resueltoAt: Date | null;
  solicitadoAt: Date;
}

interface FilaLedger {
  origenTipo: string;
  origenId: string;
  categoria: string;
  tipo: string;
  monto: Prisma.Decimal;
}

interface FilaPago {
  id: string;
  tiendaId: string | null;
  monto: Prisma.Decimal;
  metodo: MetodoDePrueba;
  referencia: string | null;
  fechaPago: Date;
  registradoPor: string;
}

interface FilaAnulacion {
  pagoId: string;
  createdAt: Date;
  anuladoPor: string;
}

interface FilaCaja {
  origenTipo: string;
  origenId: string | null;
  categoria: string;
  fechaMovimiento: Date;
}

interface Mundo {
  cierres: FilaCierre[];
  ledger: FilaLedger[];
  pagos: FilaPago[];
  anulaciones: FilaAnulacion[];
  caja: FilaCaja[];
}

/** El reloj de la prueba: **Navidad**, y ni un solo dato del mundo cae ese día (R41). */
const RELOJ = new Date("2026-12-25T18:30:00.000Z");

const CIERRE_A = "cierre-a"; // aprobado, con COD y con movimientos de caja propios
const CIERRE_B = "cierre-b"; // aprobado, con COD y SIN movimientos de caja -> resuelto_at
const CIERRE_C = "cierre-c"; // aprobado, con COD, sin caja y SIN resuelto_at -> solicitado_at
const CIERRE_D = "cierre-d"; // aprobado, SIN contra-entrega -> no emite fila (R13)
const CIERRE_E = "cierre-e"; // SOLICITADO: no se toca (R36 habla de los ya APROBADOS)
const CIERRE_F = "cierre-f"; // aprobado, con COD y su fila de caja YA escrita (camino vivo)

const PAGO_1 = "pago-1"; // a tienda, sin su egreso en la caja
const PAGO_2 = "pago-2"; // a MENSAJERO: no genera nada, `[P2]` = (a)
const PAGO_3 = "pago-3"; // a tienda, con su egreso YA escrito por el camino vivo

/** El instante en que cayeron los movimientos de caja del cierre A (design §6.2). */
const CAJA_DEL_CIERRE_A = new Date("2026-07-05T09:00:00.000Z");
/** Su `resuelto_at` cae DESPUES: si el backfill lo usara, la fila no caeria con sus hermanas. */
const RESUELTO_CIERRE_A = new Date("2026-07-05T09:00:02.000Z");
const RESUELTO_CIERRE_B = new Date("2026-06-10T11:22:33.000Z");
const SOLICITADO_CIERRE_C = new Date("2026-05-02T08:00:00.000Z");
const FECHA_PAGO_1 = new Date("2026-07-30T00:00:00.000Z");
/** 2026-08-06 a las 04:00 UTC son las 22:00 del **5** en Costa Rica (UTC-6). */
const ANULACION_1_CREADA = new Date("2026-08-06T04:00:00.000Z");
const DIA_DE_LA_ANULACION_1 = new Date("2026-08-05T00:00:00.000Z");

function mundoBase(): Mundo {
  const dec = (v: string) => new Prisma.Decimal(v);
  return {
    cierres: [
      { id: CIERRE_A, estado: "aprobado", resueltoAt: RESUELTO_CIERRE_A, solicitadoAt: new Date("2026-07-04T20:00:00.000Z") },
      { id: CIERRE_B, estado: "aprobado", resueltoAt: RESUELTO_CIERRE_B, solicitadoAt: new Date("2026-06-09T20:00:00.000Z") },
      { id: CIERRE_C, estado: "aprobado", resueltoAt: null, solicitadoAt: SOLICITADO_CIERRE_C },
      { id: CIERRE_D, estado: "aprobado", resueltoAt: new Date("2026-04-01T10:00:00.000Z"), solicitadoAt: new Date("2026-03-31T10:00:00.000Z") },
      { id: CIERRE_E, estado: "solicitado", resueltoAt: null, solicitadoAt: new Date("2026-08-01T10:00:00.000Z") },
      { id: CIERRE_F, estado: "aprobado", resueltoAt: new Date("2026-07-20T10:00:00.000Z"), solicitadoAt: new Date("2026-07-19T10:00:00.000Z") },
    ],
    ledger: [
      // Cierre A: dos tiendas con contra-entrega, MAS un debito de flete y un credito de otra
      // categoria. Los cuatro comparten origen a proposito: si al WHERE del feed le faltara
      // `categoria` o `tipo`, la caja se comeria dinero que no es contra-entrega.
      { origenTipo: "cierre_dia", origenId: CIERRE_A, categoria: "cod_recaudado", tipo: "credito", monto: dec("12500.75") },
      { origenTipo: "cierre_dia", origenId: CIERRE_A, categoria: "cod_recaudado", tipo: "credito", monto: dec("300.25") },
      { origenTipo: "cierre_dia", origenId: CIERRE_A, categoria: "flete", tipo: "debito", monto: dec("1000.00") },
      { origenTipo: "cierre_dia", origenId: CIERRE_A, categoria: "ajuste_credito", tipo: "credito", monto: dec("999.00") },
      { origenTipo: "cierre_dia", origenId: CIERRE_B, categoria: "cod_recaudado", tipo: "credito", monto: dec("5000.00") },
      { origenTipo: "cierre_dia", origenId: CIERRE_C, categoria: "cod_recaudado", tipo: "credito", monto: dec("250.50") },
      // Cierre D: solo debitos. R13 hacia atras: ni una fila, ni siquiera en 0.00.
      { origenTipo: "cierre_dia", origenId: CIERRE_D, categoria: "flete", tipo: "debito", monto: dec("800.00") },
      // Cierre E: tiene contra-entrega, pero NO esta aprobado.
      { origenTipo: "cierre_dia", origenId: CIERRE_E, categoria: "cod_recaudado", tipo: "credito", monto: dec("77777.00") },
      { origenTipo: "cierre_dia", origenId: CIERRE_F, categoria: "cod_recaudado", tipo: "credito", monto: dec("4000.00") },
    ],
    pagos: [
      { id: PAGO_1, tiendaId: "t-1", monto: dec("15000.50"), metodo: "SINPE", referencia: "1234567", fechaPago: FECHA_PAGO_1, registradoPor: "u-admin" },
      { id: PAGO_2, tiendaId: null, monto: dec("9999.00"), metodo: "efectivo", referencia: null, fechaPago: new Date("2026-07-31T00:00:00.000Z"), registradoPor: "u-admin" },
      { id: PAGO_3, tiendaId: "t-2", monto: dec("2000.00"), metodo: "efectivo", referencia: null, fechaPago: new Date("2026-07-15T00:00:00.000Z"), registradoPor: "u-admin" },
    ],
    anulaciones: [
      { pagoId: PAGO_1, createdAt: ANULACION_1_CREADA, anuladoPor: "u-maestro" },
      // La anulacion de un pago a MENSAJERO: tampoco genera nada.
      { pagoId: PAGO_2, createdAt: new Date("2026-08-02T15:00:00.000Z"), anuladoPor: "u-maestro" },
    ],
    caja: [
      // Lo que la aprobacion del cierre A ya escribio (42/44). El mas temprano manda.
      { origenTipo: "cierre_dia", origenId: CIERRE_A, categoria: "ingreso_flete", fechaMovimiento: CAJA_DEL_CIERRE_A },
      { origenTipo: "cierre_dia", origenId: CIERRE_A, categoria: "egreso_pago_mensajero", fechaMovimiento: new Date("2026-07-05T09:00:01.000Z") },
      // El cierre F y el pago 3 YA pasaron por el camino vivo de las tandas B y C.
      { origenTipo: "cierre_dia", origenId: CIERRE_F, categoria: "ingreso_cod_recaudado", fechaMovimiento: new Date("2026-07-20T10:00:00.000Z") },
      { origenTipo: "pago_tienda", origenId: PAGO_3, categoria: "egreso_pago_tienda", fechaMovimiento: new Date("2026-07-15T00:00:00.000Z") },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Los dobles                                                                  */
/* -------------------------------------------------------------------------- */

/** Las siete formas de escribir de Prisma. Ninguna puede llamarse (R42). */
const ESCRITURAS = [
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
] as const;

type Espias = Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function espiasDeEscritura(delegados: readonly string[]): Espias {
  const espias: Espias = {};
  for (const delegado of delegados) {
    espias[delegado] = {};
    for (const metodo of ESCRITURAS) espias[delegado][metodo] = vi.fn();
  }
  return espias;
}

const DELEGADOS = [
  "cierreDia",
  "liquidacionPago",
  "liquidacionAnulacion",
  "walletTiendaMovimiento",
  "walletMovimiento",
] as const;

/**
 * Un cliente que **honra el WHERE** como lo haria Postgres, y que LANZA si el filtro que
 * espera no viene. Con un doble complaciente, olvidar `estado: "aprobado"` o `tipo: "credito"`
 * seguiria verde y el fallo solo se veria en produccion, sobre dinero.
 */
function clienteFalso(mundo: Mundo): { cliente: CajaBackfillClient; espias: Espias } {
  const espias = espiasDeEscritura(DELEGADOS);
  const cliente = {
    cierreDia: {
      ...espias.cierreDia,
      findMany: vi.fn(async (args: { where?: { estado?: string } }) => {
        const estado = args.where?.estado;
        if (estado === undefined) throw new Error("el backfill dejo de acotar por estado");
        return mundo.cierres
          .filter((c) => c.estado === estado)
          .map((c) => ({ id: c.id, resueltoAt: c.resueltoAt, solicitadoAt: c.solicitadoAt }))
          .sort((a, b) => a.id.localeCompare(b.id));
      }),
    },
    liquidacionPago: {
      ...espias.liquidacionPago,
      findMany: vi.fn(async (args: { where?: { tiendaId?: { not?: unknown } } }) => {
        if (args.where?.tiendaId?.not !== null) {
          throw new Error("el backfill dejo de acotar los pagos a los de TIENDA");
        }
        return mundo.pagos
          .filter((p) => p.tiendaId !== null)
          .sort((a, b) => a.id.localeCompare(b.id));
      }),
    },
    liquidacionAnulacion: {
      ...espias.liquidacionAnulacion,
      findMany: vi.fn(
        async (args: { where?: { pago?: { tiendaId?: { not?: unknown } } } }) => {
          if (args.where?.pago?.tiendaId?.not !== null) {
            throw new Error("el backfill dejo de acotar las anulaciones a las de TIENDA");
          }
          return mundo.anulaciones
            .map((a) => ({ ...a, pago: mundo.pagos.find((p) => p.id === a.pagoId) }))
            .filter((a) => a.pago !== undefined && a.pago.tiendaId !== null)
            .map((a) => ({
              pagoId: a.pagoId,
              createdAt: a.createdAt,
              anuladoPor: a.anuladoPor,
              pago: {
                monto: a.pago!.monto,
                metodo: a.pago!.metodo,
                referencia: a.pago!.referencia,
              },
            }))
            .sort((a, b) => a.pagoId.localeCompare(b.pagoId));
        },
      ),
    },
    walletTiendaMovimiento: {
      ...espias.walletTiendaMovimiento,
      findMany: vi.fn(
        async (args: {
          where?: { origenTipo?: string; origenId?: string; categoria?: string; tipo?: string };
        }) => {
          const w = args.where ?? {};
          for (const clave of ["origenTipo", "origenId", "categoria", "tipo"] as const) {
            if (w[clave] === undefined) throw new Error(`al feed del COD le falta ${clave}`);
          }
          return mundo.ledger
            .filter(
              (m) =>
                m.origenTipo === w.origenTipo &&
                m.origenId === w.origenId &&
                m.categoria === w.categoria &&
                m.tipo === w.tipo,
            )
            .map((m) => ({ monto: m.monto }));
        },
      ),
    },
    walletMovimiento: {
      ...espias.walletMovimiento,
      findMany: vi.fn(
        async (args: {
          where?: { origenTipo?: { in?: string[] }; origenId?: { in?: string[] } };
        }) => {
          const tipos = args.where?.origenTipo?.in;
          const ids = args.where?.origenId?.in;
          if (tipos === undefined || ids === undefined) {
            throw new Error("el backfill leyo la caja ENTERA en vez de las claves candidatas");
          }
          return mundo.caja.filter(
            (m) => tipos.includes(m.origenTipo) && m.origenId !== null && ids.includes(m.origenId),
          );
        },
      ),
    },
  };
  return { cliente: cliente as unknown as CajaBackfillClient, espias };
}

/** El repositorio de la caja: **espía**, y solo `crearMovimientos` hace algo. */
function repoDeCaja() {
  const escrituras: CrearMovimientoInput[][] = [];
  const repo = {
    crearMovimientos: vi.fn(async (_tx: unknown, movs: CrearMovimientoInput[]) => {
      escrituras.push(movs);
      return movs.length;
    }),
    listar: vi.fn(),
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  };
  return { repo: repo as unknown as IWalletMovimientoRepository, espia: repo, escrituras };
}

function armar(mundo: Mundo) {
  const { cliente, espias } = clienteFalso(mundo);
  const { repo, espia, escrituras } = repoDeCaja();
  const servicio = new CajaBackfillTesoreriaService({
    cliente,
    // Los emisores REALES del camino vivo: lo que aqui se mide son SUS filas.
    codFeed: new CajaCodFeedService(),
    crearPuertoDePago: (recolector) => new CajaPagoTiendaFeedService(recolector),
    cajaRepo: repo,
    ahora: () => RELOJ,
  });
  return { servicio, espias, repoEspia: espia, escrituras, cliente };
}

async function informeDe(mundo: Mundo, modo: ModoBackfillCaja): Promise<InformeBackfillCaja> {
  return armar(mundo).servicio.ejecutar(modo);
}

/** Lo pendiente de un documento concreto, para no depender del orden del array. */
function pendienteDe(informe: InformeBackfillCaja, documentoId: string, categoria: string) {
  return informe.pendientes.find(
    (p) => p.documentoId === documentoId && p.movimiento.categoria === categoria,
  );
}

const FUENTE = "lib/services/CajaBackfillTesoreriaService.ts";

/* -------------------------------------------------------------------------- */
/* R36 — los cierres ya aprobados                                              */
/* -------------------------------------------------------------------------- */

describe("R36 — el contra-entrega de todo cierre YA APROBADO entra en la caja", () => {
  it("emite UN ingreso por cierre, con la SUMA EXACTA de sus creditos de contra-entrega", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    const a = pendienteDe(informe, CIERRE_A, "ingreso_cod_recaudado");
    expect(a).toBeDefined();
    // 12500.75 + 300.25 = 12801.00. El debito de flete (1000.00) y el ajuste (999.00) NO entran:
    // el WHERE del feed de la Tanda B los deja fuera, y este backfill no los conoce siquiera.
    expect(a?.movimiento.monto).toBe("12801.00");
    expect(a?.movimiento.tipo).toBe("ingreso");
    expect(a?.movimiento.origenTipo).toBe("cierre_dia");
    expect(a?.movimiento.origenId).toBe(CIERRE_A);
    // Automatico: la autoria humana vive en `cierre_dia.resuelto_por`, igual que en la Tanda B.
    expect(a?.movimiento.registradoPor ?? null).toBeNull();
  });

  it("un cierre SIN contra-entrega no emite fila, ni siquiera en 0.00 (R13 hacia atras)", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.pendientes.filter((p) => p.documentoId === CIERRE_D)).toEqual([]);
  });

  it("un cierre que NO esta aprobado no se toca, aunque tenga contra-entrega en el ledger", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.pendientes.filter((p) => p.documentoId === CIERRE_E)).toEqual([]);
    // Y el conteo de examinados no lo cuenta: son 5 aprobados de 6 cierres.
    expect(informe.examinados.cierre_aprobado).toBe(5);
  });

  it("money-safe: dos creditos que en coma flotante darian 0.30000000000000004 dan 0.30", async () => {
    const mundo = mundoBase();
    mundo.ledger = [
      { origenTipo: "cierre_dia", origenId: CIERRE_B, categoria: "cod_recaudado", tipo: "credito", monto: new Prisma.Decimal("0.10") },
      { origenTipo: "cierre_dia", origenId: CIERRE_B, categoria: "cod_recaudado", tipo: "credito", monto: new Prisma.Decimal("0.20") },
    ];
    const informe = await informeDe(mundo, "simular");

    expect(pendienteDe(informe, CIERRE_B, "ingreso_cod_recaudado")?.movimiento.monto).toBe("0.30");
  });

  it("su fuente no convierte dinero a numero en ningun sitio", () => {
    const codigo = codigoSinComentarios(FUENTE);

    for (const prohibida of [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/]) {
      expect(codigo, `${FUENTE} usa ${prohibida}`).not.toMatch(prohibida);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R37 / R38 — los pagos a tienda y sus anulaciones                            */
/* -------------------------------------------------------------------------- */

describe("R37 — el egreso de todo pago a tienda ya registrado", () => {
  it("emite UN egreso `egreso_pago_tienda` con el monto, el origen y la descripcion del documento", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    const pago = pendienteDe(informe, PAGO_1, "egreso_pago_tienda");
    expect(pago).toBeDefined();
    expect(pago?.movimiento.tipo).toBe("egreso");
    expect(pago?.movimiento.monto).toBe("15000.50");
    expect(pago?.movimiento.origenTipo).toBe("pago_tienda");
    expect(pago?.movimiento.origenId).toBe(PAGO_1);
    // La MISMA descripcion que escribe el camino vivo: `descripcionDePago`, no una copia.
    expect(pago?.movimiento.descripcion).toBe("SINPE · 1234567");
    expect(pago?.movimiento.registradoPor).toBe("u-admin");
  });

  it("`[P2]` = (a): un pago a MENSAJERO no genera absolutamente nada", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.pendientes.filter((p) => p.documentoId === PAGO_2)).toEqual([]);
    // Ni siquiera se examina: el WHERE lo deja fuera. Son 2 pagos a tienda de 3 documentos.
    expect(informe.examinados.pago_a_tienda).toBe(2);
    // Y ninguna fila del informe lleva la categoria del mensajero.
    expect(
      informe.pendientes.map((p) => p.movimiento.categoria as string),
    ).not.toContain("egreso_pago_mensajero");
  });
});

describe("R38 — el reverso de toda anulacion de pago a tienda ya registrada", () => {
  it("emite `ingreso_reverso_pago_tienda` —jamas `ingreso_ajuste`— por el monto del pago", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    const reverso = pendienteDe(informe, PAGO_1, "ingreso_reverso_pago_tienda");
    expect(reverso).toBeDefined();
    expect(reverso?.movimiento.tipo).toBe("ingreso");
    expect(reverso?.movimiento.monto).toBe("15000.50");
    expect(reverso?.movimiento.descripcion).toBe("Anulación de pago · SINPE · 1234567");
    expect(reverso?.movimiento.registradoPor).toBe("u-maestro"); // quien ANULO, no quien pago
    // `ingreso_ajuste` es de naturaleza PROPIA: usarlo subiria la ganancia de Ordenex por
    // anular un error administrativo (design §10-C). Nunca puede aparecer aqui.
    expect(informe.pendientes.map((p) => p.movimiento.categoria as string)).not.toContain(
      "ingreso_ajuste",
    );
  });

  it("el egreso y su reverso COMPARTEN la clave de origen y se distinguen por la categoria", async () => {
    const informe = await informeDe(mundoBase(), "simular");
    const delPago = informe.pendientes.filter((p) => p.documentoId === PAGO_1);

    expect(delPago).toHaveLength(2);
    expect(delPago.map((p) => p.movimiento.origenTipo)).toEqual(["pago_tienda", "pago_tienda"]);
    expect(delPago.map((p) => p.movimiento.origenId)).toEqual([PAGO_1, PAGO_1]);
    expect(delPago.map((p) => p.movimiento.categoria).sort()).toEqual([
      "egreso_pago_tienda",
      "ingreso_reverso_pago_tienda",
    ]);
  });

  it("la anulacion de un pago a MENSAJERO tampoco genera nada", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.examinados.anulacion_de_pago_a_tienda).toBe(1); // de las 2 que hay
    expect(informe.pendientes.filter((p) => p.documentoId === PAGO_2)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R41 — las fechas salen del ORIGEN                                           */
/* -------------------------------------------------------------------------- */

describe("R41 — ninguna fila se fecha con el reloj; todas con la coordenada de su origen", () => {
  it("con el reloj en NAVIDAD, ni una sola fila lleva esa fecha", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.pendientes.length).toBeGreaterThan(0);
    for (const p of informe.pendientes) {
      const fecha = p.movimiento.fechaMovimiento;
      expect(fecha, `${p.origen}/${p.documentoId} sin fecha`).toBeInstanceOf(Date);
      expect(fecha?.toISOString(), `${p.origen}/${p.documentoId}`).not.toBe(RELOJ.toISOString());
      // Y ademas es ANTERIOR al reloj: una fila del pasado no puede caer en el futuro.
      expect(fecha!.getTime()).toBeLessThan(RELOJ.getTime());
    }
  });

  it("pero el reloj SI esta cableado: el informe lleva su instante", async () => {
    // Sin esta afirmacion, la de arriba pasaria igual con un reloj que nunca se llama, y la
    // mutacion «fechar con `now()`» no tendria codigo vivo que mutar.
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.instante).toBe(RELOJ.toISOString());
  });

  it("cierre CON movimientos de caja: cae con sus hermanas, no en su `resuelto_at`", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(pendienteDe(informe, CIERRE_A, "ingreso_cod_recaudado")?.movimiento.fechaMovimiento).toEqual(
      CAJA_DEL_CIERRE_A,
    );
    expect(
      pendienteDe(informe, CIERRE_A, "ingreso_cod_recaudado")?.movimiento.fechaMovimiento,
    ).not.toEqual(RESUELTO_CIERRE_A);
  });

  it("cierre SIN movimientos de caja: su `resuelto_at`", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(pendienteDe(informe, CIERRE_B, "ingreso_cod_recaudado")?.movimiento.fechaMovimiento).toEqual(
      RESUELTO_CIERRE_B,
    );
  });

  it("cierre sin caja Y sin `resuelto_at`: su `solicitado_at`, que nunca es NULL", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(pendienteDe(informe, CIERRE_C, "ingreso_cod_recaudado")?.movimiento.fechaMovimiento).toEqual(
      SOLICITADO_CIERRE_C,
    );
  });

  it("pago a tienda: la `fecha_pago` del documento", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(pendienteDe(informe, PAGO_1, "egreso_pago_tienda")?.movimiento.fechaMovimiento).toEqual(
      FECHA_PAGO_1,
    );
  });

  it("anulacion: el DIA CALENDARIO DE COSTA RICA de su `created_at`, no el UTC", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    // `created_at` es 2026-08-06T04:00Z, que en CR (UTC-6) son las 22:00 del **5**. Fecharla el
    // 6 la sacaria de su propio dia en cualquier informe por rango.
    expect(
      pendienteDe(informe, PAGO_1, "ingreso_reverso_pago_tienda")?.movimiento.fechaMovimiento,
    ).toEqual(DIA_DE_LA_ANULACION_1);
  });

  it("la fuente no construye ni una fecha, y el reloj se usa UNA sola vez", () => {
    const codigo = codigoSinComentarios(FUENTE);

    // Cambiar una fecha de origen por el instante de la corrida exige o `new Date(` / `Date.now(`
    // —que aqui no existen— o una SEGUNDA llamada al reloj inyectado. Las dos vias caen.
    expect(codigo).not.toMatch(/new Date\s*\(/);
    expect(codigo).not.toMatch(/Date\.now\s*\(/);
    expect(codigo.match(/ahora\(\)/g) ?? []).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* R42 — solo inserta                                                          */
/* -------------------------------------------------------------------------- */

describe("R42 — el registro retroactivo SOLO INSERTA", () => {
  for (const modo of ["simular", "aplicar", "comprobar"] as const) {
    it(`en modo \`${modo}\`, cero \`update\`, \`delete\` y \`upsert\` en los CINCO delegados`, async () => {
      const { servicio, espias } = armar(mundoBase());

      await servicio.ejecutar(modo);

      for (const delegado of DELEGADOS) {
        for (const metodo of ESCRITURAS) {
          expect(
            espias[delegado][metodo],
            `${delegado}.${metodo} fue llamado en modo ${modo}`,
          ).not.toHaveBeenCalled();
        }
      }
    });
  }

  it("del repositorio de la caja solo usa `crearMovimientos`: ni lee, ni agrega, ni obtiene", async () => {
    const { servicio, repoEspia } = armar(mundoBase());

    await servicio.ejecutar("aplicar");

    expect(repoEspia.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(repoEspia.listar).not.toHaveBeenCalled();
    expect(repoEspia.agregarPorCategoriaYTipo).not.toHaveBeenCalled();
    expect(repoEspia.obtenerPorId).not.toHaveBeenCalled();
    expect(repoEspia.agregarPorCategoria).not.toHaveBeenCalled();
  });

  it("su fuente no nombra ninguna forma de modificar ni de borrar", () => {
    const codigo = codigoSinComentarios(FUENTE);

    for (const prohibido of [
      /\.update\s*\(/,
      /\.updateMany\s*\(/,
      /\.upsert\s*\(/,
      /\.delete\s*\(/,
      /\.deleteMany\s*\(/,
      /\.createMany\s*\(/,
    ]) {
      expect(codigo, `${FUENTE} usa ${prohibido}`).not.toMatch(prohibido);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R40 — la simulacion                                                         */
/* -------------------------------------------------------------------------- */

describe("R40 — `simular` no escribe y reporta conteos y montos", () => {
  it("no llama al repositorio de la caja NI UNA vez, e informa 0 insertadas", async () => {
    const { servicio, repoEspia, escrituras } = armar(mundoBase());

    const informe = await servicio.ejecutar("simular");

    expect(repoEspia.crearMovimientos).not.toHaveBeenCalled();
    expect(escrituras).toEqual([]);
    expect(informe.insertadas).toBe(0);
  });

  it("`comprobar` tampoco escribe", async () => {
    const { servicio, repoEspia } = armar(mundoBase());

    const informe = await servicio.ejecutar("comprobar");

    expect(repoEspia.crearMovimientos).not.toHaveBeenCalled();
    expect(informe.insertadas).toBe(0);
  });

  it("dice cuantas filas, de que categoria y por que monto total", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.porCategoria).toEqual([
      { tipo: "egreso", categoria: "egreso_pago_tienda", filas: 1, montoTotal: "15000.50" },
      // 12801.00 (cierre A) + 5000.00 (B) + 250.50 (C) = 18051.50
      { tipo: "ingreso", categoria: "ingreso_cod_recaudado", filas: 3, montoTotal: "18051.50" },
      { tipo: "ingreso", categoria: "ingreso_reverso_pago_tienda", filas: 1, montoTotal: "15000.50" },
    ]);
    expect(informe.pendientes).toHaveLength(5);
  });

  it("y el mismo informe describe a `aplicar`: lo que simula es lo que escribe", async () => {
    const simulado = await informeDe(mundoBase(), "simular");
    const { servicio, escrituras } = armar(mundoBase());

    const aplicado = await servicio.ejecutar("aplicar");

    expect(aplicado.insertadas).toBe(simulado.pendientes.length);
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]).toEqual(simulado.pendientes.map((p) => p.movimiento));
  });
});

/* -------------------------------------------------------------------------- */
/* R39 (unidad) — no propone lo que ya paso por el camino vivo                 */
/* -------------------------------------------------------------------------- */

describe("R39 — lo que ya tiene su fila no se vuelve a proponer", () => {
  it("el cierre y el pago que ya pasaron por el camino VIVO quedan fuera", async () => {
    const informe = await informeDe(mundoBase(), "simular");

    expect(informe.pendientes.map((p) => p.documentoId)).not.toContain(CIERRE_F);
    expect(informe.pendientes.map((p) => p.documentoId)).not.toContain(PAGO_3);
    // Y aun asi se EXAMINAN: la comprobacion los mira para poder decir que estan.
    expect(informe.examinados.cierre_aprobado).toBe(5);
    expect(informe.examinados.pago_a_tienda).toBe(2);
  });

  it("con la caja ya completa, no queda ni una pendiente y no se inserta nada", async () => {
    const mundo = mundoBase();
    // Se escribe en la caja EXACTAMENTE lo que la simulacion dijo que faltaba.
    const previo = await informeDe(mundo, "simular");
    for (const p of previo.pendientes) {
      mundo.caja.push({
        origenTipo: p.movimiento.origenTipo,
        origenId: p.movimiento.origenId,
        categoria: p.movimiento.categoria,
        fechaMovimiento: p.movimiento.fechaMovimiento!,
      });
    }

    const { servicio, escrituras } = armar(mundo);
    const segunda = await servicio.ejecutar("aplicar");

    expect(segunda.pendientes).toEqual([]);
    expect(segunda.insertadas).toBe(0);
    expect(escrituras[0]).toEqual([]); // se llama con la lista VACIA, no con las 5 otra vez
    expect(segunda.porCategoria).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R43 / R44 — la comprobacion                                                 */
/* -------------------------------------------------------------------------- */

describe("R43 — `comprobar` NOMBRA los documentos sin su movimiento de caja", () => {
  it("los cinco, con su documento y su origen, no solo un conteo", async () => {
    const informe = await informeDe(mundoBase(), "comprobar");

    expect(
      informe.pendientes.map((p) => `${p.origen} ${p.documentoId} ${p.movimiento.categoria}`).sort(),
    ).toEqual([
      "anulacion_de_pago_a_tienda pago-1 ingreso_reverso_pago_tienda",
      "cierre_aprobado cierre-a ingreso_cod_recaudado",
      "cierre_aprobado cierre-b ingreso_cod_recaudado",
      "cierre_aprobado cierre-c ingreso_cod_recaudado",
      "pago_a_tienda pago-1 egreso_pago_tienda",
    ]);
  });

  it("y recorre los TRES origenes, diciendo cuantos documentos miro de cada uno", async () => {
    const informe = await informeDe(mundoBase(), "comprobar");

    expect(informe.examinados).toEqual({
      cierre_aprobado: 5,
      pago_a_tienda: 2,
      anulacion_de_pago_a_tienda: 1,
    });
  });
});

describe("R44 — mientras quede uno, NO esta al dia", () => {
  it("con cinco pendientes, `alDia` es false", async () => {
    expect((await informeDe(mundoBase(), "comprobar")).alDia).toBe(false);
  });

  it("basta UNO —el mas pequeño de todos— para que siga sin estar al dia", async () => {
    const mundo = mundoBase();
    const previo = await informeDe(mundo, "simular");
    // Se completa la caja MENOS la fila del cierre C (250.50), la mas modesta del lote.
    for (const p of previo.pendientes) {
      if (p.documentoId === CIERRE_C) continue;
      mundo.caja.push({
        origenTipo: p.movimiento.origenTipo,
        origenId: p.movimiento.origenId,
        categoria: p.movimiento.categoria,
        fechaMovimiento: p.movimiento.fechaMovimiento!,
      });
    }

    const informe = await informeDe(mundo, "comprobar");

    expect(informe.alDia).toBe(false);
    expect(informe.pendientes.map((p) => p.documentoId)).toEqual([CIERRE_C]);
  });

  it("con todo registrado, `alDia` es true", async () => {
    const mundo = mundoBase();
    const previo = await informeDe(mundo, "simular");
    for (const p of previo.pendientes) {
      mundo.caja.push({
        origenTipo: p.movimiento.origenTipo,
        origenId: p.movimiento.origenId,
        categoria: p.movimiento.categoria,
        fechaMovimiento: p.movimiento.fechaMovimiento!,
      });
    }

    expect((await informeDe(mundo, "comprobar")).alDia).toBe(true);
  });

  it("una base sin cierres, sin pagos y sin anulaciones esta al dia (y no consulta la caja)", async () => {
    const vacio: Mundo = { cierres: [], ledger: [], pagos: [], anulaciones: [], caja: [] };
    const { servicio, cliente } = armar(vacio);

    const informe = await servicio.ejecutar("comprobar");

    expect(informe.alDia).toBe(true);
    expect(informe.pendientes).toEqual([]);
    expect(cliente.walletMovimiento.findMany).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* No es una copia paralela                                                    */
/* -------------------------------------------------------------------------- */

describe("el backfill no reimplementa nada: reusa los emisores del camino vivo", () => {
  it("su fuente no nombra NI UNA de las 17 categorias de la caja", () => {
    const codigo = codigoSinComentarios(FUENTE);

    for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
      expect(codigo, `el backfill nombra la categoria ${categoria}`).not.toContain(categoria);
    }
  });

  it("ni ninguno de los 7 `origen_tipo`: la clave de idempotencia se LEE de la fila emitida", () => {
    const codigo = codigoSinComentarios(FUENTE);

    for (const origen of WALLET_ORIGEN_TIPO_SEED) {
      expect(codigo, `el backfill nombra el origen ${origen}`).not.toContain(origen);
    }
  });

  it("y tampoco compone las descripciones a mano: usa las dos funciones de la 172", () => {
    const codigo = codigoSinComentarios(FUENTE);

    expect(codigo).toMatch(/descripcionDePago\(/);
    expect(codigo).toMatch(/descripcionDeAnulacion\(/);
    expect(codigo).not.toMatch(/Anulación de pago/);
  });

  it("las filas que propone son, campo por campo, las que emite el puerto de la Tanda C", async () => {
    // Se emite con el puerto REAL sobre un recolector, igual que hace el backfill, y se compara.
    const recolector = new RecolectorDeFilasDeCaja();
    const puerto = new CajaPagoTiendaFeedService(recolector);
    await puerto.emitirEgresoDePago({} as never, {
      pagoId: PAGO_1,
      monto: "15000.50",
      descripcion: "SINPE · 1234567",
      registradoPor: "u-admin",
      fechaMovimiento: FECHA_PAGO_1,
    });
    const [esperada] = recolector.vaciar();

    const informe = await informeDe(mundoBase(), "simular");

    expect(pendienteDe(informe, PAGO_1, "egreso_pago_tienda")?.movimiento).toEqual(esperada);
  });
});

describe("el recolector no lee la base, y lo dice en alto", () => {
  it("recoge lo que le mandan escribir y se vacia", async () => {
    const recolector = new RecolectorDeFilasDeCaja();
    const fila: CrearMovimientoInput = {
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
      monto: "1.00",
      origenTipo: "manual",
      origenId: null,
    };

    expect(await recolector.crearMovimientos({} as never, [fila])).toBe(1);
    expect(recolector.vaciar()).toEqual([fila]);
    expect(recolector.vaciar()).toEqual([]); // ya se vacio
  });

  it("cualquier lectura LANZA: un `[]` silencioso seria un informe vacio que parece correcto", () => {
    const recolector = new RecolectorDeFilasDeCaja();

    expect(() => recolector.listar()).toThrow(/no lee la base/);
    expect(() => recolector.agregarPorCategoriaYTipo()).toThrow(/no lee la base/);
    expect(() => recolector.obtenerPorId()).toThrow(/no lee la base/);
    expect(() => recolector.agregarPorCategoria()).toThrow(/no lee la base/);
  });
});
