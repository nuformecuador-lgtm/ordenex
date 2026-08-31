import { vi } from "vitest";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";

// Feature 160 — doble compartido del derivador de intentos EN LOTE. Existe para que las 7
// suites que ganaron la dependencia no dupliquen el mismo `vi.fn(async () => new Map())` (la
// deuda "fakes de repositorio a mano y duplicados" de `progress/current.md`): si mañana cambia
// la firma de `contarIntentosEnLote`, se arregla AQUI y no en siete archivos.

/**
 * Lo que consumen los servicios de lectura.
 *
 * ⚠️ FEATURE 276 (T4): el tipo GANA `contarIntentos` (el conteo de UNA orden), porque
 * `MisAsignacionesService` lo necesita para la puerta del tope. Los servicios que solo piden
 * `contarIntentosEnLote` siguen aceptando este doble sin cambios (un objeto con un metodo de mas
 * es asignable a un `Pick` mas estrecho): por eso el doble se ENSANCHA aqui, una vez, en vez de
 * escribir un segundo doble en cada suite.
 */
export type IntentosSvcDoble = Pick<
  IOrdenHistorialService,
  "contarIntentosEnLote" | "contarIntentos"
>;

/**
 * Doble del derivador. Sin argumento devuelve el Map VACIO, que es el caso "ninguna orden
 * tiene intentos" y ejerce el default `?? 0` de los servicios (R14: el `0` se expone, no se
 * omite). Con `porOrden` devuelve exactamente esos conteos.
 *
 * FEATURE 276: `contarIntentos` sale del MISMO `porOrden`, no de un segundo argumento. Eso es
 * deliberado: en produccion los dos metodos son el mismo criterio (215/R4/R6), asi que un doble
 * que pudiera devolver numeros distintos por las dos vias permitiria escribir tests que en la
 * realidad no pueden ocurrir.
 *
 * El `vi.fn` queda expuesto para asertar R12 (exactamente 1 llamada por listado) y R13
 * (0 llamadas con lote vacio).
 */
export function fakeIntentosEnLote(
  porOrden: Record<string, number> = {},
): IntentosSvcDoble {
  return {
    contarIntentosEnLote: vi.fn(async () => new Map(Object.entries(porOrden))),
    contarIntentos: vi.fn(async (ordenId: string) => porOrden[ordenId] ?? 0),
  };
}

// FICHA 319 (2026-08-28): el doble PIERDE `idsConGestionPosteriorEnLote` y su segundo argumento
// `conGestion`. Lo gano el 2026-08-27 para alimentar `sinGestion` (¿ofrezco el boton Eliminar?);
// ese criterio se retiro —hoy manda el ESTADO de la orden— y ningun servicio consulta ya el
// historial para esto. Un doble que ofrece un metodo que nadie llama es el mismo cable suelto en
// el lado de los tests: sugiere una dependencia que no existe.

/** Atajo tipado para leer las llamadas del doble en las aserciones. */
export function llamadasIntentos(doble: IntentosSvcDoble): string[][] {
  return (doble.contarIntentosEnLote as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => c[0] as string[],
  );
}

// --- Evaluador SEMANTICO del predicado de intentos -----------------------------------------
//
// Un mini-interprete del `where` de Prisma que produce `whereIntentosVigentes`, para poder
// probar el SIGNIFICADO del criterio sin DB. Vive aqui, y no copiado en cada suite, porque el
// criterio es UNO solo (215/R6): dos evaluadores que se desincronizaran harian exactamente el
// daño que la feature vino a evitar.
//
// Feature 215: el predicado cambio de tabla. Antes desestructuraba filas de
// `orden_historial_estado` (`AND: [{OR: destinos}, {OR: vigencia}]`); ahora evalua filas de
// `gestion_orden` con resultado + vigencia + cierre aprobado.

/** Fila de `gestion_orden` de ejemplo, con lo justo que el predicado mira. */
export interface FilaGestionFake {
  ordenId: string;
  /** valor del enum `GestionResultado`. */
  resultado: string;
  /** NULL = gestion VIGENTE; con fecha = gestion anulada (deshecha). */
  anuladaAt: Date | null;
  /** NULL = gestion del dia aun no cerrada (no pertenece a ningun cierre). */
  cierreId: string | null;
  /** estado del cierre al que pertenece; `null` cuando `cierreId` es null. */
  cierreEstado: string | null;
  /**
   * Feature 215 (T21) — familias (`origen_tipo`) de las filas de `orden_historial_estado` que
   * enlazan ESTA gestion por `gestion_orden_id`. Es el discriminador de la SEXTA condicion del
   * predicado (design §3.4): `["gestion"]` = visita real del mensajero;
   * `["escalado_devuelta_sla"]` = sintetica del cron SLA; `["reprogramacion_tienda"]` =
   * reprogramacion de escritorio de la tienda; `[]` = gestion LEGADA sin fila de historial que
   * la respalde (R34-d).
   *
   * REQUERIDO a proposito, sin default: asi el typecheck obliga a que CADA fila de test declare
   * explicitamente de donde nace su gestion. Con un default (`["gestion"]` o `[]`) una suite
   * entera podria quedarse verde por omision silenciosa, que es justo el modo de fallo que este
   * discriminador existe para impedir — y el que cobra dinero de mas.
   */
  origenTiposHistorial: string[];
}

