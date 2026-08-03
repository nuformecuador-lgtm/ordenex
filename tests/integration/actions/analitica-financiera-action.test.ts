import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { AnaliticaFinancieraActionDeps } from "@/lib/actions/analitica-financiera";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { ConciliacionCierresAnaliticaRepository } from "@/lib/repositories/ConciliacionCierresAnaliticaRepository";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { RecaudoAnaliticaRepository } from "@/lib/repositories/RecaudoAnaliticaRepository";
import { AnaliticaFinancieraService } from "@/lib/services/AnaliticaFinancieraService";
import {
  IDS_FINANCIERAS_SERVIDAS,
  VISTA_COD_RECAUDADO_POR_METODO,
  VISTA_COD_RECAUDADO_POR_TIENDA,
  type RespuestaFinanciera,
  type ResultadoFinanciero,
} from "@/lib/types/analitica-financiera";
import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  HAY_BASE_DE_DATOS,
} from "../db/_postgres-real";

// Feature 127 / T F.1-F.6 — INTEGRACION CONTRA POSTGRES DE VERDAD, sin un solo mock de Prisma.
//
// Por que hace falta si los repositorios ya tienen sus tests con base falsa: porque las cuatro
// cosas que esta feature puede romper en silencio son del MOTOR, no del codigo.
//
//   F.2 — la frontera horaria. `[D 06:00Z, D+1 06:00Z)` es el dia natural de Costa Rica. Un
//         movimiento a las 22:00 CR y otro a las 00:30 CR son dias DISTINTOS aunque el reloj UTC
//         diga que son el mismo. El off-by-one de seis horas no se ve en una base en memoria que
//         compare los mismos `Date` que el test construyo.
//   F.3 — la frontera de cierre ⟨D2(b)⟩. Un cierre solicitado el lunes y aprobado el miercoles
//         cuenta en el MIERCOLES, porque su dinero solo existe cuando se aprueba.
//   F.4 — la anulacion ⟨D1(c)⟩. El par pago + contraasiento `ajuste_*` en el mismo rango: el
//         `bruto` los cuenta a los dos y el `neto` los cancela, y se afirma POR SEPARADO.
//   F.5 — el cierre pendiente ⟨D4(b)⟩. Aparece en la conciliacion sin aportar dinero, y al
//         aprobarlo aporta UNA vez, no dos. Se corren las dos fases sobre el mismo cierre.
//   F.6 — la no-sumabilidad ⟨D6(a)⟩. Las dos vistas de `cod_recaudado` llegan con ids distintos
//         y `sumableCon: []`.
//
// TODO lo que se inserta vive dentro de `enTransaccionRevertida`: si el test pasa, si falla o si
// el proceso muere a mitad, no queda ni una fila. Y toda la ventana temporal se sitúa en 2031
// A PROPOSITO: asi ninguna fila real de la base de desarrollo entra en el rango y las cifras que
// se afirman son exactamente las sembradas. Las dos metricas que ignoran `desde` por diseño
// —las cuentas por pagar, ⟨D3⟩— no pueden aislarse asi (leen el libro entero hasta el corte), y
// por eso se miden por DIFERENCIA: se consulta antes de sembrar y despues.
//
// Si no hay `DATABASE_URL` alcanzable, el archivo entero se salta (patron `_postgres-real.ts`):
// la suite tiene que seguir siendo verde en una maquina sin Postgres levantado.

/* -------------------------------------------------------------------------- */
/* Calendario del test — todo en 2031, lejos de cualquier fila real            */
/* -------------------------------------------------------------------------- */

const LUNES = "2031-03-10";
const DIA_A = "2031-03-11";
const DIA_B = "2031-03-12";

/** 22:00 hora de pared CR del DIA_A. En UTC ya es el dia siguiente: el off-by-one de 6 horas. */
const CR_22_DEL_DIA_A = new Date("2031-03-12T04:00:00.000Z");
/** 00:30 hora de pared CR del DIA_B. Mismo dia UTC que el anterior, dia CR distinto. */
const CR_00_30_DEL_DIA_B = new Date("2031-03-12T06:30:00.000Z");
/** Mediodia CR del DIA_A, sin ambiguedad posible. */
const CR_MEDIODIA_DIA_A = new Date("2031-03-11T18:00:00.000Z");
/** Mediodia CR del lunes. */
const CR_MEDIODIA_LUNES = new Date("2031-03-10T18:00:00.000Z");
/** Mediodia CR del DIA_B. */
const CR_MEDIODIA_DIA_B = new Date("2031-03-12T18:00:00.000Z");

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda", zonaId: null };

