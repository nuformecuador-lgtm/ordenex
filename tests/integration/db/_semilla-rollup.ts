import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { GestionCausaDevolucion, GestionResultado, OrdenHistorialOrigenTipo } from "@prisma/client";
import { AnaliticaRollupRepository } from "@/lib/repositories/AnaliticaRollupRepository";
import { AnaliticaRollupService } from "@/lib/services/AnaliticaRollupService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { IAnaliticaRollupService } from "@/lib/interfaces/services/IAnaliticaRollupService";

/**
 * Feature 124 / T6.1 — utilidad de SIEMBRA del rollup diario contra el Postgres local.
 *
 * NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
 *
 * Tres decisiones que sostienen todo lo demas:
 *
 * 1. **Todo dentro de una transaccion que SIEMPRE se revierte** (`enTransaccionRevertida` de
 *    `_postgres-real.ts`, patron de la 123/169). La base de desarrollo la comparten varias
 *    sesiones: si un test dejara una fila, rompe a otro.
 *
 * 2. **La fecha objetivo vive en un pasado donde la base real no tiene NADA** (`FECHA_D` y sus
 *    vecinas, ano 2001). El universo del rollup NO esta acotado por fecha en su rama de stock
 *    (D2-B2 rama (a): toda orden viva cuyo estatus al corte no es terminal), asi que sin este
 *    aislamiento las cuentas de cada caso irian mezcladas con el archivo entero de la base de
 *    desarrollo y no afirmarian nada. El primer caso del archivo COMPRUEBA el aislamiento: con
 *    cero siembra, la corrida escribe cero filas.
 *
 * 3. **`orden.estatus_id` se siembra a proposito con un valor que NO es el estatus al corte**
 *    (`ESTATUS_VIVO_TRAMPA`). Es una trampa deliberada para R24: si algun dia el agregador
 *    leyera la columna en vivo en vez del historial, casi todos los casos de este archivo se
 *    pondrian rojos a la vez.
 */

/** Cliente de transaccion tal y como lo entrega `enTransaccionRevertida`. */
export type TxDeTest = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** El dia que agregan casi todos los casos, y sus dos vecinos (R35). */
export const FECHA_D_MENOS_1 = "2001-06-14";
export const FECHA_D = "2001-06-15";
export const FECHA_D_MAS_1 = "2001-06-16";

/**
 * Estatus con el que se siembra `orden.estatus_id`. NO es el estatus al corte de ningun caso:
 * R24 prohibe leer esa columna y esta trampa lo vuelve observable.
 */
const ESTATUS_VIVO_TRAMPA = "en_bodega_central";

/** Instante UTC de una hora de PARED de Costa Rica (UTC-6 fijo, sin horario de verano). */
export function instanteCR(fecha: string, horaCR: string): Date {
  const [y, m, d] = fecha.split("-").map((n) => Number.parseInt(n, 10));
  const [hh, mm, ss] = horaCR.split(":").map((n) => Number.parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, hh + 6, mm, ss ?? 0));
}

/** Las coordenadas y el catalogo que comparte una corrida sembrada. */
export interface BaseSembrada {
  readonly sufijo: string;
  readonly zonaA: string;
  readonly zonaB: string;
  readonly tienda1: string;
  readonly tienda2: string;
  /** Mensajero de la ZONA B: el caso de R22 lo pone a gestionar una orden de la zona A. */
  readonly mensajero1: string;
  readonly mensajero2: string;
  readonly provinciaId: string;
  readonly cantonId: string;
  /**
   * `value` del catalogo -> id. Incluye el estatus HUERFANO que la 155 retiro sin sucesor y
   * que sobrevive en la tabla `order_status` (R45). El literal no se escribe aqui a proposito:
   * lo nombra el unico sitio que no tiene mas remedio, el caso de R45 en
   * `analytics-daily-job.test.ts`, que es el que esta en la allowlist del censo de la 135/155.
   */
  readonly estatus: ReadonlyMap<string, string>;
  /** id -> etiqueta legible, para que las aserciones no comparen uuids. */
  readonly etiqueta: ReadonlyMap<string, string>;
}

