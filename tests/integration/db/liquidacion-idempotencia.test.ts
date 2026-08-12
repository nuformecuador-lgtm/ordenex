import { describe, it, expect } from "vitest";
import { Prisma, RolValue, type PrismaClient } from "@prisma/client";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { LiquidacionTx } from "@/lib/interfaces/services/ILiquidacionService";
import type { CrearPagoMensajeroInput } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type {
  RegistrarPagoMensajeroInput,
  RegistrarPagoTiendaInput,
} from "@/lib/types/liquidacion";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";

// Feature 172 / T B.4 — EL CANDADO DE SERIALIZACION [P1] (design §4.2). Cubre R46, R83 y R85.
// Feature 172 / T B.6 — IDEMPOTENCIA (design §4.1). Cubre R43, R44, R45, R47 y R48, con el
// mismo store: el `UNIQUE(clave_idempotencia)` y el indice unico parcial de los DOS libros son
// parte de su semantica, no un `if` del test.
//
// Por que este archivo existe. El humano eligio RECHAZAR el pago que excede lo debido (P1), y
// esa comprobacion solo vale si nadie puede leer el mismo disponible a la vez: con
// `READ COMMITTED` —el default de Prisma— dos transacciones simultaneas leerian el mismo saldo,
// las dos pasarian el tope y entre las dos se pagaria de mas. El candado no es un detalle de
// implementacion: es la mitad de la respuesta a P1.
//
// Como se verifica sin Postgres (los tests del repo no levantan base): el store de abajo
// implementa la SEMANTICA de lo que la base hace —el `FOR UPDATE` hace ESPERAR a la segunda
// transaccion, y una transaccion solo publica sus escrituras al hacer commit— y el resto de la
// cadena es CODIGO REAL: el servicio real, los DOS repositorios reales y el SQL crudo real. El
// store ni siquiera sabe a quien bloquea: lee `FOR UPDATE` de la sentencia que emite
// `LiquidacionPagoRepository`. Si alguien quitara el `FOR UPDATE` del repositorio, aqui no se
// tomaria ningun candado.
//
// PRUEBA POR MUTACION: obligatoria y ejecutada; la salida esta pegada en
// `progress/impl_172-liquidacion.md`. Un test de concurrencia que pasa sin candado no prueba
// nada.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const ACTOR: Actor = { usuarioId: "u-admin", rol: RolValue.admin };