/* -------------------------------------------------------------------------- */
/* Andamiaje                                                                   */
/* -------------------------------------------------------------------------- */

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Ids reales de la base: solo se usan para satisfacer las FKs de las cinco tablas. */
interface Contexto {
  readonly tiendaId: string;
  readonly mensajeroId: string;
  readonly zonaId: string;
}

let prisma: PrismaClient;
let contexto: Contexto | null = null;

/**
 * El servicio REAL sobre los repositorios REALES, apuntando al cliente de la transaccion.
 * No hay ni un doble: lo unico que se inyecta es por donde se habla con Postgres.
 */
function servicioSobre(tx: Tx) {
  return new AnaliticaFinancieraService(
    new IngresosAnaliticaRepository(tx),
    new RecaudoAnaliticaRepository(tx),
    new CuentasPorPagarAnaliticaRepository(tx),
    new ConciliacionCierresAnaliticaRepository(tx),
    { logError: () => {} },
  );
}

function depsDe(tx: Tx, actor: Actor, logger?: ErrorLogger): AnaliticaFinancieraActionDeps {
  return {
    service: servicioSobre(tx),
    getActor: async () => actor,
    logger: logger ?? { logError: () => {} },
  };
}

async function consultarDia(
  tx: Tx,
  metricaId: string,
  fecha: string,
  actor: Actor = MAESTRO,
): Promise<RespuestaFinanciera> {
  return consultarMetricaFinanciera(
    metricaId,
    { rango: "personalizado", desde: fecha, hasta: fecha },
    depsDe(tx, actor),
  );
}

/** Extrae los datos de una respuesta que TIENE que ser `ok`; si no lo es, revienta con el estado. */
function datosDe(respuesta: RespuestaFinanciera): ResultadoFinanciero {
  if (respuesta.status !== "ok") {
    throw new Error(`se esperaba ok y llego ${respuesta.status}: ${JSON.stringify(respuesta)}`);
  }
  return respuesta.datos;
}

function vistasDe(respuesta: RespuestaFinanciera) {
  const datos = datosDe(respuesta);
  if (datos.tipo !== "vistas") throw new Error(`se esperaban vistas y llego ${datos.tipo}`);
  return datos.vistas;
}

function conciliacionDe(respuesta: RespuestaFinanciera) {
  const datos = datosDe(respuesta);
  if (datos.tipo !== "conciliacion") throw new Error(`se esperaba conciliacion`);
  return datos.conciliacion;
}

/* --------------------------------- semillas -------------------------------- */

async function sembrarCaja(
  tx: Tx,
  filas: readonly {
    categoria: string;
    tipo: "ingreso" | "egreso";
    monto: string;
    fecha: Date;
  }[],
): Promise<void> {
  for (const f of filas) {
    await tx.walletMovimiento.create({
      data: {
        tipo: f.tipo as never,
        categoria: f.categoria as never,
        monto: f.monto,
        origenTipo: "manual",
        descripcion: "semilla de la 127 (transaccion revertida)",
        fechaMovimiento: f.fecha,
      },
    });
  }
}

async function sembrarLedgerTienda(
  tx: Tx,
  ctx: Contexto,
  filas: readonly {
    categoria: string;
    tipo: "credito" | "debito";
    monto: string;
    fecha: Date;
    origenId?: string;
  }[],
): Promise<void> {
  for (const f of filas) {
    await tx.walletTiendaMovimiento.create({
      data: {
        tiendaId: ctx.tiendaId,
        tipo: f.tipo as never,
        categoria: f.categoria as never,
        monto: f.monto,
        origenTipo: f.origenId ? "cierre_dia" : "manual",
        origenId: f.origenId ?? null,
        descripcion: "semilla de la 127 (transaccion revertida)",
        fechaMovimiento: f.fecha,
      },
    });
  }
}