/** id del estatus por su `value`; explota si el catalogo local no lo tiene. */
export function estatusId(base: BaseSembrada, value: string): string {
  const id = base.estatus.get(value);
  if (id === undefined) throw new Error(`el catalogo local no tiene el estatus "${value}"`);
  return id;
}

/**
 * Crea las coordenadas propias del caso (dos zonas, dos tiendas, dos mensajeros) en vez de
 * reutilizar filas de la base de desarrollo: asi las aserciones no dependen de que datos tenga
 * la maquina de quien corre la suite. Provincia y canton SI se toman del catalogo geografico,
 * que es fijo y no participa en ninguna medida.
 */
export async function sembrarBase(tx: TxDeTest): Promise<BaseSembrada> {
  const sufijo = `t6-${randomUUID().slice(0, 8)}`;

  const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
  if (canton === null) throw new Error("la base local no tiene catalogo geografico (canton)");

  const [tipoIdentificacion, rolMensajero, rolTienda] = await Promise.all([
    tx.tipoIdentificacion.findFirst({ select: { id: true } }),
    tx.rol.findFirst({ where: { value: "mensajero" }, select: { id: true } }),
    tx.rol.findFirst({ where: { value: "adminTienda" }, select: { id: true } }),
  ]);
  if (tipoIdentificacion === null || rolMensajero === null || rolTienda === null) {
    throw new Error("la base local no tiene los catalogos de rol / tipo de identificacion");
  }

  const etiqueta = new Map<string, string>();

  const crearZona = async (nombre: string): Promise<string> => {
    const z = await tx.zona.create({ data: { nombre: `${sufijo}-${nombre}` }, select: { id: true } });
    etiqueta.set(z.id, nombre);
    return z.id;
  };
  const crearUsuario = async (nombre: string, rolId: string, zonaId: string | null): Promise<string> => {
    const u = await tx.usuario.create({
      data: {
        nombre: `${sufijo}-${nombre}`,
        email: `${sufijo}-${nombre}@t6.local`,
        telefono: "88880000",
        passwordHash: "no-es-una-credencial",
        cedula: `${sufijo}-${nombre}`,
        tipoIdentificacionId: tipoIdentificacion.id,
        rolId,
        zonaId,
      },
      select: { id: true },
    });
    etiqueta.set(u.id, nombre);
    return u.id;
  };

  const zonaA = await crearZona("zonaA");
  const zonaB = await crearZona("zonaB");
  const tienda1 = await crearUsuario("tienda1", rolTienda.id, null);
  const tienda2 = await crearUsuario("tienda2", rolTienda.id, null);
  // `mensajero1` pertenece a la ZONA B: el caso de R22 le hace gestionar una orden de la A.
  const mensajero1 = await crearUsuario("mensajero1", rolMensajero.id, zonaB);
  const mensajero2 = await crearUsuario("mensajero2", rolMensajero.id, zonaB);

  const catalogo = await tx.orderStatus.findMany({ select: { id: true, value: true } });
  const estatus = new Map(catalogo.map((s) => [s.value, s.id]));
  for (const s of catalogo) etiqueta.set(s.id, s.value);

  return {
    sufijo,
    zonaA,
    zonaB,
    tienda1,
    tienda2,
    mensajero1,
    mensajero2,
    provinciaId: canton.provinciaId,
    cantonId: canton.id,
    estatus,
    etiqueta,
  };
}

export interface SemillaOrden {
  /** Etiqueta legible del caso; entra en `num_remision` para poder rastrearla. */
  readonly clave: string;
  readonly zonaId: string;
  readonly tiendaId: string;
  /** `orden.mensajero_asignado_id`. `null` (por defecto) = cubo sin asignar (R25). */
  readonly mensajeroId?: string | null;
  readonly createdAt: Date;
  readonly deletedAt?: Date | null;
}