/** Cede el turno de verdad (macrotarea): sin esto las dos «transacciones» no se entrelazan. */
function tic(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type FilaMovimiento = {
  tiendaId: string;
  tipo: "credito" | "debito";
  categoria: string;
  monto: Prisma.Decimal;
  origenTipo: string;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento?: Date;
};

type FilaMovimientoMensajero = {
  mensajeroId: string;
  tipo: "devengo" | "pago";
  categoria: string;
  monto: Prisma.Decimal;
  origenTipo: string;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento?: Date;
};

/**
 * Feature 173 / T C.2 — la fila del libro de la CAJA PRINCIPAL. El store la gana porque desde la
 * 173 el pago a una tienda escribe TRES veces en la misma transaccion (documento, ledger y caja);
 * sin este delegado, el camino de la tienda reventaria aqui con `undefined.createMany`.
 *
 * Su indice unico parcial es `(origen_tipo, origen_id, categoria)` —SIN beneficiario, porque la
 * caja no tiene—, y es lo que deja convivir al egreso del pago con el ingreso de su reverso.
 */
type FilaMovimientoCaja = {
  tipo: "ingreso" | "egreso";
  categoria: string;
  monto: Prisma.Decimal;
  origenTipo: string;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento?: Date;
};

/**
 * T F.3 — la fila de `liquidacion_anulacion`, con el `UNIQUE(pago_id)` que la hace irrepetible.
 * Que el pago la lleve DENTRO no es una comodidad del store: es como Prisma devuelve la relacion
 * (`include: { anulacion: … }`) y es lo que hace que «vigente» sea `anulacion IS NULL` de verdad,
 * y no un flag que el test ponga a mano.
 */
type FilaAnulacion = {
  id: string;
  pagoId: string;
  motivo: string;
  anuladoPor: string;
  createdAt: Date;
  anulador: { nombre: string };
};

type FilaPago = {
  id: string;
  claveIdempotencia: string;
  mensajeroId: string | null;
  tiendaId: string | null;
  cierreId: string | null;
  monto: Prisma.Decimal;
  metodo: string;
  referencia: string | null;
  nota: string | null;
  fechaPago: Date;
  registradoPor: string;
  createdAt: Date;
  registrador: { nombre: string };
  anulacion: FilaAnulacion | null;
};

/** La fila de `cierre_dia` que el pago al mensajero LEE y jamas escribe (R42). */
type FilaCierre = {
  id: string;
  mensajeroId: string;
  estado: "solicitado" | "aprobado" | "rechazado" | "vencido";
  totalPagoMensajero: Prisma.Decimal;
  totalEfectivo: Prisma.Decimal;
};

/** Cierre APROBADO con P = 50 000 y E = 0 -> pendiente de 50 000 antes de pagar nada. */
function cierreAprobado(over: Partial<FilaCierre> = {}): FilaCierre {
  return {
    id: "c1",
    mensajeroId: "m1",
    estado: "aprobado",
    totalPagoMensajero: new Prisma.Decimal("50000.00"),
    totalEfectivo: new Prisma.Decimal("0.00"),
    ...over,
  };
}

/**
 * Store en memoria con la semantica REAL de tres cosas de la base:
 *
 *  1. `SELECT … FOR UPDATE`: la segunda transaccion que pide la misma fila ESPERA hasta que la
 *     primera termina. Se detecta leyendo `FOR UPDATE` en la sentencia cruda que emite el
 *     repositorio: el store no tiene una lista de a quien bloquear.
 *  2. Visibilidad transaccional: lo escrito dentro de una transaccion solo se ve DESPUES del
 *     commit, y el candado se suelta DESPUES de publicar (commit -> release, ese orden).
 *  3. `UNIQUE(clave_idempotencia)`, el `UNIQUE(pago_id)` de la anulacion (T F.3) y el indice
 *     unico parcial de los libros.
 */
function makeStore(saldoInicial: string, cierresIniciales: FilaCierre[] = [cierreAprobado()]) {
  const movimientos: FilaMovimiento[] = [
    {
      tiendaId: "t1",
      tipo: "credito",
      categoria: "cod_recaudado",
      monto: new Prisma.Decimal(saldoInicial),
      origenTipo: "cierre_dia",
      origenId: "c-previo",
      descripcion: null,
      registradoPor: null,
    },
  ];
  const movimientosMensajero: FilaMovimientoMensajero[] = [];
  const movimientosCaja: FilaMovimientoCaja[] = []; // feature 173/T C.2
  const clavesMovimiento = new Set<string>(["cierre_dia|c-previo|t1|cod_recaudado"]);
  const cierres: FilaCierre[] = cierresIniciales;
  const pagos: FilaPago[] = [];
  const anulaciones: FilaAnulacion[] = [];
  const clavesIdempotencia = new Set<string>();
  const candados = new Map<string, Promise<void>>();
  const log: string[] = [];
  let seq = 0;

  /** Cola FIFO por clave: `adquirir` no resuelve hasta que el titular anterior libera. */
  async function adquirir(clave: string): Promise<() => void> {
    const anterior = candados.get(clave) ?? Promise.resolve();
    let liberar!: () => void;
    const mio = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    candados.set(
      clave,
      anterior.then(() => mio),
    );
    await anterior; // ← ESTA es la espera que serializa
    return liberar;
  }

  // Los DOS indices unicos parciales, uno por libro: `(origen_tipo, origen_id, <beneficiario>,
  // categoria) WHERE origen_id IS NOT NULL`. Que el beneficiario forme parte de la clave es lo
  // que deja convivir al pago del cierre con la liquidacion, y a dos mensajeros entre si.
  const claveMov = (d: FilaMovimiento) =>
    `${d.origenTipo}|${d.origenId}|${d.tiendaId}|${d.categoria}`;
  const claveMovMensajero = (d: FilaMovimientoMensajero) =>
    `${d.origenTipo}|${d.origenId}|${d.mensajeroId}|${d.categoria}`;
  // Feature 173: el de la caja, que no tiene beneficiario (design §2.5).
  const claveMovCaja = (d: FilaMovimientoCaja) =>
    `caja|${d.origenTipo}|${d.origenId}|${d.categoria}`;

  // Lecturas COMMITEADAS (el cliente propio del repositorio, fuera de la transaccion).
  const clienteLectura = {
    walletTiendaMovimiento: {
      groupBy: async ({
        by,
        where,
      }: {
        by: string[];
        where: { tiendaId?: string };
      }) => {
        if (by.join() !== "tipo" || where.tiendaId === undefined) {
          throw new Error(`el store no soporta este groupBy: ${JSON.stringify({ by, where })}`);
        }
        log.push(`leer-disponible:${where.tiendaId}`);
        // ⚠️ EL ORDEN DE ESTAS DOS LINEAS ES LA MITAD DEL EXPERIMENTO.
        //
        // En `READ COMMITTED` —el default de Prisma— una sentencia toma su INSTANTANEA cuando
        // EMPIEZA, no cuando devuelve. Por eso el store fotografia las filas AQUI y solo
        // despues cede el turno: si la foto se tomara tras el `tic`, la segunda transaccion
        // veria siempre el commit de la primera aunque nadie la hubiera hecho esperar, y el
        // test de carrera pasaria SIN candado — es decir, no probaria nada. Medido: con la
        // foto despues del `tic`, quitar el candado del servicio dejaba el test en verde.
        const propias = movimientos.filter((m) => m.tiendaId === where.tiendaId);
        const suma = (tipo: "credito" | "debito") =>
          propias
            .filter((m) => m.tipo === tipo)
            .reduce((acc, m) => acc.add(m.monto), new Prisma.Decimal(0));
        const resultado = [
          { tipo: "credito" as const, _sum: { monto: suma("credito") } },
          { tipo: "debito" as const, _sum: { monto: suma("debito") } },
        ];
        await tic(); // la respuesta llega despues: es lo que da hueco al entrelazado
        return resultado;
      },
    },
    liquidacionPago: {
      findUnique: async ({ where }: { where: { claveIdempotencia?: string; id?: string } }) => {
        // Misma convencion que arriba: instantanea al empezar la sentencia, respuesta despues.
        const fila = pagos.find(
          (p) =>
            (where.claveIdempotencia !== undefined &&
              p.claveIdempotencia === where.claveIdempotencia) ||
            (where.id !== undefined && p.id === where.id),
        );
        if (where.claveIdempotencia !== undefined) log.push("leer-por-clave");
        // T F.3/R70: la lectura SERVER-SIDE del pago que se va a anular. Va aparte en el log
        // porque es la que decide el monto del reverso y a quien se bloquea.
        if (where.id !== undefined) log.push(`leer-por-id:${where.id}`);
        await tic();
        return fila ?? null;
      },
      /**
       * §5/R80 — `sumarVigentesPorCierre`. «Vigente» = SIN fila de anulacion, y aqui se aplica
       * de verdad (el store guarda `anulacion`), no se da por bueno.
       */
      groupBy: async ({
        by,
        where,
      }: {
        by: string[];
        where: { cierreId?: { in: string[] }; anulacion?: { is: null } };
      }) => {
        if (by.join() !== "cierreId" || where.cierreId === undefined) {
          throw new Error(`el store no soporta este groupBy: ${JSON.stringify({ by })}`);
        }
        log.push("leer-pagado-vigente");
        const ids = where.cierreId.in;
        const vigentes = pagos.filter(
          (p) =>
            p.cierreId !== null &&
            ids.includes(p.cierreId) &&
            (where.anulacion === undefined || p.anulacion === null),
        );
        const porCierre = new Map<string, Prisma.Decimal>();
        for (const p of vigentes) {
          const acc = porCierre.get(p.cierreId as string) ?? new Prisma.Decimal(0);
          porCierre.set(p.cierreId as string, acc.add(p.monto));
        }
        const resultado = [...porCierre].map(([cierreId, monto]) => ({
          cierreId,
          _sum: { monto },
        }));
        await tic();
        return resultado;
      },
      /** §5/R80 — `sumarVigentesPorTienda`, con el MISMO criterio de vigencia. */
      aggregate: async ({
        where,
      }: {
        where: { tiendaId?: string; anulacion?: { is: null } };
      }) => {
        if (where.tiendaId === undefined) {
          throw new Error(`el store no soporta este aggregate: ${JSON.stringify({ where })}`);
        }
        log.push("leer-pagado-vigente-tienda");
        const vigentes = pagos.filter(
          (p) =>
            p.tiendaId === where.tiendaId &&
            (where.anulacion === undefined || p.anulacion === null),
        );
        const suma = vigentes.reduce((acc, p) => acc.add(p.monto), new Prisma.Decimal(0));
        await tic();
        return { _sum: { monto: suma } };
      },
      /**
       * R49/R50/R74 — la LISTA de comprobantes, que a diferencia de las sumas NO filtra por
       * vigencia: un pago anulado deja de descontar, pero no deja de verse.
       */
      findMany: async ({ where }: { where: { tiendaId?: string; cierreId?: string } }) => {
        if (where.tiendaId === undefined && where.cierreId === undefined) {
          throw new Error(`el store no soporta este findMany: ${JSON.stringify({ where })}`);
        }
        log.push("listar-comprobantes");
        const filas = pagos.filter((p) =>
          where.tiendaId !== undefined
            ? p.tiendaId === where.tiendaId
            : p.cierreId === where.cierreId,
        );
        await tic();
        return filas;
      },
    },
    cierreDia: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        log.push(`leer-cierre-fuera-de-tx:${where.id}`);
        const fila = cierres.find((c) => c.id === where.id);
        await tic();
        return fila ?? null;
      },
    },
  };

  /** Abre una transaccion: escrituras diferidas al commit y candados sueltos al cerrar. */
  async function runTransaction<T>(fn: (tx: LiquidacionTx) => Promise<T>): Promise<T> {
    const aplicarAlCommit: Array<() => void> = [];
    const liberadores: Array<() => void> = [];
    const clavesPendientes = new Set<string>();

    const tx = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const texto = strings.join("?").replace(/\s+/g, " ").trim();
        if (!/FOR UPDATE/.test(texto)) {
          throw new Error(`el store solo entiende sentencias de bloqueo; llego: ${texto}`);
        }
        const tabla = /FROM "([a-z_]+)"/.exec(texto)?.[1];
        if (tabla === undefined) throw new Error(`no se pudo leer la tabla de: ${texto}`);
        log.push(`candado:${tabla}:${String(values[0])}`);
        liberadores.push(await adquirir(`${tabla}:${String(values[0])}`));
        log.push(`candado-tomado:${tabla}:${String(values[0])}`);
        return [{ id: values[0] }];
      },
      liquidacionPago: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const clave = data.claveIdempotencia as string;
          if (clavesIdempotencia.has(clave) || clavesPendientes.has(clave)) {
            // UNIQUE(clave_idempotencia): la barrera es DE DATOS (R44), no un `if` previo.
            // El log deja constancia de que el INSERT se INTENTO y lo rechazo la restriccion:
            // es lo que distingue «idempotencia por constraint» de «idempotencia por consulta
            // previa», y lo que la prueba por mutacion de T B.6 apaga.
            log.push("choque-clave");
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
              code: "P2002",
              clientVersion: "7.0.0",
              meta: { target: ["clave_idempotencia"] },
            });
          }
          clavesPendientes.add(clave);
          const fila: FilaPago = {
            id: `pago-${++seq}`,
            claveIdempotencia: clave,
            mensajeroId: (data.mensajeroId as string | null) ?? null,
            tiendaId: (data.tiendaId as string | null) ?? null,
            cierreId: (data.cierreId as string | null) ?? null,
            monto: data.monto as Prisma.Decimal,
            metodo: data.metodo as string,
            referencia: (data.referencia as string | null) ?? null,
            nota: (data.nota as string | null) ?? null,
            fechaPago: data.fechaPago as Date,
            registradoPor: data.registradoPor as string,
            createdAt: new Date("2026-08-02T15:04:05.000Z"),
            registrador: { nombre: "Ana Admin" },
            anulacion: null,
          };
          log.push(`crear-documento:${fila.id}`);
          aplicarAlCommit.push(() => {
            pagos.push(fila);
            clavesIdempotencia.add(clave);
          });
          return fila;
        },
      },
      /**
       * T F.3/R75 — `liquidacion_anulacion` con su `UNIQUE(pago_id)`. La segunda anulacion del
       * mismo pago NO es un no-op silencioso: la rechaza la RESTRICCION, igual que la clave de
       * idempotencia rechaza el doble submit. Aqui tampoco hay `SELECT` previo que decida.
       *
       * `update`/`delete` no existen a proposito: si el dia de mañana alguien escribiera un
       * «desanular» (R82), este store no sabria ejecutarlo y el test caeria con un TypeError en
       * vez de dejarlo pasar.
       */
      liquidacionAnulacion: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const pagoId = data.pagoId as string;
          if (anulaciones.some((a) => a.pagoId === pagoId) || clavesPendientes.has(`anu|${pagoId}`)) {
            log.push("choque-anulacion");
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
              code: "P2002",
              clientVersion: "7.0.0",
              meta: { target: ["pago_id"] },
            });
          }
          clavesPendientes.add(`anu|${pagoId}`);
          const fila: FilaAnulacion = {
            id: `anu-${anulaciones.length + 1}`,
            pagoId,
            motivo: data.motivo as string,
            anuladoPor: data.anuladoPor as string,
            createdAt: new Date("2026-08-05T20:31:00.000Z"),
            anulador: { nombre: "Mario Maestro" },
          };
          log.push(`crear-anulacion:${pagoId}`);
          aplicarAlCommit.push(() => {
            anulaciones.push(fila);
            // Es lo que hace que el pago deje de ser VIGENTE para las sumas de R80: no se toca
            // ninguna columna del pago, aparece su fila de anulacion.
            const pago = pagos.find((p) => p.id === pagoId);
            if (pago !== undefined) pago.anulacion = fila;
          });
          return fila;
        },
      },
      walletTiendaMovimiento: {
        createMany: async ({
          data,
          skipDuplicates,
        }: {
          data: FilaMovimiento[];
          skipDuplicates?: boolean;
        }) => {
          const aInsertar: FilaMovimiento[] = [];
          for (const d of data) {
            const k = claveMov(d);
            if (d.origenId !== null && (clavesMovimiento.has(k) || clavesPendientes.has(k))) {
              if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
              throw new Error(`unique violation ${k}`);
            }
            if (d.origenId !== null) clavesPendientes.add(k);
            aInsertar.push(d);
          }
          log.push(`crear-movimiento:${aInsertar.length}`);
          aplicarAlCommit.push(() => {
            for (const d of aInsertar) {
              movimientos.push(d);
              if (d.origenId !== null) clavesMovimiento.add(claveMov(d));
            }
          });
          return { count: aInsertar.length };
        },
      },
      pagoMensajeroMovimiento: {
        createMany: async ({
          data,
          skipDuplicates,
        }: {
          data: FilaMovimientoMensajero[];
          skipDuplicates?: boolean;
        }) => {
          const aInsertar: FilaMovimientoMensajero[] = [];
          for (const d of data) {
            const k = claveMovMensajero(d);
            if (d.origenId !== null && (clavesMovimiento.has(k) || clavesPendientes.has(k))) {
              if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
              throw new Error(`unique violation ${k}`);
            }
            if (d.origenId !== null) clavesPendientes.add(k);
            aInsertar.push(d);
          }
          log.push(`crear-movimiento-mensajero:${aInsertar.length}`);
          aplicarAlCommit.push(() => {
            for (const d of aInsertar) {
              movimientosMensajero.push(d);
              if (d.origenId !== null) clavesMovimiento.add(claveMovMensajero(d));
            }
          });
          return { count: aInsertar.length };
        },
      },
      /**
       * Feature 173 / T C.2 — el libro de la CAJA PRINCIPAL, con la misma semantica de indice
       * unico parcial y de visibilidad diferida al commit que los otros dos. **No escribe en el
       * `log`** a proposito: las aserciones de este archivo son de la 172 y comparan el log
       * entero; el delegado se añade para que el camino no reviente, no para cambiar lo que la
       * 172 mide. Lo que la caja hace de verdad se mide en las suites de la 173.
       */
      walletMovimiento: {
        createMany: async ({
          data,
          skipDuplicates,
        }: {
          data: FilaMovimientoCaja[];
          skipDuplicates?: boolean;
        }) => {
          const aInsertar: FilaMovimientoCaja[] = [];
          for (const d of data) {
            const k = claveMovCaja(d);
            if (d.origenId !== null && (clavesMovimiento.has(k) || clavesPendientes.has(k))) {
              if (skipDuplicates) continue; // ON CONFLICT DO NOTHING
              throw new Error(`unique violation ${k}`);
            }
            if (d.origenId !== null) clavesPendientes.add(k);
            aInsertar.push(d);
          }
          aplicarAlCommit.push(() => {
            for (const d of aInsertar) {
              movimientosCaja.push(d);
              if (d.origenId !== null) clavesMovimiento.add(claveMovCaja(d));
            }
          });
          return { count: aInsertar.length };
        },
      },
      /**
       * R42 — el cierre se LEE dentro de la transaccion (la guardia de R20) y NUNCA se escribe.
       * Las escrituras existen aqui a proposito, y REVIENTAN: si alguien tocara el snapshot del
       * cierre desde esta feature, el test caeria con un mensaje que dice exactamente eso.
       */
      cierreDia: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          log.push(`leer-cierre:${where.id}`);
          const fila = cierres.find((c) => c.id === where.id);
          await tic();
          return fila ?? null;
        },
        update: async () => {
          throw new Error("R42: la liquidacion NO escribe en cierre_dia");
        },
        updateMany: async () => {
          throw new Error("R42: la liquidacion NO escribe en cierre_dia");
        },
        delete: async () => {
          throw new Error("R42: la liquidacion NO escribe en cierre_dia");
        },
      },
    };

    try {
      const r = await fn(tx as unknown as LiquidacionTx);
      for (const aplicar of aplicarAlCommit) aplicar(); // COMMIT: publica…
      log.push("commit");
      return r;
    } finally {
      for (const liberar of liberadores) liberar(); // …y solo entonces suelta el candado
    }
  }

  return {
    movimientos,
    movimientosMensajero,
    movimientosCaja, // feature 173/T C.2
    cierres,
    pagos,
    anulaciones,
    log,
    runTransaction,
    clienteLectura,
  };
}

