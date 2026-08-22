import { randomUUID } from "node:crypto";
import type { GestionResultado, PrismaClient } from "@prisma/client";

import { TableroDiaRepository } from "@/lib/repositories/TableroDiaRepository";
import type { FilaTableroDia } from "@/lib/types/tablero-dia";
import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

/**
 * Feature 192 — utilidad de SIEMBRA de los tests de integracion del tablero del dia.
 *
 * NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
 *
 * Tres decisiones que sostienen todo lo demas:
 *
 * 1. **Todo dentro de una transaccion que SIEMPRE se revierte** (`enTransaccionRevertida`,
 *    patron de la 124/169). La base de desarrollo la comparten varias sesiones: si un test
 *    dejara una fila, rompe a otro. Un `afterAll` que borre no da esa garantia — no corre si
 *    el runner se cae.
 *
 * 2. **El dia sembrado vive en un pasado donde la base real no tiene nada** (2001). El
 *    universo del tablero SI esta acotado por el dia, asi que en teoria bastaria con el
 *    aislamiento temporal; pero una orden de desarrollo asignada "hoy" contaminaria las
 *    cuentas de cualquiera que corriese la suite con datos de prueba. El primer caso de
 *    `tablero-dia-conteo` comprueba el aislamiento: con cero siembra, cero filas.
 *
 * 3. **Cada caso siembra sus propias coordenadas** (dos zonas, una tienda, dos mensajeros y
 *    un maestro) en vez de reutilizar filas de la base: asi las aserciones no dependen de que
 *    datos tenga la maquina de quien corre la suite.
 */

/** Cliente de transaccion tal y como lo entrega `enTransaccionRevertida`. */
export type TxDeTest = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const FECHA_CR = "2001-06-15";

/** Instante UTC de una hora de PARED de Costa Rica (UTC-6 fijo, sin horario de verano). */
export function instanteCR(fecha: string, horaCR: string): Date {
  const [y, m, d] = fecha.split("-").map((n) => Number.parseInt(n, 10));
  const [hh, mm, ss] = horaCR.split(":").map((n) => Number.parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, hh + 6, mm, ss ?? 0));
}

/**
 * FEATURE 259 (T3.1) — el valor de `orden.fecha_reparto` para una fecha calendario CR.
 *
 * ⚠️ ES LA **MEDIANOCHE UTC** DE ESA FECHA, NO LAS 06:00Z, y la diferencia no es cosmética: la
 * columna es `@db.Date` y ésa es la convención del repo para ese tipo (feature 46, y lo que
 * devuelve `resolverFechaReparto`). Las cotas `…T06:00:00.000Z` de `instanteCR` son para las
 * columnas `timestamp` (`asignado_at`, `gestion_orden.created_at`). Mezclarlas es el off-by-one
 * de seis horas que cerró la ficha 166, y aquí sembraría el día equivocado sin que nada avise.
 */