/** Inserta una orden con `orden.estatus_id` = la trampa de R24 (ver cabecera). */
export async function crearOrden(
  tx: TxDeTest,
  base: BaseSembrada,
  semilla: SemillaOrden,
): Promise<string> {
  const orden = await tx.orden.create({
    data: {
      numRemision: `${base.sufijo}-${semilla.clave}`,
      destinatario: "Persona De Prueba",
      telefonoDest: "80000000",
      producto: "caja",
      estatusId: estatusId(base, ESTATUS_VIVO_TRAMPA),
      tiendaId: semilla.tiendaId,
      zonaId: semilla.zonaId,
      provinciaId: base.provinciaId,
      cantonId: base.cantonId,
      mensajeroAsignadoId: semilla.mensajeroId ?? null,
      deletedAt: semilla.deletedAt ?? null,
      createdAt: semilla.createdAt,
    },
    select: { id: true },
  });
  return orden.id;
}

export interface SemillaTransicion {
  readonly at: Date;
  /** `value` del catalogo al que TRANSITA la orden. */
  readonly destino: string;
  readonly origenTipo?: OrdenHistorialOrigenTipo;
  readonly gestionOrdenId?: string | null;
  /** Id EXPLICITO: el caso del empate de `created_at` necesita controlar el desempate. */
  readonly id?: string;
}

export async function agregarTransicion(
  tx: TxDeTest,
  base: BaseSembrada,
  ordenId: string,
  t: SemillaTransicion,
): Promise<string> {
  const fila = await tx.ordenHistorialEstado.create({
    data: {
      id: t.id ?? randomUUID(),
      ordenId,
      estatusDestinoId: estatusId(base, t.destino),
      origenTipo: t.origenTipo ?? "ajuste_estado",
      gestionOrdenId: t.gestionOrdenId ?? null,
      createdAt: t.at,
    },
    select: { id: true },
  });
  return fila.id;
}

export interface SemillaCierre {
  readonly mensajeroId: string;
  /** Zona destino del cierre: la del mensajero que cierra. */
  readonly zonaId: string;
  readonly at: Date;
}

/**
 * Feature 215 — un `cierre_dia` ya APROBADO. Existe porque el criterio de "intento de entrega"
 * dejo de derivarse de los DESTINOS del historial y pasa por la gestion: solo cuenta la gestion
 * vigente que pertenece a un cierre en estado `aprobado` (`whereIntentosVigentes`,
 * `lib/repositories/OrdenHistorialRepository.ts`). Una devolucion sembrada SIN cierre ya no
 * acumula intento, asi que el caso que distingue un reintento de un primer intento necesita
 * poder crear ese cierre.
 *
 * Valores minimos y coherentes con el aislamiento: sin totales (los defaults son 0, y el rollup
 * no los lee) y con las fechas del ano 2001 de la siembra. `bodega_central` como destino porque
 * ninguna medida de este archivo depende del destino del cierre.
 */
export async function crearCierreAprobado(tx: TxDeTest, c: SemillaCierre): Promise<string> {
  const fila = await tx.cierreDia.create({
    data: {
      mensajeroId: c.mensajeroId,
      estado: "aprobado",
      destinoTipo: "bodega_central",
      destinoZonaId: c.zonaId,
      solicitadoAt: c.at,
      resueltoAt: c.at,
      createdAt: c.at,
    },
    select: { id: true },
  });
  return fila.id;
}

export interface SemillaGestion {
  readonly ordenId: string;
  readonly mensajeroId: string;
  readonly resultado: GestionResultado;
  readonly at: Date;
  readonly causaDevolucion?: GestionCausaDevolucion | null;
  readonly anuladaAt?: Date | null;
  /**
   * Feature 215 — cierre al que pertenece la gestion. Opcional y `null` por defecto (como
   * `anuladaAt`): una gestion sin cierre NO cuenta como intento de entrega.
   */
  readonly cierreId?: string | null;
}

export async function crearGestion(tx: TxDeTest, g: SemillaGestion): Promise<string> {
  const fila = await tx.gestionOrden.create({
    data: {
      ordenId: g.ordenId,
      mensajeroId: g.mensajeroId,
      resultado: g.resultado,
      causaDevolucion: g.causaDevolucion ?? null,
      anuladaAt: g.anuladaAt ?? null,
      cierreId: g.cierreId ?? null,
      createdAt: g.at,
    },
    select: { id: true },
  });
  return fila.id;
}

/** La consulta con la que el repositorio toma la marca de la corrida (`SELECT now()`). */
const MARCA_DE_CORRIDA = /^\s*SELECT\s+now\(\)\s+AS\s+marca\s*$/i;