/**
 * `ahora` es el RELOJ, y solo lo usa la anulacion (R77: el contraasiento se fecha el dia en que
 * se anula). Se fija para que la fecha del reverso sea comparable; los tests de registro no lo
 * pasan y siguen igual.
 */
function buildService(store: ReturnType<typeof makeStore>, ahora?: () => Date) {
  const cliente = store.clienteLectura as unknown as PrismaClient;
  return new LiquidacionService(
    new LiquidacionPagoRepository(cliente),
    new WalletTiendaMovimientoRepository(cliente),
    new PagoMensajeroMovimientoRepository(cliente),
    store.runTransaction,
    // Feature 173/T C.2: el puerto REAL sobre el repositorio REAL de la caja. Cablearlo aqui con
    // un doble inerte dejaria este store —el unico que modela candados y visibilidad— sin ver la
    // tercera escritura del pago a tienda.
    new CajaPagoTiendaFeedService(new WalletMovimientoRepository(cliente)),
    // Feature 205 (T3.2): el repositorio del ACTO, REAL sobre el mismo cliente del store. Ningun
    // caso de este archivo reparte —la idempotencia del REPARTO tiene la suya—, asi que su
    // delegado no se toca; va cableado de verdad y no con un doble para que el dia que un caso de
    // aqui reparta, hable con el mismo store que todo lo demas.
    new LiquidacionRepartoRepository(cliente),
    ahora,
  );
}

function pago(monto: string, clave: string): RegistrarPagoTiendaInput {
  return {
    claveIdempotencia: clave,
    tiendaId: "t1",
    monto,
    metodo: "efectivo",
    fechaPago: "2026-07-30",
  };
}

/** El mismo pago, contra el cierre `c1` (T B.5). */
function pagoMensajero(monto: string, clave: string): RegistrarPagoMensajeroInput {
  return {
    claveIdempotencia: clave,
    cierreId: "c1",
    monto,
    metodo: "efectivo",
    fechaPago: "2026-07-30",
  };
}

const CLAVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Σ de los debitos `pago_tienda` que quedaron en el ledger, como STRING money-safe. */
function totalPagado(store: ReturnType<typeof makeStore>): string {
  return store.movimientos
    .filter((m) => m.categoria === "pago_tienda")
    .reduce((acc, m) => acc.add(m.monto), new Prisma.Decimal(0))
    .toFixed(2);
}

/** Σ de los movimientos `liquidacion` que quedaron en el libro del mensajero. */
function totalLiquidado(store: ReturnType<typeof makeStore>): string {
  return store.movimientosMensajero
    .filter((m) => m.categoria === "liquidacion")
    .reduce((acc, m) => acc.add(m.monto), new Prisma.Decimal(0))
    .toFixed(2);
}