/** Forma del `where` que produce `whereIntentosVigentes` (feature 215). */
interface WhereIntentos {
  ordenId: FiltroOrdenFake;
  resultado: { in: string[] };
  anuladaAt: null;
  cierreId: { not: null };
  cierre: { estado: string };
  historialEstados: { some: { ordenId: FiltroOrdenFake; origenTipo: { in: string[] } } };
}

/** El filtro de orden del predicado: id suelto o lote. */
type FiltroOrdenFake = string | { in: string[] };

/** `true` si ese filtro de orden alcanza a `ordenId`. */
function filtroAlcanza(filtro: FiltroOrdenFake, ordenId: string): boolean {
  return typeof filtro === "string" ? filtro === ordenId : filtro.in.includes(ordenId);
}

/** `true` si la fila de gestion casa el `where` de `whereIntentosVigentes`. */
export function filaCasaIntento(
  where: Record<string, unknown>,
  fila: FilaGestionFake,
): boolean {
  const w = where as unknown as WhereIntentos;
  // Lista de INCLUSION: `resultado.in`. Si alguien la reescribiera como `notIn`, esta
  // desestructuracion fallaria en vez de dejar pasar resultados nuevos en silencio.
  if (!w.resultado.in.includes(fila.resultado)) return false;
  if (fila.anuladaAt !== null) return false; // R5: la anulada no cuenta
  if (fila.cierreId === null) return false; // gestion del dia sin cerrar
  if (fila.cierreEstado !== w.cierre.estado) return false; // D8/R3: solo `aprobado`
  // Feature 215 (T21) — SEXTA condicion: la gestion tiene que nacer de una VISITA REAL (D13).
  // Se evalua el `some` DE VERDAD, no su presencia: hay que leer `historialEstados.some` (si
  // alguien lo reescribiera como `none`, esta lectura es `undefined` y el acceso siguiente
  // REVIENTA en vez de dejar pasar las sinteticas) y su `origenTipo.in` (idem con `notIn`).
  const familias = w.historialEstados.some.origenTipo.in;
  // El `ordenId` repetido dentro del `some` es parte del predicado (rendimiento, design §3.4):
  // si desapareciera o dejara de acotar a la orden, este evaluador lo nota.
  if (!filtroAlcanza(w.historialEstados.some.ordenId, fila.ordenId)) return false;
  // `some` = interseccion NO vacia. Sin filas de historial (gestion legada) no hay interseccion
  // posible ⇒ no cuenta (R34-d, direccion segura del error).
  return fila.origenTiposHistorial.some((t) => familias.includes(t));
}

/** `true` si el `where` acota a esa orden (id suelto o lote `{ in: [...] }`). */
export function whereAlcanzaOrden(where: Record<string, unknown>, ordenId: string): boolean {
  return filtroAlcanza(where.ordenId as FiltroOrdenFake, ordenId);
}

/**
 * Doble de Prisma que EVALUA de verdad el predicado contra `filas`, en vez de devolver un numero
 * fijo. Con el, `OrdenHistorialRepository` deja de estar mockeado: el `groupBy` responde lo que
 * el criterio realmente dice de esas filas.
 *
 * El doble RESPETA el `by` del `groupBy`: con `by: ["cierreId"]` emite una fila por cierre
 * distinto, y con `by: ["ordenId","cierreId"]` una por par. Eso es deliberado — si el doble
 * ignorara el `by` y agrupara siempre por orden, regalaria el grano (R29/R30) y un `count()` de
 * gestiones pasaria los tests. Aqui el grano se MIDE.
 */
export function prismaGestionSobreFilas(filas: FilaGestionFake[]) {
  const casan = (where: Record<string, unknown>): FilaGestionFake[] =>
    filas.filter((f) => whereAlcanzaOrden(where, f.ordenId) && filaCasaIntento(where, f));
  return {
    gestionOrden: {
      groupBy: vi.fn(
        async ({ by, where }: { by: string[]; where: Record<string, unknown> }) => {
          const grupos = new Map<string, Record<string, unknown>>();
          for (const f of casan(where)) {
            const fila = f as unknown as Record<string, unknown>;
            const clave = by.map((k) => String(fila[k])).join("\u0000");
            if (!grupos.has(clave)) {
              grupos.set(clave, Object.fromEntries(by.map((k) => [k, fila[k]])));
            }
          }
          return [...grupos.values()];
        },
      ),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    ordenHistorialEstado: {
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      createMany: vi.fn(),
    },
  };
}