/**
 * Numero de corrida POR TRANSACCION del test, no por instancia de cliente: cada `correr()`
 * construye su propio servicio (como hace `buildAnaliticaRollupService` en produccion), asi que
 * el contador no puede vivir dentro del cliente o se reiniciaria en cada corrida.
 */
const corridasPorTransaccion = new WeakMap<object, { n: number }>();

/**
 * Cliente Prisma sobre la transaccion del test, con DOS adaptaciones del arnes, las dos
 * declaradas porque cambian lo que el test puede afirmar:
 *
 * 1. **`$transaction` emulado por SAVEPOINT.** `AnaliticaRollupRepository.escribirFecha` abre
 *    su propia transaccion y el cliente interactivo de Prisma no anida. Un `$transaction` que
 *    solo ejecutara el callback dejaria el caso de atomicidad (R30) sin nada que medir: el
 *    rollback parcial no ocurriria. Con SAVEPOINT el todo-o-nada se ejerce DE VERDAD —una
 *    escritura abortada revierte hasta el punto anterior— dentro de la transaccion externa que
 *    el test revierte al final. Limite: mide el rollback, no el aislamiento entre dos
 *    conexiones concurrentes (R31 no se cubre aqui).
 *
 * 2. **La marca de la corrida AVANZA entre corridas.** En Postgres `now()` es
 *    `transaction_timestamp()`: dentro de UNA transaccion vale siempre lo mismo. Como el arnes
 *    mete todas las corridas de un caso en la misma transaccion externa, las dos corridas de
 *    R27 verian la MISMA marca y el barrido de rancias de R29 (`updated_at < marca`) no podria
 *    borrar nada: seria un artefacto del arnes, no del codigo. En produccion cada corrida es su
 *    propia transaccion y la marca avanza. Esto lo reproduce: la marca sigue viniendo del reloj
 *    de POSTGRES, solo se le suma un segundo por corrida. El predicado del barrido, los
 *    `updated_at`/`created_at` de las filas y el orden de las operaciones son los de produccion,
 *    sin tocar.
 */