describe("R83 — el bloqueo se toma ANTES de leer cuanto hay disponible", () => {
  it("el orden de las sentencias es candado -> lectura, no al reves", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    const r = await service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR);

    expect(r.status).toBe("ok");
    // El log lo escribe el STORE, en el borde de la sentencia: mide lo que llega a la base, no
    // lo que el servicio dice que hace.
    expect(store.log).toEqual([
      "candado:usuario:t1",
      "candado-tomado:usuario:t1",
      "leer-disponible:t1",
      "crear-documento:pago-1",
      "crear-movimiento:1",
      "commit",
    ]);
    const iCandado = store.log.indexOf("candado-tomado:usuario:t1");
    const iLectura = store.log.indexOf("leer-disponible:t1");
    expect(iCandado).toBeGreaterThanOrEqual(0);
    expect(iCandado).toBeLessThan(iLectura); // un candado tomado DESPUES no serializa nada
  });

  it("el candado es sobre la fila de la TIENDA, que es lo que se consume", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("1000.00", CLAVE_A), ACTOR);

    expect(store.log.filter((l) => l.startsWith("candado:"))).toEqual(["candado:usuario:t1"]);
  });
});

describe("R85 — ninguna operacion toma mas de un bloqueo", () => {
  it("un pago que entra toma EXACTAMENTE un candado", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR);

    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(1);
  });

  it("tambien los caminos que RECHAZAN toman uno y solo uno (y lo sueltan)", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    const excede = await service.registrarPagoTienda(pago("100000.01", CLAVE_A), ACTOR);
    expect(excede.status).toBe("excede");
    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(1);

    // Si el candado del intento anterior no se hubiera soltado, esta llamada se colgaria.
    const ok = await service.registrarPagoTienda(pago("100000.00", CLAVE_B), ACTOR);
    expect(ok.status).toBe("ok");
    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(2);
  });

  it("con un solo recurso bloqueado no existe orden de adquisicion que interbloquee", async () => {
    // Dos pagos a DOS tiendas distintas no comparten candado y no se estorban: la prueba de que
    // el grano es la fila del beneficiario y no una tabla entera.
    const store = makeStore("100000.00");
    store.movimientos.push({
      tiendaId: "t2",
      tipo: "credito",
      categoria: "cod_recaudado",
      monto: new Prisma.Decimal("50000.00"),
      origenTipo: "cierre_dia",
      origenId: "c-previo-2",
      descripcion: null,
      registradoPor: null,
    });
    const service = buildService(store);

    const [a, b] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda({ ...pago("50000.00", CLAVE_B), tiendaId: "t2" }, ACTOR),
    ]);

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    expect(store.log.filter((l) => l.startsWith("candado:")).sort()).toEqual([
      "candado:usuario:t1",
      "candado:usuario:t2",
    ]);
  });
});

describe("R46 [P1] — dos registros simultaneos no saldan mas de lo debido", () => {
  it("con 100 000 disponibles, dos pagos de 60 000 a la vez: uno entra y el otro se rechaza", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    // Las dos operaciones arrancan SIN esperar a la otra: es la carrera, no una secuencia.
    const [a, b] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("60000.00", CLAVE_B), ACTOR),
    ]);

    const estados = [a.status, b.status].sort();
    expect(estados).toEqual(["excede", "ok"]);

    // El que se rechaza informa de lo que QUEDA de verdad tras el otro (100 000 - 60 000).
    const rechazado = a.status === "excede" ? a : b;
    if (rechazado.status !== "excede") throw new Error("esperaba excede");
    expect(rechazado.disponible).toBe("40000.00");

    // Lo que de verdad importa: entre las dos NO se pago mas de lo que habia.
    expect(totalPagado(store)).toBe("60000.00");
    expect(store.pagos).toHaveLength(1);
  });

  it("la segunda transaccion ESPERA: su lectura ocurre despues del commit de la primera", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("60000.00", CLAVE_B), ACTOR),
    ]);

    // Las dos piden el candado al principio (`candado:`), pero solo una lo TOMA
    // (`candado-tomado:`) antes del commit de la otra. Sin serializacion, las dos lecturas
    // caerian antes del primer commit y las dos verian 100 000.
    const commit = store.log.indexOf("commit");
    const lecturas = store.log
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.startsWith("leer-disponible:"))
      .map(({ i }) => i);
    expect(lecturas).toHaveLength(2);
    expect(lecturas[0]).toBeLessThan(commit);
    expect(lecturas[1]).toBeGreaterThan(commit); // la segunda lee DESPUES del commit del primero
  });

  it("tres a la vez contra 100 000: entran los que caben y el resto se rechaza", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    const [a, b, c] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("60000.00", CLAVE_B), ACTOR),
      service.registrarPagoTienda(pago("40000.00", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"), ACTOR),
    ]);

    const oks = [a, b, c].filter((r) => r.status === "ok");
    expect(oks.length).toBeGreaterThanOrEqual(1);
    // El invariante, sea cual sea el orden en que se resuelva la carrera: jamas se salda de mas.
    expect(new Prisma.Decimal(totalPagado(store)).lte("100000.00")).toBe(true);
    // Y el saldo final nunca queda en contra por culpa de un pago.
    const saldoFinal = store.movimientos.reduce(
      (acc, m) => (m.tipo === "credito" ? acc.add(m.monto) : acc.sub(m.monto)),
      new Prisma.Decimal(0),
    );
    expect(saldoFinal.gte(0)).toBe(true);
  });

  it("una carrera de pagos que SI caben entra entera (el candado no rechaza de mas)", async () => {
    // La contraprueba del test principal: si el candado convirtiera cualquier concurrencia en
    // un rechazo, los tests de arriba pasarian sin decir nada.
    const store = makeStore("100000.00");
    const service = buildService(store);

    const [a, b] = await Promise.all([
      service.registrarPagoTienda(pago("60000.00", CLAVE_A), ACTOR),
      service.registrarPagoTienda(pago("40000.00", CLAVE_B), ACTOR),
    ]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(totalPagado(store)).toBe("100000.00");
    expect(store.pagos).toHaveLength(2);
  });
});

describe("el documento y el libro no divergen (§5, R39)", () => {
  it("Σ pagos registrados == Σ debitos `pago_tienda` del ledger", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);
    await service.registrarPagoTienda(pago("25000.50", CLAVE_B), ACTOR);

    const sumaDocumentos = store.pagos
      .reduce((acc, p) => acc.add(p.monto), new Prisma.Decimal(0))
      .toFixed(2);
    expect(sumaDocumentos).toBe("40000.50");
    expect(totalPagado(store)).toBe("40000.50");
    // Y cada movimiento apunta a SU documento (R38).
    const debitos = store.movimientos.filter((m) => m.categoria === "pago_tienda");
    expect(debitos.map((m) => m.origenId).sort()).toEqual(store.pagos.map((p) => p.id).sort());
    expect(debitos.every((m) => m.origenTipo === "pago_tienda")).toBe(true);
  });
});

// =============================================================================================
// T B.6 — IDEMPOTENCIA (design §4.1). R43, R44, R45, R47 y R48.
//
// La barrera que se prueba aqui NO es del servicio: es el `UNIQUE(clave_idempotencia)` del store
// (que imita a la columna) y el indice unico parcial de los dos libros. Por eso el criterio de
// «Hecho» de esta task exige la PRUEBA POR MUTACION: quitando el UNIQUE del store, el primer
// test tiene que caer. Ejecutada; salida en `progress/impl_172-liquidacion.md`.
// =============================================================================================

describe("R43/R47 — la misma solicitud dos veces registra UN SOLO pago", () => {
  it("la misma clave dos veces: un pago, el MISMO comprobante y el saldo saldado una vez", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    const primera = await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);
    // El doble submit: mismisima peticion, misma clave (el cliente la genera al ABRIR el
    // formulario y no la renueva hasta que un registro sale bien).
    const segunda = await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);

    expect(primera.status).toBe("ok");
    expect(segunda.status).toBe("ya_registrado"); // R47: se informa, no se crea un segundo pago
    if (primera.status !== "ok" || segunda.status !== "ya_registrado") return;

    // R43: el MISMO comprobante, campo por campo (no «uno equivalente»).
    expect(segunda.pago).toEqual(primera.pago);
    // …y una sola fila en cada sitio: el saldo NO se salda dos veces.
    expect(store.pagos).toHaveLength(1);
    expect(totalPagado(store)).toBe("15000.00");
    expect(store.movimientos.filter((m) => m.categoria === "pago_tienda")).toHaveLength(1);
    // El restante que se devuelve es el real tras el pago, no el de antes.
    expect(segunda.restante).toBe("85000.00");
    // Y el pago a una tienda no toco el libro del mensajero.
    expect(store.movimientosMensajero).toHaveLength(0);
  });

  it("R43/R47 tambien en el camino del MENSAJERO (es codigo distinto, no una rama compartida)", async () => {
    const store = makeStore("0.00");
    const service = buildService(store);

    const primera = await service.registrarPagoMensajero(pagoMensajero("20000.00", CLAVE_A), ACTOR);
    const segunda = await service.registrarPagoMensajero(pagoMensajero("20000.00", CLAVE_A), ACTOR);

    expect(primera.status).toBe("ok");
    expect(segunda.status).toBe("ya_registrado");
    if (primera.status !== "ok" || segunda.status !== "ya_registrado") return;
    expect(segunda.pago).toEqual(primera.pago);
    expect(store.pagos).toHaveLength(1);
    expect(totalLiquidado(store)).toBe("20000.00");
    // El pendiente del cierre bajo UNA vez: 50 000 - 20 000.
    expect(segunda.restante).toBe("30000.00");
  });

  it("un reintento con la misma clave pero OTRO monto tampoco crea nada (la clave manda)", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);
    // 20 000 cabe de sobra en los 85 000 que quedan, asi que el rechazo NO viene del tope:
    // viene de la clave, que es lo que este caso mide.
    const r = await service.registrarPagoTienda(pago("20000.00", CLAVE_A), ACTOR);

    expect(r.status).toBe("ya_registrado");
    if (r.status !== "ya_registrado") return;
    // Devuelve el pago REAL (15 000), no lo que pedia el reintento.
    expect(r.pago.monto).toBe("15000.00");
    expect(store.pagos).toHaveLength(1);
    expect(totalPagado(store)).toBe("15000.00");
  });
});