async function sembrarCierreDia(
  tx: Tx,
  ctx: Contexto,
  datos: {
    estado: "solicitado" | "aprobado" | "rechazado" | "vencido";
    solicitadoAt: Date;
    resueltoAt?: Date | null;
    efectivo?: string;
    simpe?: string;
    transferencia?: string;
    general: string;
  },
): Promise<string> {
  const cierre = await tx.cierreDia.create({
    data: {
      mensajeroId: ctx.mensajeroId,
      estado: datos.estado as never,
      destinoTipo: "bodega_central" as never,
      destinoZonaId: ctx.zonaId,
      totalEfectivo: datos.efectivo ?? "0",
      totalSimpe: datos.simpe ?? "0",
      totalTransferencia: datos.transferencia ?? "0",
      totalGeneral: datos.general,
      solicitadoAt: datos.solicitadoAt,
      resueltoAt: datos.resueltoAt ?? null,
    },
    select: { id: true },
  });
  return cierre.id;
}

/* -------------------------------------------------------------------------- */

beforeAll(async () => {
  if (!HAY_BASE_DE_DATOS) return;
  prisma = crearPrismaDeTest();
  const usuarios = await prisma.usuario.findMany({ take: 2, select: { id: true } });
  const zona = await prisma.zona.findFirst({ select: { id: true } });
  if (usuarios.length >= 2 && zona) {
    contexto = { tiendaId: usuarios[0].id, mensajeroId: usuarios[1].id, zonaId: zona.id };
  }
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
});

function ctx(): Contexto {
  if (!contexto) {
    throw new Error(
      "la base de test no tiene dos usuarios y una zona con los que satisfacer las FKs",
    );
  }
  return contexto;
}