export function diaReparto(fecha: string): Date {
  const [y, m, d] = fecha.split("-").map((n) => Number.parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/** Las 19:00 hora de Costa Rica: el caso de R13, con la ventana ya bien entrada. */
export const AHORA = instanteCR(FECHA_CR, "19:00");
export const VENTANA = ventanaDelDiaEnCursoCR(AHORA);

export interface BaseSembrada {
  readonly sufijo: string;
  readonly zonaA: string;
  readonly zonaB: string;
  readonly tienda: string;
  /** Mensajero cuya `usuario.zona_id` es la zona B: R6 exige que eso NO decida nada. */
  readonly mensajero1: string;
  readonly mensajero2: string;
  /** Quien ASIGNA (actor del historial y de gestiones ajenas). No reparte: R26/R60. */
  readonly maestro: string;
  readonly provinciaId: string;
  readonly cantonId: string;
  readonly estatus: ReadonlyMap<string, string>;
}

export function estatusId(base: BaseSembrada, value: string): string {
  const id = base.estatus.get(value);
  if (id === undefined) throw new Error(`el catalogo local no tiene el estatus "${value}"`);
  return id;
}

export async function sembrarBase(tx: TxDeTest): Promise<BaseSembrada> {
  const sufijo = `f192-${randomUUID().slice(0, 8)}`;

  const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
  if (canton === null) throw new Error("la base local no tiene catalogo geografico (canton)");

  const [tipoIdentificacion, rolMensajero, rolTienda, rolMaestro] = await Promise.all([
    tx.tipoIdentificacion.findFirst({ select: { id: true } }),
    tx.rol.findFirst({ where: { value: "mensajero" }, select: { id: true } }),
    tx.rol.findFirst({ where: { value: "adminTienda" }, select: { id: true } }),
    tx.rol.findFirst({ where: { value: "maestro" }, select: { id: true } }),
  ]);
  if (!tipoIdentificacion || !rolMensajero || !rolTienda || !rolMaestro) {
    throw new Error("la base local no tiene los catalogos de rol / tipo de identificacion");
  }

  const crearZona = async (nombre: string): Promise<string> =>
    (await tx.zona.create({ data: { nombre: `${sufijo}-${nombre}` }, select: { id: true } })).id;

  const crearUsuario = async (
    nombre: string,
    rolId: string,
    zonaId: string | null,
  ): Promise<string> =>
    (
      await tx.usuario.create({
        data: {
          nombre,
          primerApellido: "Prueba",
          email: `${sufijo}-${nombre}@f192.local`,
          telefono: "88880000",
          passwordHash: "no-es-una-credencial",
          cedula: `${sufijo}-${nombre}`,
          tipoIdentificacionId: tipoIdentificacion.id,
          rolId,
          zonaId,
        },
        select: { id: true },
      })
    ).id;

  const zonaA = await crearZona("zonaA");
  const zonaB = await crearZona("zonaB");
  const tienda = await crearUsuario("Tienda", rolTienda.id, null);
  // Los dos mensajeros pertenecen a la ZONA B; sus ordenes se sembraran en la A. R6 exige que
  // el recorte mire la zona de la ORDEN, asi que esta trampa es deliberada.
  const mensajero1 = await crearUsuario("Ana", rolMensajero.id, zonaB);
  const mensajero2 = await crearUsuario("Beto", rolMensajero.id, zonaB);
  const maestro = await crearUsuario("Maestro", rolMaestro.id, null);

  const catalogo = await tx.orderStatus.findMany({ select: { id: true, value: true } });

  return {
    sufijo,
    zonaA,
    zonaB,
    tienda,
    mensajero1,
    mensajero2,
    maestro,
    provinciaId: canton.provinciaId,
    cantonId: canton.id,
    estatus: new Map(catalogo.map((s) => [s.value, s.id])),
  };
}

export interface SemillaOrden {
  /** Etiqueta legible del caso; entra en `num_remision` para poder rastrearla. */
  readonly clave: string;
  readonly zonaId?: string;
  readonly mensajeroId?: string | null;
  /** `value` del catalogo. El SEGUNDO EJE del tablero se lee de aqui (R43). */
  readonly estatus: string;
  /**
   * `orden.asignado_at`. `undefined` = NULL, que es el caso de una orden que solo entra por
   * el camino de RECOLECCION (R57): la 157 no estampa esta columna a proposito.
   */
  readonly asignadoAt?: Date | null;
  /**
   * FEATURE 259 — `orden.fecha_reparto` (`@db.Date`), el DIA PARA EL QUE bodega hizo la
   * asignacion. Se construye con `diaReparto("2001-06-15")`, nunca con `instanteCR`.
   *
   * `undefined` = NULL, y eso NO es un descuido: es la rama (b), el respaldo por `asignado_at`
   * para las ordenes anteriores a la 246 (no hay backfill y no lo habra). Ningun test escrito
   * antes de la 259 fija este campo, asi que **todos ellos ejercitan la rama (b)** y siguen
   * siendo evidencia valida de que ese respaldo funciona.
   */
  readonly fechaReparto?: Date | null;
}

export async function crearOrden(
  tx: TxDeTest,
  base: BaseSembrada,
  semilla: SemillaOrden,
): Promise<string> {
  const orden = await tx.orden.create({
    data: {
      numRemision: `${base.sufijo}-${semilla.clave}`,
      destinatario: `Cliente ${semilla.clave}`,
      telefonoDest: "80000000",
      direccion: `Direccion ${semilla.clave}`,
      producto: "caja",
      estatusId: estatusId(base, semilla.estatus),
      tiendaId: base.tienda,
      zonaId: semilla.zonaId ?? base.zonaA,
      provinciaId: base.provinciaId,
      cantonId: base.cantonId,
      mensajeroAsignadoId: semilla.mensajeroId ?? null,
      asignadoAt: semilla.asignadoAt ?? null,
      fechaReparto: semilla.fechaReparto ?? null,
      createdAt: instanteCR(FECHA_CR, "07:00"),
    },
    select: { id: true },
  });
  return orden.id;
}

export interface SemillaGestion {
  readonly ordenId: string;
  /** El actor de la GESTION. R26: puede no ser el mensajero asignado. */
  readonly mensajeroId: string;
  readonly resultado: GestionResultado;
  readonly at: Date;
  readonly anuladaAt?: Date | null;
}

export async function crearGestion(tx: TxDeTest, g: SemillaGestion): Promise<string> {
  const fila = await tx.gestionOrden.create({
    data: {
      ordenId: g.ordenId,
      mensajeroId: g.mensajeroId,
      resultado: g.resultado,
      anuladaAt: g.anuladaAt ?? null,
      createdAt: g.at,
    },
    select: { id: true },
  });
  return fila.id;
}

/**
 * La transicion que abre el SEGUNDO camino de "asignada hoy" (R57): la que escribe la feature
 * 157 en la misma tx que `por_recolectar_en_tienda -> recolectando`.
 *
 * `actorUsuarioId` es el MAESTRO que decide, no el mensajero que va: R60 exige que la orden
 * acabe en la tarjeta del mensajero asignado y no en la del maestro.
 */
export async function transicionDeRecoleccion(
  tx: TxDeTest,
  base: BaseSembrada,
  ordenId: string,
  at: Date,
): Promise<string> {
  const fila = await tx.ordenHistorialEstado.create({
    data: {
      ordenId,
      estatusOrigenId: estatusId(base, "por_recolectar_en_tienda"),
      estatusDestinoId: estatusId(base, "recolectando"),
      actorUsuarioId: base.maestro,
      origenTipo: "asignacion_recoleccion",
      createdAt: at,
    },
    select: { id: true },
  });
  return fila.id;
}

/** El repositorio REAL, atado a la transaccion del test. */
export function repositorio(tx: TxDeTest): TableroDiaRepository {
  return new TableroDiaRepository(tx as unknown as Pick<PrismaClient, "$queryRaw">);
}

/**
 * R25 — LA IDENTIDAD DE OCHO SUMANDOS, que se asserta en CADA escenario:
 *
 *   asignadas = entregadas + reprogramadas + devueltas + rechazadas + incidentes
 *             + sinRecoger + enReparto + otros
 *
 * Es la propiedad que hace creible al tablero entero: si no se cumple, hay una orden contada
 * dos veces o una orden que se cayo de todos los cubos, y las dos cosas se ven en la pantalla
 * como numeros que no cuadran.
 */
export function sumaDeLosOcho(f: Omit<FilaTableroDia, "mensajeroId" | "mensajeroNombre">): number {
  return (
    f.entregadas +
    f.reprogramadas +
    f.devueltas +
    f.rechazadas +
    f.incidentes +
    f.sinRecoger +
    f.enReparto +
    f.otros
  );
}