describe("R44 — la barrera es la RESTRICCION de la base, no una comprobacion previa", () => {
  it("en el camino feliz no se consulta por clave: se INSERTA y punto", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);

    // Si hubiera un check-then-insert, `leer-por-clave` estaria ANTES de `crear-documento`.
    expect(store.log).not.toContain("leer-por-clave");
    expect(store.log).toContain("crear-documento:pago-1");
  });

  it("en el reintento, la lectura por clave ocurre DESPUES del intento de insertar", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);
    const marca = store.log.length;
    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);

    const segundoIntento = store.log.slice(marca);
    // El INSERT se INTENTA y lo rechaza la RESTRICCION (`choque-clave` lo emite el store, o sea
    // la base); solo entonces se relee el comprobante.
    const iChoque = segundoIntento.indexOf("choque-clave");
    const iLectura = segundoIntento.indexOf("leer-por-clave");
    expect(iChoque).toBeGreaterThanOrEqual(0);
    expect(iLectura).toBeGreaterThan(iChoque);
    // Y no hubo commit del segundo intento: la transaccion murio con el choque.
    expect(segundoIntento.filter((l) => l === "commit")).toHaveLength(0);
  });

  it("sin ese choque no habria idempotencia: el servicio no filtra claves en memoria", async () => {
    // Contraprueba del anterior: la unica pieza que distingue «ya registrado» de «nuevo» es el
    // error de la base. El servicio pide crear las DOS veces, y quien dice que no es el UNIQUE.
    const store = makeStore("100000.00");
    const service = buildService(store);

    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);
    await service.registrarPagoTienda(pago("15000.00", CLAVE_A), ACTOR);

    const intentos = store.log.filter(
      (l) => l === "choque-clave" || l.startsWith("crear-documento"),
    );
    expect(intentos).toEqual(["crear-documento:pago-1", "choque-clave"]);
  });
});

describe("R45 — dos pagos legitimos identicos son DOS pagos", () => {
  it("mismo beneficiario, monto, metodo y fecha, con dos claves: entran los dos", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store);

    // Dos entregas de 5 000 en efectivo el mismo dia a la misma tienda. Dos aperturas del
    // formulario -> dos claves. Una clave natural (beneficiario, monto, metodo, fecha) se habria
    // tragado la segunda EN SILENCIO (alternativa C, descartada).
    const a = await service.registrarPagoTienda(pago("5000.00", CLAVE_A), ACTOR);
    const b = await service.registrarPagoTienda(pago("5000.00", CLAVE_B), ACTOR);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(store.pagos).toHaveLength(2);
    expect(store.pagos[0].id).not.toBe(store.pagos[1].id);
    expect(totalPagado(store)).toBe("10000.00");
    // Y cada movimiento cuelga de SU documento: el indice unico parcial no los confunde.
    const debitos = store.movimientos.filter((m) => m.categoria === "pago_tienda");
    expect(debitos).toHaveLength(2);
    expect(new Set(debitos.map((m) => m.origenId)).size).toBe(2);
  });

  it("lo mismo contra un cierre: dos pagos parciales identicos suman en el libro", async () => {
    const store = makeStore("0.00");
    const service = buildService(store);

    const a = await service.registrarPagoMensajero(pagoMensajero("5000.00", CLAVE_A), ACTOR);
    const b = await service.registrarPagoMensajero(pagoMensajero("5000.00", CLAVE_B), ACTOR);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(store.pagos).toHaveLength(2);
    expect(totalLiquidado(store)).toBe("10000.00");
    expect(store.movimientosMensajero.filter((m) => m.categoria === "liquidacion")).toHaveLength(2);
  });
});

describe("el documento y el libro NO divergen (design §5)", () => {
  it("Σ pagos vigentes del cierre == Σ movimientos `liquidacion`, y el pendiente cuadra", async () => {
    const store = makeStore("0.00");
    const service = buildService(store);

    await service.registrarPagoMensajero(pagoMensajero("20000.00", CLAVE_A), ACTOR);
    const ultima = await service.registrarPagoMensajero(pagoMensajero("15000.50", CLAVE_B), ACTOR);

    const sumaDocumentos = store.pagos
      .filter((p) => p.cierreId === "c1" && p.anulacion === null)
      .reduce((acc, p) => acc.add(p.monto), new Prisma.Decimal(0))
      .toFixed(2);
    expect(sumaDocumentos).toBe("35000.50");
    expect(totalLiquidado(store)).toBe("35000.50"); // el libro dice exactamente lo mismo

    // …y el pendiente derivado del cierre coincide con lo que devolvio el servicio.
    const cierre = store.cierres[0];
    expect(
      derivarPendienteCierre(cierre.totalPagoMensajero, cierre.totalEfectivo, sumaDocumentos),
    ).toBe("14999.50");
    expect(ultima).toMatchObject({ status: "ok", restante: "14999.50" });

    // Cada movimiento apunta a SU documento (R38).
    const liquidaciones = store.movimientosMensajero.filter((m) => m.categoria === "liquidacion");
    expect(liquidaciones.map((m) => m.origenId).sort()).toEqual(
      store.pagos.map((p) => p.id).sort(),
    );
    expect(liquidaciones.every((m) => m.origenTipo === "pago_mensajero")).toBe(true);
    expect(liquidaciones.every((m) => m.tipo === "pago")).toBe(true);
  });

  it("R42: pagar NO toca el snapshot del cierre (ni P, ni E, ni el estado)", async () => {
    const store = makeStore("0.00");
    const service = buildService(store);
    const antes = {
      ...store.cierres[0],
      totalPagoMensajero: store.cierres[0].totalPagoMensajero.toFixed(2),
      totalEfectivo: store.cierres[0].totalEfectivo.toFixed(2),
    };

    await service.registrarPagoMensajero(pagoMensajero("20000.00", CLAVE_A), ACTOR);

    // (El `tx` del store REVIENTA si alguien llama a update/updateMany/delete sobre cierre_dia:
    //  esta comparacion es la segunda red, no la unica.)
    expect(store.cierres).toHaveLength(1);
    expect({
      ...store.cierres[0],
      totalPagoMensajero: store.cierres[0].totalPagoMensajero.toFixed(2),
      totalEfectivo: store.cierres[0].totalEfectivo.toFixed(2),
    }).toEqual(antes);
  });
});

