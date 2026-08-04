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
  type ImporteAnalitico,
  type ImporteConNeto,
  type ImporteSoloBruto,
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

/**
 * Feature 183 ⟨D12⟩ — `ImporteAnalitico` es una union discriminada por `forma` y `.neto` no se
 * lee sin estrechar. Estos dos helpers AFIRMAN la forma antes de devolver: un `as` la apagaria,
 * y lo que aqui se mide contra Postgres es precisamente que cada metrica publica la suya.
 */
function conNeto(importe: ImporteAnalitico, contexto: string): ImporteConNeto {
  if (importe.forma !== "bruto_y_neto") {
    throw new Error(`${contexto}: se esperaba forma "bruto_y_neto" y llego "${importe.forma}"`);
  }
  return importe;
}

function soloBruto(importe: ImporteAnalitico, contexto: string): ImporteSoloBruto {
  if (importe.forma !== "solo_bruto") {
    throw new Error(`${contexto}: se esperaba forma "solo_bruto" y llego "${importe.forma}"`);
  }
  return importe;
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

  it("F.1 · un maestro recibe `ok` en las DIEZ metricas, contra la base real", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      const estados: Record<string, string> = {};
      for (const metricaId of IDS_FINANCIERAS_SERVIDAS) {
        estados[metricaId] = (await consultarDia(tx, metricaId, DIA_A)).status;
      }
      expect(estados).toEqual(Object.fromEntries(IDS_FINANCIERAS_SERVIDAS.map((m) => [m, "ok"])));
      // 8 de la 127 + `dinero_en_caja` y `ganancia_ordenex` (173, P4): las dos tambien
      // responden contra Postgres de verdad, no solo contra dobles.
      expect(Object.keys(estados)).toHaveLength(10);
    });
  });

  it("F.1 · un adminTienda recibe 403 generico en las DIEZ, y queda auditado", async () => {
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

      expect(registros).toHaveLength(10);
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
      // ⚠️ DADO VUELTA por la 183 (R25): esto afirmaba ademas `neto === "1500.00"`, que era el
      // bruto copiado. ⟨D12⟩ retiro esa copia; lo que se afirma ahora es la FORMA —que la clave
      // no esta— ademas de la cifra, que no cambia.
      expect(soloBruto(vista.total, "ingreso_flete / total").bruto).toBe("1500.00");
      expect(JSON.stringify(vista.total)).not.toContain("neto");
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
  /* F.4 — bruto y neto ⟨D1(c)⟩: el bruto suma magnitudes, el neto lleva SIGNO */
  /* ---------------------------------------------------------------------- */
  //
  // ⚠️ REESCRITO el 2026-08-03 (decision humana, opcion (A) — ver
  // `progress/impl_173-caja-tesoreria.md § HALLAZGO`). Antes este par afirmaba «bruto 800, neto
  // 0» sembrando un `egreso_ajuste` con tipo `ingreso`. Esa fila NO PUEDE EXISTIR:
  //
  //   1. La aplicacion nunca la emite —el dialogo manual DERIVA la categoria del tipo, el
  //      `.refine` de zod la rechaza en el borde y `WalletEgresoService` revierte un gasto con
  //      `ingreso_ajuste`, no con un `egreso_ajuste` de tipo invertido—.
  //   2. Desde la feature 173 la BASE tampoco la acepta: el CHECK
  //      `wallet_movimiento_tipo_categoria_check` la rechaza con 23514.
  //
  // Los dos hechos de arriba SIGUEN SIENDO CIERTOS. Lo que ya no lo es es la conclusion que se
  // saco de ellos, y se corrige aqui en vez de borrarla:
  //
  // ⚠️⚠️ CORREGIDO el 2026-08-04 por ⟨D12⟩ (humano, `progress/decision_183.md`, feature 183).
  // Aquella nota terminaba diciendo, con estas palabras:
  //
  //      «neto = ±bruto SIEMPRE.  El neto 0 no es alcanzable con datos legales.»
  //
  // La primera mitad valia porque las CUATRO metricas de caja declaraban listas HOMOGENEAS DE
  // PREFIJO y el repositorio filtra por CATEGORIA (el `tipo` es solo clave de agrupacion), asi
  // que un conjunto legal contenia un solo `tipo`. La segunda mitad era una consecuencia de esa
  // premisa, no una ley: bastaba con que la premisa dejara de valer para UNA metrica.
  //
  // Es exactamente lo que ⟨D12⟩ hizo. `egresos` gana `ingreso_ajuste` en `definicion.categorias`
  // —el reverso que `WalletEgresoService` emite al anular un egreso— porque sin el, ANULAR UN
  // EGRESO NO SE DESCONTABA NUNCA DE LA CIFRA. Su lista deja de ser homogenea y, por tanto:
  //
  //      EL NETO 0 SI ES ALCANZABLE, y con datos que la base acepta: el par REAL de una
  //      anulacion —una fila `egreso_*` de tipo `egreso` y su reverso `ingreso_ajuste` de tipo
  //      `ingreso`—. Es lo que mide F.4(b), y por eso ese caso paso de «NO entra» a «entra».
  //
  // Para las TRES metricas `ingreso_*` la premisa sigue intacta, y por eso ⟨D12⟩ les retiro el
  // `neto` en vez de conservarlo: `Σ egreso = 0` siempre y el campo no informaba de nada. Ya no
  // publican `neto`, asi que aqui no hay ningun neto suyo que afirmar (ver F.1, mas arriba).
  //
  // Lo que este par mide ahora son tres cosas, y por eso son TRES casos:
  // (a) que el bruto agrega sin signo y que el neto de `egresos` lo lleva contrario;
  // (b) que el contraasiento REAL de un gasto SI entra en `egresos`: bruto 800, neto 0.00;
  // (c) que sobre el censo real de produccion —sin ninguna anulacion— la cifra NO SE MUEVE.

  it("F.4(a) · dos egresos en el mismo rango: bruto 800, neto -800 (el neto lleva SIGNO)", async () => {
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCaja(tx, [
        // Dos salidas de la caja, de dos categorias que `egresos` SI declara.
        { categoria: "egreso_gasto", tipo: "egreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
        { categoria: "egreso_sueldo", tipo: "egreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
      ]);

      const total = conNeto(vistasDe(await consultarDia(tx, "egresos", DIA_A))[0].total, "egresos");

      // Las dos afirmaciones, POR SEPARADO (es lo que pedia F.4): el bruto cuenta las dos filas
      // sin signo...
      expect(total.bruto).toBe("800.00");
      // ...y el neto es `Σ ingreso − Σ egreso`, o sea el MISMO importe con el signo cambiado.
      // Si el neto copiara el bruto —la mutacion que ⟨D1(c)⟩ nombra— esto seria "800.00".
      expect(total.neto).toBe("-800.00");
      // Dicho sin depender de los literales: nunca son el mismo numero, y difieren en el signo.
      expect(total.neto).not.toBe(total.bruto);
      expect(total.neto.startsWith("-")).toBe(true);
      expect(total.bruto.startsWith("-")).toBe(false);
    });
  });

  it("F.4(b) · el contraasiento REAL de un gasto SI entra en `egresos`: bruto 800, neto 0.00", async () => {
    // ⚠️ DADO VUELTA por ⟨D12⟩ (2026-08-04). Hasta la 183 este caso afirmaba «bruto 400,
    // neto -400» y se titulaba «NO entra»: `egresos` declaraba solo las ocho `egreso_*` y el
    // reverso quedaba fuera, asi que anular un gasto no lo descontaba de la cifra. R25 obliga a
    // darlo vuelta y no a borrarlo, porque el hueco que vigila —que el reverso llegue o no
    // llegue a la metrica— es el mismo; lo que cambia es cual de las dos respuestas es correcta.
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCaja(tx, [
        // El gasto: sale dinero de la caja.
        { categoria: "egreso_gasto", tipo: "egreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
        // Su contraasiento, TAL Y COMO LO EMITE `WalletEgresoService`: el mismo dinero vuelve
        // como `ingreso_ajuste` de tipo `ingreso`. Es legal para el CHECK, y desde la 183
        // `egresos` SI lo declara.
        { categoria: "ingreso_ajuste", tipo: "ingreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
      ]);

      // Que las DOS filas estan EN EL LIBRO se comprueba, para que el caso no se pueda confundir
      // con una semilla que no llego a escribirse.
      // Se ordena EN JS: `ORDER BY categoria` sobre un enum de Postgres ordena por el orden de
      // declaracion del enum, no alfabeticamente, y aqui lo unico que interesa es el contenido.
      const enElLibro = (
        await tx.walletMovimiento.findMany({
          where: { fechaMovimiento: CR_MEDIODIA_DIA_A },
          select: { categoria: true, tipo: true },
        })
      ).sort((a, b) => a.categoria.localeCompare(b.categoria));
      expect(enElLibro).toEqual([
        { categoria: "egreso_gasto", tipo: "egreso" },
        { categoria: "ingreso_ajuste", tipo: "ingreso" },
      ]);

      const total = conNeto(vistasDe(await consultarDia(tx, "egresos", DIA_A))[0].total, "egresos");
      // El BRUTO cuenta los dos movimientos: es volumen movido ⟨D1(c)⟩, y por eso SUBE al anular
      // (P1 de la 183, ratificada; la descripcion del catalogo lo declara).
      expect(total.bruto).toBe("800.00");
      // Y el NETO es lo que de verdad salio de caja: cero. Con la definicion de OCHO categorias
      // —la mutacion que R7 nombra— esto seria bruto "400.00" / neto "-400.00".
      expect(total.neto).toBe("0.00");
    });
  });

  it("F.4(b bis) · la fila con la que los dobles viejos afirmaban es 23514 en la base (R24)", async () => {
    // POR QUE ESTE CASO EXISTE. Hasta la 183, dos dobles en memoria median la cancelacion con
    // filas CRUZADAS —`egreso_ajuste` con `tipo: ingreso` y `ingreso_flete` con `tipo: egreso`—
    // y estaban verdes porque un objeto en memoria no pasa por el CHECK. R24 obliga a
    // reexpresarlos con el par real, y este caso es la evidencia de que la premisa es cierta
    // CONTRA POSTGRES y no de memoria: la fila que aquellos dobles usaban NO SE PUEDE INSERTAR.
    //
    // Va en su propia transaccion revertida a proposito: el rechazo aborta la transaccion, asi
    // que no puede compartirla con ninguna asercion posterior.
    await enTransaccionRevertida(prisma, async (tx) => {
      await expect(
        sembrarCaja(tx, [
          { categoria: "egreso_ajuste", tipo: "ingreso", monto: "400.00", fecha: CR_MEDIODIA_DIA_A },
        ]),
        "la base acepto una fila que el CHECK categoria↔tipo de la 173 tenia que rechazar",
      ).rejects.toThrow();
    });
  });

  it("F.4(c) · el censo REAL de produccion (sin anulaciones) no mueve la cifra: 22042.40", async () => {
    // R9 — LA NO-REGRESION, MEDIDA CONTRA POSTGRES Y NO CON DOBLES. Los dobles de servicio no
    // ven el `where.categoria.in`, que es justo lo que la 183 cambia.
    //
    // El censo es el que ⟨D12⟩ §3 midio por MCP contra produccion el 2026-08-04, antes de
    // decidir: 4 filas `egreso_pago_mensajero` = 22.000,00 y 1 `egreso_indemnizacion` = 42,40,
    // con CERO filas `ingreso_ajuste` y cero `egreso_ajuste`. Sobre ese material la definicion
    // de nueve categorias tiene que dar EXACTAMENTE lo mismo que la de ocho.
    //
    // MUTACION QUE ESTE CASO MATA: meter `ingreso_ajuste` restando en el bruto, o invertir el
    // orden de la resta del neto. Las dos mueven una cifra que sobre este censo no puede
    // moverse. (Y quitar `ingreso_ajuste` del catalogo NO lo mata: eso es el punto — F.4(b) se
    // pone rojo y este sigue verde, que es la demostracion de que el cambio no toca lo viejo.)
    await enTransaccionRevertida(prisma, async (tx) => {
      await sembrarCaja(tx, [
        { categoria: "egreso_pago_mensajero", tipo: "egreso", monto: "5000.00", fecha: CR_MEDIODIA_DIA_A },
        { categoria: "egreso_pago_mensajero", tipo: "egreso", monto: "6000.00", fecha: CR_MEDIODIA_DIA_A },
        { categoria: "egreso_pago_mensajero", tipo: "egreso", monto: "7000.00", fecha: CR_MEDIODIA_DIA_A },
        { categoria: "egreso_pago_mensajero", tipo: "egreso", monto: "4000.00", fecha: CR_MEDIODIA_DIA_A },
        { categoria: "egreso_indemnizacion", tipo: "egreso", monto: "42.40", fecha: CR_MEDIODIA_DIA_A },
      ]);

      // El censo es el que se dice que es: cinco filas, ninguna de ajuste en ninguna direccion.
      const enElLibro = await tx.walletMovimiento.groupBy({
        by: ["categoria"],
        where: { fechaMovimiento: CR_MEDIODIA_DIA_A },
        _count: { _all: true },
      });
      // Ordenado EN JS por el mismo motivo que en F.4(b): el enum de Postgres no ordena alfa.
      const censo = enElLibro
        .map((g) => [g.categoria, g._count._all] as const)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map((par) => [...par]);
      expect(censo).toEqual([
        ["egreso_indemnizacion", 1],
        ["egreso_pago_mensajero", 4],
      ]);

      const total = conNeto(vistasDe(await consultarDia(tx, "egresos", DIA_A))[0].total, "egresos");
      expect(total.bruto).toBe("22042.40");
      expect(total.neto).toBe("-22042.40");
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
        conNeto(
          vistasDe(await consultarDia(tx, "cuenta_por_pagar_tienda", fecha))[0].total,
          "cuenta_por_pagar_tienda",
        ).neto;

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