describe.skipIf(!HAY_BASE_DE_DATOS)("F.1-F.6 · la 127 contra Postgres, sin mocks de Prisma", () => {
  it("la base de test trae el contexto minimo (dos usuarios y una zona)", () => {
    expect(contexto).not.toBeNull();
    expect(ctx().tiendaId).not.toBe(ctx().mensajeroId);
  });

  /* ---------------------------------------------------------------------- */
  /* F.1 — camino completo, por rol y por metrica                            */
  /* ---------------------------------------------------------------------- */

  it("F.1 · un maestro recibe `ok` en las OCHO metricas, contra la base real", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const estados: Record<string, string> = {};
      for (const metricaId of IDS_FINANCIERAS_SERVIDAS) {
        estados[metricaId] = (await consultarDia(tx, metricaId, DIA_A)).status;
      }
      expect(estados).toEqual(Object.fromEntries(IDS_FINANCIERAS_SERVIDAS.map((m) => [m, "ok"])));
      expect(Object.keys(estados)).toHaveLength(8);
    });
  });

  it("F.1 · un adminTienda recibe 403 generico en las OCHO, y queda auditado", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const registros: unknown[] = [];
      const logger: ErrorLogger = { logError: (e) => registros.push(e) };

      for (const metricaId of IDS_FINANCIERAS_SERVIDAS) {
        const respuesta = await consultarMetricaFinanciera(
          metricaId,
          { rango: "personalizado", desde: DIA_A, hasta: DIA_A },
          depsDe(tx, TIENDA, logger),
        );
        expect(respuesta, metricaId).toEqual({ status: "forbidden", code: "FORBIDDEN" });
      }

      expect(registros).toHaveLength(8);
      expect(registros.every((r) => (r as { motivo: string }).motivo === "metrica_prohibida")).toBe(
        true,
      );
    });
  });

  it("F.1 · lo sembrado se ve: la caja devuelve exactamente lo insertado en el rango", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const antes = vistasDe(await consultarDia(tx, "ingreso_flete", DIA_A))[0].total.bruto;
      expect(antes).toBe("0.00"); // 2031 esta vacio: la ventana aisla de verdad

      await sembrarCaja(tx, [
        { categoria: "ingreso_flete", tipo: "ingreso", monto: "1200.00", fecha: CR_MEDIODIA_DIA_A },
        {
          categoria: "ingreso_flete_devolucion",
          tipo: "ingreso",
          monto: "300.00",
          fecha: CR_MEDIODIA_DIA_A,
        },
        // Un `ingreso_ajuste` del MISMO dia que `ingreso_flete` NO declara: no debe verse.
        { categoria: "ingreso_ajuste", tipo: "ingreso", monto: "999.00", fecha: CR_MEDIODIA_DIA_A },
      ]);

      const vista = vistasDe(await consultarDia(tx, "ingreso_flete", DIA_A))[0];
      expect(vista.total.bruto).toBe("1500.00");
      expect(vista.total.neto).toBe("1500.00");
    });
  });

  /* ---------------------------------------------------------------------- */
  /* F.2 — la frontera horaria [D 06:00Z, D+1 06:00Z)                        */
  /* ---------------------------------------------------------------------- */

  it("F.2 · 22:00 CR y 00:30 CR caen en dias DISTINTOS aunque el UTC diga lo mismo", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCaja(tx, [
        // Las dos filas son del 2031-03-12 en UTC. En hora de pared CR son de dias distintos.
        {
          categoria: "ingreso_comision_cod",
          tipo: "ingreso",
          monto: "300.00",
          fecha: CR_22_DEL_DIA_A,
        },
        {
          categoria: "ingreso_comision_cod",
          tipo: "ingreso",
          monto: "700.00",
          fecha: CR_00_30_DEL_DIA_B,
        },
      ]);

      const diaA = vistasDe(await consultarDia(tx, "ingreso_comision_cod", DIA_A))[0];
      const diaB = vistasDe(await consultarDia(tx, "ingreso_comision_cod", DIA_B))[0];

      // El movimiento de las 22:00 CR pertenece al DIA_A y a ningun otro.
      expect(diaA.total.bruto).toBe("300.00");
      // El de las 00:30 CR, al DIA_B. Con medianoche UTC los dos caerian en el mismo dia.
      expect(diaB.total.bruto).toBe("700.00");
    });
  });

  it("F.2 · el corte por `hasta` es exclusivo: 06:00Z exacto es del dia siguiente", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCaja(tx, [
        {
          categoria: "ingreso_comision_cod",
          tipo: "ingreso",
          monto: "500.00",
          // El instante EXACTO del corte: 2031-03-12T06:00:00Z = 00:00 CR del DIA_B.
          fecha: new Date("2031-03-12T06:00:00.000Z"),
        },
      ]);

      expect(vistasDe(await consultarDia(tx, "ingreso_comision_cod", DIA_A))[0].total.bruto).toBe(
        "0.00",
      );
      expect(vistasDe(await consultarDia(tx, "ingreso_comision_cod", DIA_B))[0].total.bruto).toBe(
        "500.00",
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* F.3 — la frontera de cierre ⟨D2(b)⟩                                     */
  /* ---------------------------------------------------------------------- */

  it("F.3 · un cierre solicitado el lunes y aprobado el DIA_B cuenta en el DIA_B", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCierreDia(tx, ctx(), {
        estado: "aprobado",
        solicitadoAt: CR_MEDIODIA_LUNES,
        resueltoAt: CR_MEDIODIA_DIA_B,
        efectivo: "600.00",
        simpe: "150.00",
        general: "750.00",
      });

      const totalDe = (vistas: ReturnType<typeof vistasDe>) =>
        vistas.find((v) => v.id === VISTA_COD_RECAUDADO_POR_METODO)?.total.bruto;

      // El dia en que se SOLICITO no tiene ese dinero: todavia no existia.
      expect(totalDe(vistasDe(await consultarDia(tx, "cod_recaudado", LUNES)))).toBe("0.00");
      // El dia en que se APROBO, si. Es el mismo instante en que el feed escribe en los ledgers.
      expect(totalDe(vistasDe(await consultarDia(tx, "cod_recaudado", DIA_B)))).toBe("750.00");
    });
  });

  /* ---------------------------------------------------------------------- */
  /* F.4 — la anulacion ⟨D1(c)⟩: bruto los ve, neto los cancela              */
  /* ---------------------------------------------------------------------- */

  it("F.4 · pago + contraasiento ajuste en el mismo rango: bruto 800, neto 0", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCaja(tx, [
        // El pago: sale dinero de la caja.
        { categoria: "egreso_gasto", tipo: "egreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
        // El contraasiento que lo anula: el mismo dinero vuelve, con categoria `egreso_ajuste`.
        // El libro no tiene puntero del ajuste al original ⟨D1⟩: el neto sale del SIGNO.
        { categoria: "egreso_ajuste", tipo: "ingreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
      ]);

      const vista = vistasDe(await consultarDia(tx, "egresos", DIA_A))[0];

      // Las dos afirmaciones, POR SEPARADO (es lo que pide F.4): el bruto los cuenta a los dos...
      expect(vista.total.bruto).toBe("800.00");
      // ...y el neto los cancela. Si el neto copiara el bruto, esto seria 800.00.
      expect(vista.total.neto).toBe("0.00");
    });
  });

  it("F.4 · sin el contraasiento, el neto NO es cero: el caso de arriba mide algo", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCaja(tx, [
        { categoria: "egreso_gasto", tipo: "egreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
      ]);

      const vista = vistasDe(await consultarDia(tx, "egresos", DIA_A))[0];
      expect(vista.total.bruto).toBe("400.00");
      expect(vista.total.neto).toBe("-400.00");
    });
  });

  /* ---------------------------------------------------------------------- */
  /* F.5 — el cierre pendiente ⟨D4(b)⟩, en DOS fases sobre el mismo cierre   */
  /* ---------------------------------------------------------------------- */

  it("F.5 · el cierre solicitado se VE sin aportar dinero; aprobado aporta UNA vez", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const cierreId = await sembrarCierreDia(tx, ctx(), {
        estado: "solicitado",
        solicitadoAt: CR_MEDIODIA_DIA_A,
        efectivo: "900.00",
        general: "900.00",
      });

      /* ------------------------------ fase 1 ------------------------------ */

      const fase1 = conciliacionDe(await consultarDia(tx, "conciliacion_cierres", DIA_A));
      const pendiente = fase1.porEstado.filter((f) => f.nivel === "cierre_dia");

      expect(pendiente).toHaveLength(1);
      expect(pendiente[0].estado).toBe("solicitado");
      expect(pendiente[0].cantidad).toBe(1);
      expect(pendiente[0].totales.general).toBe("900.00");
      // ⟨D4⟩ R39 — la coordenada temporal es un DATO de la fila, no un sobreentendido.
      expect(pendiente[0].fechadoPor).toBe("solicitado_at");
      // R25 — no aporta dinero a ninguna cifra: ni al cuadre...
      expect(fase1.cuadre.totalSnapshot).toBe("0.00");
      // ...ni a `cod_recaudado`.
      const recaudoFase1 = vistasDe(await consultarDia(tx, "cod_recaudado", DIA_A));
      expect(recaudoFase1.find((v) => v.id === VISTA_COD_RECAUDADO_POR_METODO)?.total.bruto).toBe(
        "0.00",
      );

      /* ------------------------------ fase 2 ------------------------------ */

      await tx.cierreDia.update({
        where: { id: cierreId },
        data: { estado: "aprobado" as never, resueltoAt: CR_MEDIODIA_DIA_A },
      });

      const fase2 = conciliacionDe(await consultarDia(tx, "conciliacion_cierres", DIA_A));
      const aprobado = fase2.porEstado.filter((f) => f.nivel === "cierre_dia");

      // UNA sola fila: el cierre no esta a la vez en `solicitado` y en `aprobado`.
      expect(aprobado).toHaveLength(1);
      expect(aprobado[0].estado).toBe("aprobado");
      expect(aprobado[0].cantidad).toBe(1);
      expect(aprobado[0].fechadoPor).toBe("resuelto_at");
      // EL IMPORTE NO SE DUPLICA: 900, no 1800.
      expect(fase2.cuadre.totalSnapshot).toBe("900.00");

      const recaudoFase2 = vistasDe(await consultarDia(tx, "cod_recaudado", DIA_A));
      expect(recaudoFase2.find((v) => v.id === VISTA_COD_RECAUDADO_POR_METODO)?.total.bruto).toBe(
        "900.00",
      );
    });
  });

  it("F.5 · el cuadre cruza el snapshot contra el ledger de ESE cierre, no contra el rango", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const cierreId = await sembrarCierreDia(tx, ctx(), {
        estado: "aprobado",
        solicitadoAt: CR_MEDIODIA_DIA_A,
        resueltoAt: CR_MEDIODIA_DIA_A,
        efectivo: "900.00",
        general: "900.00",
      });

      await sembrarLedgerTienda(tx, ctx(), [
        // El credito con origen en ESE cierre: es lo que tiene que cuadrar.
        {
          categoria: "cod_recaudado",
          tipo: "credito",
          monto: "900.00",
          fecha: CR_MEDIODIA_DIA_A,
          origenId: cierreId,
        },
        // Ruido del mismo dia SIN origen en el cierre (un ajuste manual). R23: no descuadra.
        {
          categoria: "ajuste_credito",
          tipo: "credito",
          monto: "5000.00",
          fecha: CR_MEDIODIA_DIA_A,
        },
      ]);

      const cuadre = conciliacionDe(await consultarDia(tx, "conciliacion_cierres", DIA_A)).cuadre;
      expect(cuadre.totalSnapshot).toBe("900.00");
      expect(cuadre.totalLedger).toBe("900.00");
      expect(cuadre.diferencia).toBe("0.00");
      expect(cuadre.cuadra).toBe(true);
      expect(cuadre.cierresDescuadrados).toEqual([]);
      // R14 — de un cierre sale su id, nunca el del mensajero que lo hizo.
      expect(JSON.stringify(cuadre)).not.toContain(ctx().mensajeroId);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* F.6 — la no-sumabilidad de las dos vistas ⟨D6(a)⟩                       */
  /* ---------------------------------------------------------------------- */

  it("F.6 · las dos vistas de cod_recaudado llegan con ids distintos y sumableCon vacio", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      // El mismo colon, contado por sus dos caras: el cierre del mensajero y el credito de la
      // tienda. Sumarlas daria 1800 donde solo hubo 900.
      const cierreId = await sembrarCierreDia(tx, ctx(), {
        estado: "aprobado",
        solicitadoAt: CR_MEDIODIA_DIA_A,
        resueltoAt: CR_MEDIODIA_DIA_A,
        efectivo: "900.00",
        general: "900.00",
      });
      await sembrarLedgerTienda(tx, ctx(), [
        {
          categoria: "cod_recaudado",
          tipo: "credito",
          monto: "900.00",
          fecha: CR_MEDIODIA_DIA_A,
          origenId: cierreId,
        },
      ]);

      const vistas = vistasDe(await consultarDia(tx, "cod_recaudado", DIA_A));

      expect(vistas.map((v) => v.id)).toEqual([
        VISTA_COD_RECAUDADO_POR_METODO,
        VISTA_COD_RECAUDADO_POR_TIENDA,
      ]);
      expect(new Set(vistas.map((v) => v.id)).size).toBe(2);
      for (const vista of vistas) {
        expect(vista.sumableCon, vista.id).toEqual([]);
      }
      // Las dos traen los mismos 900, y en ningun sitio del DTO aparecen sumadas.
      expect(vistas[0].total.bruto).toBe("900.00");
      expect(vistas[1].total.bruto).toBe("900.00");
      expect(JSON.stringify(vistas)).not.toContain("1800.00");
    });
  });

  /* ---------------------------------------------------------------------- */
  /* ⟨D3⟩ R21 — el saldo al corte, medido por DIFERENCIA                     */
  /* ---------------------------------------------------------------------- */

  it("R21 · la cuenta por pagar es un saldo AL CORTE: incluye lo anterior al rango", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const netoDe = async (fecha: string) =>
        vistasDe(await consultarDia(tx, "cuenta_por_pagar_tienda", fecha))[0].total.neto;

      const antes = await netoDe(DIA_B);

      // Un credito de hace tres meses: fuera de la ventana [DIA_B, DIA_B], dentro del saldo.
      await sembrarLedgerTienda(tx, ctx(), [
        {
          categoria: "cod_recaudado",
          tipo: "credito",
          monto: "250.00",
          fecha: new Date("2030-12-15T18:00:00.000Z"),
        },
      ]);

      const despues = await netoDe(DIA_B);
      // La diferencia es exactamente el credito sembrado, aunque su fecha no este en el rango.
      // Con `Prisma.Decimal` y no con `Number`: en dinero, tampoco en un test (S1/R27).
      expect(new Prisma.Decimal(despues).sub(new Prisma.Decimal(antes)).toFixed(2)).toBe("250.00");
      expect(despues).not.toBe(antes);
      expect(datosDe(await consultarDia(tx, "cuenta_por_pagar_tienda", DIA_B)).esAcumulado).toBe(
        true,
      );
    });
  });
});