describe("R48 — reintentar la APROBACION de un cierre sigue sin duplicar movimientos", () => {
  it("el feed del cierre es no-op al reintentarse, y el pago de la 172 CONVIVE con el", async () => {
    const store = makeStore("0.00");
    const service = buildService(store);
    const libroRepo = new PagoMensajeroMovimientoRepository(
      store.clienteLectura as unknown as PrismaClient,
    );
    // Las dos filas que el feed del cierre (feature 44) escribe al aprobar.
    const delCierre: CrearPagoMensajeroInput[] = [
      {
        mensajeroId: "m1",
        tipo: "devengo",
        categoria: "pago_devengado",
        monto: "50000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
      },
      {
        mensajeroId: "m1",
        tipo: "pago",
        categoria: "pago_efectivo",
        monto: "0.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
      },
    ];

    const primera = await store.runTransaction((tx) => libroRepo.crearMovimientos(tx, delCierre));
    // La MISMA aprobacion, reintentada (el caso real: el admin le da dos veces, o hay un retry).
    const segunda = await store.runTransaction((tx) => libroRepo.crearMovimientos(tx, delCierre));

    expect(primera).toBe(2);
    expect(segunda).toBe(0); // ON CONFLICT DO NOTHING: ni una fila nueva
    expect(store.movimientosMensajero).toHaveLength(2);

    // Y ahora la liquidacion: su movimiento tiene OTRO `origen_tipo`, asi que el indice unico
    // parcial no lo confunde con los del cierre. Si compartieran clave, la 172 habria roto R48.
    const r = await service.registrarPagoMensajero(pagoMensajero("20000.00", CLAVE_A), ACTOR);

    expect(r.status).toBe("ok");
    expect(store.movimientosMensajero).toHaveLength(3);
    const claves = store.movimientosMensajero.map(
      (m) => `${m.origenTipo}|${m.origenId}|${m.mensajeroId}|${m.categoria}`,
    );
    expect(new Set(claves).size).toBe(3);
  });

  it("y el propio movimiento del pago es idempotente por su `origen_id` (doble escritura = no-op)", async () => {
    const store = makeStore("0.00");
    const libroRepo = new PagoMensajeroMovimientoRepository(
      store.clienteLectura as unknown as PrismaClient,
    );
    const dePago: CrearPagoMensajeroInput[] = [
      {
        mensajeroId: "m1",
        tipo: "pago",
        categoria: "liquidacion",
        monto: "20000.00",
        origenTipo: "pago_mensajero",
        origenId: "pago-1",
      },
    ];

    const n1 = await store.runTransaction((tx) => libroRepo.crearMovimientos(tx, dePago));
    const n2 = await store.runTransaction((tx) => libroRepo.crearMovimientos(tx, dePago));

    expect(n1).toBe(1);
    expect(n2).toBe(0);
    expect(totalLiquidado(store)).toBe("20000.00");
  });
});