export function clienteSobreTransaccion(tx: TxDeTest): PrismaClient {
  let contador = corridasPorTransaccion.get(tx);
  if (contador === undefined) {
    contador = { n: 0 };
    corridasPorTransaccion.set(tx, contador);
  }
  const corridas = contador;
  const queryRaw = (consulta: TemplateStringsArray, ...valores: unknown[]): unknown => {
    if (valores.length === 0 && consulta.length === 1 && MARCA_DE_CORRIDA.test(consulta[0])) {
      return tx.$queryRawUnsafe(`SELECT now() + ($1 * interval '1 second') AS marca`, corridas.n);
    }
    return tx.$queryRaw(consulta, ...valores);
  };
  /** El mismo `tx`, con la marca de la corrida avanzada. Lo recibe el callback del repo. */
  const txConMarca = new Proxy(tx, {
    get(objetivo, prop, receptor) {
      if (prop === "$queryRaw") return queryRaw;
      const valor = Reflect.get(objetivo, prop, receptor) as unknown;
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  });
  const cliente = {
    $queryRaw: queryRaw,
    $transaction: async (fn: (c: TxDeTest) => Promise<unknown>) => {
      corridas.n += 1;
      const punto = `sp_rollup_${corridas.n}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
      try {
        const valor = await fn(txConMarca);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
        return valor;
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
        throw error;
      }
    },
  };
  return cliente as unknown as PrismaClient;
}

/** El repositorio REAL, atado a la transaccion del test. */
export function crearRepositorio(tx: TxDeTest): AnaliticaRollupRepository {
  return new AnaliticaRollupRepository(clienteSobreTransaccion(tx));
}

/**
 * El servicio REAL con sus dependencias REALES, calcado de `buildAnaliticaRollupService`:
 * el criterio de "primer intento" es el punto unico de la feature 160, no un doble (R17).
 */
export function crearServicio(tx: TxDeTest): IAnaliticaRollupService {
  const prismaDelHistorial = tx as unknown as PrismaClient;
  return new AnaliticaRollupService(
    crearRepositorio(tx),
    new OrdenHistorialService(
      new OrdenRepository(prismaDelHistorial),
      new OrdenHistorialRepository(prismaDelHistorial),
      new OrdenDiaRepartoCambioRepository(prismaDelHistorial),
    ),
    { now: () => new Date(), logger: { warn: () => {} } },
  );
}

/** Una fila del rollup con las coordenadas ya traducidas a etiquetas legibles. */
export interface FilaLeida {
  readonly fecha: string;
  readonly zona: string;
  readonly tienda: string;
  readonly mensajero: string | null;
  readonly estatus: string;
  readonly causa: string | null;
  readonly ordenesCreadas: number;
  readonly ordenesEstadoStock: number;
  readonly entregas: number;
  readonly devoluciones: number;
  readonly rechazos: number;
  readonly reprogramaciones: number;
  readonly incidentes: number;
  readonly primerIntentoOk: number;
  readonly segCicloAcum: number;
  readonly segCicloN: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface FilaCruda {
  fecha: Date;
  zona_id: string;
  tienda_id: string;
  mensajero_id: string | null;
  estatus_id: string;
  causa_devolucion: string | null;
  ordenes_creadas: number;
  ordenes_estado_stock: number;
  entregas: number;
  devoluciones: number;
  rechazos: number;
  reprogramaciones: number;
  incidentes: number;
  primer_intento_ok: number;
  seg_ciclo_acum: bigint;
  seg_ciclo_n: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Lee las filas de UNA fecha del rollup y traduce las coordenadas a etiquetas. Una coordenada
 * que no sea de la siembra sale como su uuid: si eso apareciera, el aislamiento se rompio.
 */
export async function leerFilas(
  tx: TxDeTest,
  base: BaseSembrada,
  fecha: string,
): Promise<FilaLeida[]> {
  const filas = await tx.$queryRaw<FilaCruda[]>`
    SELECT * FROM "analytics_daily" WHERE "fecha" = ${fecha}::date`;
  const et = (id: string | null): string | null =>
    id === null ? null : (base.etiqueta.get(id) ?? id);
  return filas
    .map((f) => ({
      fecha: f.fecha.toISOString().slice(0, 10),
      zona: et(f.zona_id) as string,
      tienda: et(f.tienda_id) as string,
      mensajero: et(f.mensajero_id),
      estatus: et(f.estatus_id) as string,
      causa: f.causa_devolucion,
      ordenesCreadas: Number(f.ordenes_creadas),
      ordenesEstadoStock: Number(f.ordenes_estado_stock),
      entregas: Number(f.entregas),
      devoluciones: Number(f.devoluciones),
      rechazos: Number(f.rechazos),
      reprogramaciones: Number(f.reprogramaciones),
      incidentes: Number(f.incidentes),
      primerIntentoOk: Number(f.primer_intento_ok),
      segCicloAcum: Number(f.seg_ciclo_acum),
      segCicloN: Number(f.seg_ciclo_n),
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    }))
    .sort((a, b) => claveOrden(a).localeCompare(claveOrden(b)));
}

/** Orden estable de las filas leidas, para poder comparar conjuntos sin depender del motor. */
export function claveOrden(f: FilaLeida): string {
  return [f.zona, f.tienda, f.mensajero ?? "-", f.estatus, f.causa ?? "-"].join("|");
}

/** Proyeccion de una fila a solo sus coordenadas + las medidas no nulas: aserciones legibles. */
export function resumen(f: FilaLeida): Record<string, string | number | null> {
  const medidas: Record<string, number> = {
    ordenesCreadas: f.ordenesCreadas,
    ordenesEstadoStock: f.ordenesEstadoStock,
    entregas: f.entregas,
    devoluciones: f.devoluciones,
    rechazos: f.rechazos,
    reprogramaciones: f.reprogramaciones,
    incidentes: f.incidentes,
    primerIntentoOk: f.primerIntentoOk,
    segCicloAcum: f.segCicloAcum,
    segCicloN: f.segCicloN,
  };
  const noNulas = Object.fromEntries(Object.entries(medidas).filter(([, v]) => v !== 0));
  return {
    zona: f.zona,
    tienda: f.tienda,
    mensajero: f.mensajero,
    estatus: f.estatus,
    causa: f.causa,
    ...noNulas,
  };
}