describe("R46/R83/R85 [P1] — el candado del CIERRE serializa igual que el de la tienda", () => {
  it("el bloqueo es sobre `cierre_dia` y se toma ANTES de leer el pendiente", async () => {
    const store = makeStore("0.00");
    const service = buildService(store);

    const r = await service.registrarPagoMensajero(pagoMensajero("20000.00", CLAVE_A), ACTOR);

    expect(r.status).toBe("ok");
    expect(store.log).toEqual([
      "candado:cierre_dia:c1",
      "candado-tomado:cierre_dia:c1",
      "leer-cierre:c1",
      "leer-pagado-vigente",
      "crear-documento:pago-1",
      "crear-movimiento-mensajero:1",
      "commit",
    ]);
    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(1); // R85
  });

  it("dos pagos simultaneos al MISMO cierre: entra uno y el otro se rechaza con lo que queda", async () => {
    const store = makeStore("0.00"); // cierre con pendiente 50 000
    const service = buildService(store);

    const [a, b] = await Promise.all([
      service.registrarPagoMensajero(pagoMensajero("30000.00", CLAVE_A), ACTOR),
      service.registrarPagoMensajero(pagoMensajero("30000.00", CLAVE_B), ACTOR),
    ]);

    expect([a.status, b.status].sort()).toEqual(["excede", "ok"]);
    const rechazado = a.status === "excede" ? a : b;
    if (rechazado.status !== "excede") throw new Error("esperaba excede");
    expect(rechazado.disponible).toBe("20000.00"); // 50 000 - 30 000 del que si entro
    expect(totalLiquidado(store)).toBe("30000.00"); // entre los dos NO se pago de mas
    expect(store.pagos).toHaveLength(1);
  });

  it("dos pagos a CIERRES distintos no se estorban (el grano es la fila del cierre)", async () => {
    const store = makeStore("0.00", [
      cierreAprobado(),
      cierreAprobado({ id: "c2", mensajeroId: "m2" }),
    ]);
    const service = buildService(store);

    const [a, b] = await Promise.all([
      service.registrarPagoMensajero(pagoMensajero("30000.00", CLAVE_A), ACTOR),
      service.registrarPagoMensajero(
        { ...pagoMensajero("30000.00", CLAVE_B), cierreId: "c2" },
        ACTOR,
      ),
    ]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(store.log.filter((l) => l.startsWith("candado:")).sort()).toEqual([
      "candado:cierre_dia:c1",
      "candado:cierre_dia:c2",
    ]);
    expect(totalLiquidado(store)).toBe("60000.00");
  });

  it("R20: un cierre que no esta aprobado no escribe NADA, ni siquiera bajo carrera", async () => {
    const store = makeStore("0.00", [cierreAprobado({ estado: "solicitado" })]);
    const service = buildService(store);

    const [a, b] = await Promise.all([
      service.registrarPagoMensajero(pagoMensajero("10000.00", CLAVE_A), ACTOR),
      service.registrarPagoMensajero(pagoMensajero("10000.00", CLAVE_B), ACTOR),
    ]);

    expect([a.status, b.status]).toEqual(["cierre_no_aprobado", "cierre_no_aprobado"]);
    expect(store.pagos).toHaveLength(0);
    expect(store.movimientosMensajero).toHaveLength(0);
    // El candado si se tomo (va antes de la guardia) y se solto: no quedan transacciones vivas.
    expect(store.log.filter((l) => l.startsWith("candado:"))).toHaveLength(2);
  });
});

// =============================================================================================
// T F.3 — VOLVER A PAGAR LO ANULADO. R78, R79 y R80, con la cadena entera:
//
//     pagar -> anular -> el pendiente vuelve a su valor -> registrar de nuevo con CLAVE NUEVA
//     y la MISMA referencia y fecha real -> se acepta.
//
// Aqui la cadena corre sobre el store, es decir: el servicio real, los TRES repositorios reales
// y las restricciones de la base imitadas (el `UNIQUE(clave_idempotencia)`, el `UNIQUE(pago_id)`
// de la anulacion, el indice unico parcial de cada libro y el `FOR UPDATE`). Lo que los tests de
// servicio no pueden ver —que «vigente» sea de verdad `anulacion IS NULL` en el `where`, y que
// la clave NO se libere al anular— solo es observable a este nivel.
// =============================================================================================

const CLAVE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REFERENCIA = "1234567";
const MOTIVO = "Monto mal tecleado";

/** 14:30 de Costa Rica del 5 de agosto: el dia CALENDARIO de la anulacion es el 2026-08-05. */
const AHORA_ANULACION = () => new Date("2026-08-05T20:30:00.000Z");
const DIA_DE_LA_ANULACION = "2026-08-05T00:00:00.000Z";

/** Un pago a la tienda CON referencia y metodo electronico: R78 va justo sobre esos dos datos. */
function pagoConReferencia(monto: string, clave: string): RegistrarPagoTiendaInput {
  return { ...pago(monto, clave), metodo: "SINPE", referencia: REFERENCIA };
}

/** Lo mismo contra el cierre `c1`. */
function pagoMensajeroConReferencia(monto: string, clave: string): RegistrarPagoMensajeroInput {
  return { ...pagoMensajero(monto, clave), metodo: "SINPE", referencia: REFERENCIA };
}

/** Σ de una categoria concreta en cualquiera de los dos libros, como STRING money-safe. */
function totalDeCategoria(
  movs: Array<{ categoria: string; monto: Prisma.Decimal }>,
  categoria: string,
): string {
  return movs
    .filter((m) => m.categoria === categoria)
    .reduce((acc, m) => acc.add(m.monto), new Prisma.Decimal(0))
    .toFixed(2);
}

/** El id del pago que devolvio un registro correcto (y revienta si no salio bien). */
function idDelPago(r: Awaited<ReturnType<LiquidacionService["registrarPagoTienda"]>>): string {
  if (r.status !== "ok") throw new Error(`esperaba ok, llego ${r.status}`);
  return r.pago.id;
}

describe("T F.3/R79/R80 — MENSAJERO: pagar, anular y volver a pagar lo mismo", () => {
  it("LA CADENA: el pendiente vuelve a su valor y el pago nuevo entra con la misma referencia", async () => {
    const store = makeStore("0.00"); // cierre c1: P = 50 000, E = 0 -> pendiente 50 000
    const service = buildService(store, AHORA_ANULACION);

    // 1) PAGAR 20 000 de los 50 000 pendientes.
    const primero = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );
    expect(primero).toMatchObject({ status: "ok", restante: "30000.00" });
    const pagoId = idDelPago(primero);

    // 2) ANULAR: el monto vuelve a estar adeudado, ENTERO (R79).
    const anulado = await service.anularPago({ pagoId, motivo: MOTIVO }, ACTOR);
    expect(anulado).toMatchObject({ status: "ok", restante: "50000.00" });

    // 3) El pendiente derivado por el camino de siempre dice lo mismo (R80): la suma de VIGENTES
    //    excluye el anulado, y esa suma la calcula el repositorio REAL contra el store.
    const repo = new LiquidacionPagoRepository(store.clienteLectura as unknown as PrismaClient);
    expect(await repo.sumarVigentesPorCierre(["c1"])).toEqual({ c1: "0.00" });
    const cierre = store.cierres[0];
    expect(
      derivarPendienteCierre(cierre.totalPagoMensajero, cierre.totalEfectivo, "0.00"),
    ).toBe("50000.00");

    // 4) REGISTRAR DE NUEVO con CLAVE NUEVA y la MISMA referencia y fecha real (R78).
    const segundo = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_B),
      ACTOR,
    );
    expect(segundo).toMatchObject({ status: "ok", restante: "30000.00" });
    if (segundo.status !== "ok") return;
    expect(segundo.pago.referencia).toBe(REFERENCIA);
    expect(segundo.pago.fechaPago).toBe("2026-07-30"); // la misma fecha real, sin problema
    expect(segundo.pago.id).not.toBe(pagoId); // es un pago NUEVO, no el resucitado

    // El libro cuadra: dos pagos y un reverso -> neto 20 000, el del pago vigente.
    expect(totalDeCategoria(store.movimientosMensajero, "liquidacion")).toBe("40000.00");
    expect(totalDeCategoria(store.movimientosMensajero, "ajuste_devengo")).toBe("20000.00");
    expect(store.pagos).toHaveLength(2);
    expect(store.anulaciones).toHaveLength(1);
  });

  it("EL DETALLE: reutilizar la clave del pago ANULADO devuelve `ya_registrado` y no crea nada", async () => {
    // La clave de idempotencia NO se libera al anular, y es lo correcto: el `UNIQUE` de la
    // columna sigue ahi porque el pago sigue ahi. Volver a pagar exige una clave NUEVA (R79);
    // reintentar con la vieja es el reintento de una peticion que ya se atendio.
    const store = makeStore("0.00");
    const service = buildService(store, AHORA_ANULACION);

    const primero = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );
    const pagoId = idDelPago(primero);
    await service.anularPago({ pagoId, motivo: MOTIVO }, ACTOR);
    await service.registrarPagoMensajero(pagoMensajeroConReferencia("20000.00", CLAVE_B), ACTOR);

    const filasAntes = store.pagos.length;
    const movimientosAntes = store.movimientosMensajero.length;
    const reintento = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );

    expect(reintento.status).toBe("ya_registrado");
    if (reintento.status !== "ya_registrado") return;
    // Devuelve el comprobante ANULADO, entero y marcado (R74): no lo resucita ni lo esconde.
    expect(reintento.pago.id).toBe(pagoId);
    expect(reintento.pago.monto).toBe("20000.00");
    expect(reintento.pago.anulacion).toEqual({
      motivo: MOTIVO,
      anuladoPorNombre: "Mario Maestro",
      anuladoAt: "2026-08-05T20:31:00.000Z",
    });
    // CERO filas nuevas: ni documento, ni movimiento, ni anulacion.
    expect(store.pagos).toHaveLength(filasAntes);
    expect(store.movimientosMensajero).toHaveLength(movimientosAntes);
    expect(store.anulaciones).toHaveLength(1);
    // Y el restante que informa es el REAL: el del pago vigente, no el del anulado.
    expect(reintento.restante).toBe("30000.00");
  });

  it("R78: la fila del pago anulado queda INTACTA (monto, referencia, fecha real y actor)", async () => {
    const store = makeStore("0.00");
    const service = buildService(store, AHORA_ANULACION);

    const primero = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );
    const pagoId = idDelPago(primero);
    const antes = { ...store.pagos[0], monto: store.pagos[0].monto.toFixed(2) };

    await service.anularPago({ pagoId, motivo: MOTIVO }, ACTOR);

    const despues = { ...store.pagos[0], monto: store.pagos[0].monto.toFixed(2) };
    // Lo UNICO que cambia es que ahora tiene su fila de anulacion colgando. Ni una columna del
    // documento se toco: «anulado» se DERIVA de que exista esa fila (design §2.2).
    expect({ ...despues, anulacion: null }).toEqual({ ...antes, anulacion: null });
    expect(despues.anulacion).not.toBeNull();
    expect(despues.referencia).toBe(REFERENCIA);
    expect(despues.fechaPago.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("R77: el contraasiento se fecha el dia de la ANULACION, no el del pago", async () => {
    const store = makeStore("0.00");
    const service = buildService(store, AHORA_ANULACION);

    const primero = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );
    await service.anularPago({ pagoId: idDelPago(primero), motivo: MOTIVO }, ACTOR);

    const pagado = store.movimientosMensajero.find((m) => m.categoria === "liquidacion");
    const reverso = store.movimientosMensajero.find((m) => m.categoria === "ajuste_devengo");
    expect(pagado?.fechaMovimiento?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(reverso?.fechaMovimiento?.toISOString()).toBe(DIA_DE_LA_ANULACION);
    // El reverso es del signo opuesto y cuelga del MISMO documento (R69/R38).
    expect(reverso).toMatchObject({ tipo: "devengo", origenTipo: "pago_mensajero" });
    expect(reverso?.origenId).toBe(pagado?.origenId);
  });

  it("el pago y su contraasiento CONVIVEN bajo el mismo `origen_id` (la categoria los separa)", async () => {
    const store = makeStore("0.00");
    const service = buildService(store, AHORA_ANULACION);

    const primero = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );
    await service.anularPago({ pagoId: idDelPago(primero), motivo: MOTIVO }, ACTOR);

    // El indice unico parcial es `(origen_tipo, origen_id, mensajero, categoria)`: los dos caben
    // porque la categoria difiere, y ninguno de los dos puede duplicarse.
    expect(store.movimientosMensajero).toHaveLength(2);
    const claves = store.movimientosMensajero.map(
      (m) => `${m.origenTipo}|${m.origenId}|${m.mensajeroId}|${m.categoria}`,
    );
    expect(new Set(claves).size).toBe(2);
    expect(new Set(store.movimientosMensajero.map((m) => m.origenId)).size).toBe(1);
  });

  it("R75/R82: anular dos veces devuelve `ya_anulado` y no escribe un segundo reverso", async () => {
    const store = makeStore("0.00");
    const service = buildService(store, AHORA_ANULACION);

    const primero = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );
    const pagoId = idDelPago(primero);

    const a = await service.anularPago({ pagoId, motivo: MOTIVO }, ACTOR);
    const b = await service.anularPago({ pagoId, motivo: "Otro motivo distinto" }, ACTOR);

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ya_anulado");
    // La barrera es la RESTRICCION: el INSERT se intenta las dos veces y lo rechaza el UNIQUE.
    expect(store.log.filter((l) => l === "choque-anulacion")).toHaveLength(1);
    expect(store.anulaciones).toHaveLength(1);
    expect(store.anulaciones[0].motivo).toBe(MOTIVO); // el motivo de la PRIMERA
    expect(totalDeCategoria(store.movimientosMensajero, "ajuste_devengo")).toBe("20000.00");
    expect(store.movimientosMensajero).toHaveLength(2);
  });

  it("R84/R83: la anulacion toma el candado del CIERRE y lee el pendiente DESPUES", async () => {
    // El `FOR UPDATE` es SQL crudo del repositorio REAL: el store lo detecta leyendo la
    // sentencia, no tiene una lista de a quien bloquear. Si alguien lo quitara, no habria
    // `candado:` en el log.
    const store = makeStore("0.00");
    const service = buildService(store, AHORA_ANULACION);
    const primero = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("20000.00", CLAVE_A),
      ACTOR,
    );
    const marca = store.log.length;

    await service.anularPago({ pagoId: idDelPago(primero), motivo: MOTIVO }, ACTOR);

    expect(store.log.slice(marca)).toEqual([
      "leer-por-id:pago-1", // R70: el pago, SERVER-SIDE, antes de saber que bloquear
      "candado:cierre_dia:c1", // R84: el MISMO candado que tomo su pago
      "candado-tomado:cierre_dia:c1",
      "leer-cierre:c1",
      "leer-pagado-vigente", // R83: el disponible, BAJO el candado
      "crear-anulacion:pago-1",
      "crear-movimiento-mensajero:1",
      "commit",
    ]);
    expect(store.log.slice(marca).filter((l) => l.startsWith("candado:"))).toHaveLength(1); // R85
  });

  it("R84 [P1]: una anulacion y un registro simultaneos NO leen el mismo disponible", async () => {
    // Es literalmente para lo que existe R84. Se sale a la vez a anular un pago de 30 000 y a
    // registrar uno de 10 000 contra el mismo cierre: pase quien pase primero, el ESTADO FINAL
    // es el mismo, porque el segundo lee lo que el primero ya dejo escrito.
    const store = makeStore("0.00");
    const service = buildService(store, AHORA_ANULACION);
    const previo = await service.registrarPagoMensajero(
      pagoMensajeroConReferencia("30000.00", CLAVE_A),
      ACTOR,
    );
    const pagoId = idDelPago(previo);
    const marca = store.log.length;

    const [anulacion, registro] = await Promise.all([
      service.anularPago({ pagoId, motivo: MOTIVO }, ACTOR),
      service.registrarPagoMensajero(pagoMensajeroConReferencia("10000.00", CLAVE_B), ACTOR),
    ]);

    // El tramo del log se fotografia AQUI, antes de que las comprobaciones de abajo añadan sus
    // propias lecturas: lo que se mide es la carrera, no lo que el test hace despues.
    const tramo = store.log.slice(marca);

    expect(anulacion.status).toBe("ok");
    expect(registro.status).toBe("ok");
    // Estado final, independiente del orden: solo el pago de 10 000 sigue vigente.
    const repo = new LiquidacionPagoRepository(store.clienteLectura as unknown as PrismaClient);
    expect(await repo.sumarVigentesPorCierre(["c1"])).toEqual({ c1: "10000.00" });
    const neto = new Prisma.Decimal(totalDeCategoria(store.movimientosMensajero, "liquidacion"))
      .sub(totalDeCategoria(store.movimientosMensajero, "ajuste_devengo"))
      .toFixed(2);
    expect(neto).toBe("10000.00");

    // Y la prueba de que se SERIALIZO: la segunda lectura del pendiente cae despues del commit
    // de la primera operacion. Sin candado, las dos leerian antes de cualquier commit.
    const commit = tramo.indexOf("commit");
    const lecturas = tramo
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l === "leer-pagado-vigente")
      .map(({ i }) => i);
    expect(lecturas).toHaveLength(2);
    expect(lecturas[0]).toBeLessThan(commit);
    expect(lecturas[1]).toBeGreaterThan(commit);
  });
});

describe("T F.3/R79/R80 — TIENDA: la misma cadena contra el saldo acumulado", () => {
  it("LA CADENA: el saldo vuelve a 100 000 y el pago nuevo entra con la misma referencia", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store, AHORA_ANULACION);

    const primero = await service.registrarPagoTienda(
      pagoConReferencia("15000.00", CLAVE_A),
      ACTOR,
    );
    expect(primero).toMatchObject({ status: "ok", restante: "85000.00" });
    const pagoId = idDelPago(primero);

    const anulado = await service.anularPago({ pagoId, motivo: MOTIVO }, ACTOR);
    expect(anulado).toMatchObject({ status: "ok", restante: "100000.00" });

    // El reverso es un CREDITO por el mismo monto, fechado el dia de la anulacion (R69/R77).
    const reverso = store.movimientos.find((m) => m.categoria === "ajuste_credito");
    expect(reverso).toMatchObject({ tipo: "credito", origenTipo: "pago_tienda", origenId: pagoId });
    expect(reverso?.monto.toFixed(2)).toBe("15000.00");
    expect(reverso?.fechaMovimiento?.toISOString()).toBe(DIA_DE_LA_ANULACION);

    // Volver a pagar: clave NUEVA, misma referencia y misma fecha real (R78/R79).
    const segundo = await service.registrarPagoTienda(
      pagoConReferencia("15000.00", CLAVE_B),
      ACTOR,
    );
    expect(segundo).toMatchObject({ status: "ok", restante: "85000.00" });
    if (segundo.status !== "ok") return;
    expect(segundo.pago.referencia).toBe(REFERENCIA);
    expect(segundo.pago.fechaPago).toBe("2026-07-30");

    // El saldo del ledger cuadra al centimo: 100 000 + 15 000 de reverso - 30 000 de dos pagos.
    const saldo = store.movimientos
      .reduce((acc, m) => (m.tipo === "credito" ? acc.add(m.monto) : acc.sub(m.monto)), new Prisma.Decimal(0))
      .toFixed(2);
    expect(saldo).toBe("85000.00");
  });

  it("EL DETALLE: reutilizar la clave del pago anulado devuelve `ya_registrado` y no crea nada", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store, AHORA_ANULACION);

    const primero = await service.registrarPagoTienda(
      pagoConReferencia("15000.00", CLAVE_A),
      ACTOR,
    );
    const pagoId = idDelPago(primero);
    await service.anularPago({ pagoId, motivo: MOTIVO }, ACTOR);

    const reintento = await service.registrarPagoTienda(
      pagoConReferencia("15000.00", CLAVE_A),
      ACTOR,
    );

    expect(reintento.status).toBe("ya_registrado");
    if (reintento.status !== "ya_registrado") return;
    expect(reintento.pago.id).toBe(pagoId);
    expect(reintento.pago.anulacion).not.toBeNull();
    expect(store.pagos).toHaveLength(1); // ni un documento nuevo
    expect(totalPagado(store)).toBe("15000.00"); // ni un debito nuevo
    // El disponible que informa ya cuenta con el reverso aplicado (R71).
    expect(reintento.restante).toBe("100000.00");
  });

  it("R80: el pago anulado deja de contar en la suma de vigentes de la TIENDA", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store, AHORA_ANULACION);
    const repo = new LiquidacionPagoRepository(store.clienteLectura as unknown as PrismaClient);

    const primero = await service.registrarPagoTienda(
      pagoConReferencia("15000.00", CLAVE_A),
      ACTOR,
    );
    await service.registrarPagoTienda(pagoConReferencia("25000.00", CLAVE_B), ACTOR);
    // La suma cuenta los dos mientras los dos estan vigentes…
    expect(await repo.sumarVigentesPorTienda("t1")).toBe("40000.00");

    await service.anularPago({ pagoId: idDelPago(primero), motivo: MOTIVO }, ACTOR);

    // …y deja de contar el anulado en cuanto existe su fila de anulacion. Sin tocar el pago.
    expect(await repo.sumarVigentesPorTienda("t1")).toBe("25000.00");
    expect(store.pagos).toHaveLength(2);
    expect(store.pagos.filter((p) => p.anulacion !== null)).toHaveLength(1);
  });

  it("R74: la LISTA de comprobantes sigue trayendo el anulado, entero y marcado", async () => {
    // La contracara de R80: las SUMAS excluyen los anulados, la LISTA no.
    const store = makeStore("100000.00");
    const service = buildService(store, AHORA_ANULACION);
    const primero = await service.registrarPagoTienda(
      pagoConReferencia("15000.00", CLAVE_A),
      ACTOR,
    );
    await service.anularPago({ pagoId: idDelPago(primero), motivo: MOTIVO }, ACTOR);

    const r = await service.listarPagosDeTienda("t1", ACTOR);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pagos).toHaveLength(1);
    expect(r.pagos[0]).toMatchObject({
      monto: "15000.00",
      metodo: "SINPE",
      referencia: REFERENCIA,
      fechaPago: "2026-07-30",
    });
    expect(r.pagos[0]!.anulacion).toEqual({
      motivo: MOTIVO,
      anuladoPorNombre: "Mario Maestro",
      anuladoAt: "2026-08-05T20:31:00.000Z",
    });
  });

  it("tres pagos, uno anulado: el saldo y las sumas cuadran al centimo", async () => {
    const store = makeStore("100000.00");
    const service = buildService(store, AHORA_ANULACION);
    const repo = new LiquidacionPagoRepository(store.clienteLectura as unknown as PrismaClient);

    const a = await service.registrarPagoTienda(pagoConReferencia("15000.55", CLAVE_A), ACTOR);
    await service.registrarPagoTienda(pagoConReferencia("25000.45", CLAVE_B), ACTOR);
    await service.anularPago({ pagoId: idDelPago(a), motivo: MOTIVO }, ACTOR);
    const ultimo = await service.registrarPagoTienda(pagoConReferencia("15000.55", CLAVE_C), ACTOR);

    // 100 000 - 25 000,45 - 15 000,55 = 59 999,00 (el anulado no descuenta).
    expect(ultimo).toMatchObject({ status: "ok", restante: "59999.00" });
    expect(await repo.sumarVigentesPorTienda("t1")).toBe("40001.00");
    const saldo = store.movimientos
      .reduce((acc, m) => (m.tipo === "credito" ? acc.add(m.monto) : acc.sub(m.monto)), new Prisma.Decimal(0))
      .toFixed(2);
    expect(saldo).toBe("59999.00");
  });
});
