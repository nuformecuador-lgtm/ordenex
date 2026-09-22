import { z } from "zod";
import type { ActionError } from "@/lib/types/orden";

// FICHA 453 (design §3.1, §4, §5 — T1.1) — LA FRONTERA CONTRACTUAL DE LAS VISTAS DE FILTROS.
//
// MODULO PURO: sin React, sin Prisma, sin `next/`. Aqui vive lo que la tabla, el servicio, las
// Server Actions y el control de la barra tienen que compartir sin importarse entre si: la lista
// de superficies, el formato persistido del filtro, los topes y los schemas del borde.
//
// ⚠️ ESTE FORMATO NO ES EL DE LA CLAVE DE CACHE, Y NO PUEDE ACERCARSE (R6). `serializarFiltro`
// (`app/(app)/ordenes/_components/serializar-filtro.ts`) existe para otra cosa —la identidad de
// cache/refetch del listado— y no sirve aqui por cuatro motivos medidos (design §2.4): no escapa
// el separador y `q` es texto libre, serializa el TRANSPORTE y no el estado de la barra, ordena
// los valores (el viaje de ida y vuelta no es la identidad), y su proposito declarado es otro.
// Si los dos formatos se juntaran, un cambio en la clave de cache cambiaria en silencio el
// significado de filas ya guardadas. Una guardia del arbol
// (`tests/unit/guards/vista-filtro-formato-propio.guardia.test.ts`) se pone roja si alguien
// importa aquel modulo desde la persistencia de vistas.

/**
 * Las superficies que HOY declaran vistas. Una superficie es el JUEGO DE FILTROS de una pantalla,
 * no su ruta (design §10): `/cierres-admin` monta la misma barra con tres juegos distintos y el
 * dia que se encienda seran TRES superficies, no una.
 *
 * ⚠️ ENCENDER UNA SUPERFICIE NUEVA ES AÑADIR UNA CADENA AQUI (R32). No hay migracion, no hay enum
 * de Postgres y no hay columna nueva: la columna `superficie` es TEXT a proposito. Lo que si hay
 * es una guardia (`vistas-superficies-declaradas.guardia.test.ts`, R34): una superficie declarada
 * que nadie monta pone el arbol en rojo, para que no quede un mecanismo que nadie puede disparar.
 */
export const SUPERFICIES_VISTA = ["ordenes"] as const;

export type SuperficieVista = (typeof SUPERFICIES_VISTA)[number];

/**
 * R33 — una superficie NO DECLARADA es un error explicito, nunca una lista vacia. Una lista vacia
 * seria indistinguible de «esta persona todavia no ha guardado nada» (R38), que es un estado
 * legitimo y silencioso: el fallo se veria como una pantalla normal y nadie se enteraria.
 */
export const superficieVistaSchema = z.enum(SUPERFICIES_VISTA);

/**
 * R7 — VERSION DEL FORMATO PERSISTIDO. Viaja DOS veces a proposito: dentro del documento (`v`) y
 * en su propia columna (`vista_filtro.version`), para poder contar y filtrar por version sin abrir
 * el JSON el dia que exista una v2.
 */
export const VISTA_FILTRO_VERSION = 1;

/**
 * Las versiones que ESTE codigo sabe leer. Hoy es una; el dia que haya una v2, esta lista y
 * `leerPayloadGuardado` son los dos unicos sitios que hay que tocar.
 */
export const VERSIONES_LEGIBLES: readonly number[] = [VISTA_FILTRO_VERSION];

/** design §3.4 — el tope por persona y superficie. Lo impone el SERVICIO, no la base. */
export const MAX_VISTAS_POR_SUPERFICIE = 20;

/** R10 — maximo del nombre visible, ya recortados los extremos. Espeja `@db.VarChar(60)`. */
export const NOMBRE_VISTA_MAX = 60;

/**
 * Tope de cordura del nombre EN EL BORDE. No es la regla de R10 —esa la aplica el servicio y dice
 * cual es el maximo—: esto solo impide que una entrada absurda (un megabyte de texto) llegue a
 * recorrerse y a compararse. Un nombre entre 61 y este tope entra y se rechaza DICIENDO el maximo,
 * que es lo que R10 exige; por encima, es basura y se corta en el borde.
 */
const NOMBRE_TOPE_DE_CORDURA = 1000;

/**
 * R5 — EL FILTRO GUARDADO SON LAS TRES PIEZAS DE LA BARRA, no una.
 *
 * Son exactamente los tres estados que el consumidor de la barra mantiene (`terminoBuscador`,
 * `filtrosActivos`, `seleccionFiltros`). Reponer esos tres es reponer la barra; no hay un cuarto.
 *
 * `activos` NO SE PUEDE DERIVAR de `seleccion`: un control montado y vacio no aporta ninguna clave
 * a la seleccion, asi que si no se guardara aparte, aplicar una vista perderia los controles que
 * la persona dejo puestos sin elegir nada todavia.
 *
 * ⚠️ EL ORDEN DEL LISTADO NO ENTRA (`sortBy`/`sortDir`), confirmado por el humano el 2026-09-21
 * (requirements.md > P1): el orden no esconde filas. El campo `v` deja añadirlo despues sin romper
 * nada de lo ya guardado.
 */
export const vistaFiltroPayloadSchema = z
  .object({
    /** R7/R8 — la version del formato. Un documento sin ella, o con otra, NO se interpreta. */
    v: z.literal(VISTA_FILTRO_VERSION),
    /** El termino del buscador, ya recortado. Cadena vacia = sin busqueda. */
    termino: z.string().max(500),
    /** Claves de los controles MONTADOS, en su orden. */
    activos: z.array(z.string().min(1).max(120)).max(50),
    /** La seleccion agregada, TAL CUAL la emite `FilterComponent` (`Record<string, string[]>`). */
    seleccion: z.record(z.string().min(1).max(120), z.array(z.string().max(500)).max(1000)),
  })
  .strict();

export type VistaFiltroPayload = z.infer<typeof vistaFiltroPayloadSchema>;

/**
 * R12 — «no hay nada que guardar»: ni termino, ni controles montados, ni un solo valor elegido.
 *
 * Una clave con lista VACIA no cuenta como valor puesto: `FilterComponent` no emite claves vacias,
 * pero un documento guardado a mano si podria traerlas y eso no es un filtro.
 */
export function payloadVacio(payload: VistaFiltroPayload): boolean {
  if (payload.termino.trim() !== "") return false;
  if (payload.activos.length > 0) return false;
  return Object.values(payload.seleccion).every((valores) => valores.length === 0);
}

/**
 * R7/R8 — QUE PASA AL LEER UNA VERSION QUE NO SE CONOCE, dicho en codigo y no solo en el diseño.
 *
 * La respuesta es: NO SE ADIVINA. Un documento cuya `v` no esta en `VERSIONES_LEGIBLES` —porque lo
 * escribio un despliegue mas nuevo, o porque alguien lo edito a mano— devuelve `null`, la vista
 * sale del servicio con `filtro: null` y la interfaz la marca ILEGIBLE: no se aplica ni entera ni
 * en parte, y se sigue pudiendo renombrar y borrar. Intentar leerla «lo mejor posible» seria
 * aplicar un filtro que nadie guardo, que es el fallo mudo que esta ficha existe para evitar.
 *
 * EL DIA QUE HAYA UNA v2, esto es lo que hay que hacer y no hay atajo: añadir el 2 a
 * `VERSIONES_LEGIBLES`, escribir aqui el migrador v1 -> v2 (leer el documento viejo y devolver la
 * forma nueva) y dejar el schema de v1 vivo mientras queden filas con `version = 1` — que es
 * exactamente lo que la columna `vista_filtro.version` deja contar antes de decidir.
 */
export function leerPayloadGuardado(valor: unknown): VistaFiltroPayload | null {
  const version = versionDeclarada(valor);
  if (version === null || !VERSIONES_LEGIBLES.includes(version)) return null;
  const leido = vistaFiltroPayloadSchema.safeParse(valor);
  return leido.success ? leido.data : null;
}

/**
 * La version que el documento DICE tener, sin interpretarlo. `null` si ni siquiera eso se puede
 * leer. Existe para que la interfaz pueda distinguir «guardada con un formato que este despliegue
 * no conoce» de «documento roto», sin que ninguna de las dos se aplique.
 */
export function versionDeclarada(valor: unknown): number | null {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return null;
  const v: unknown = (valor as Record<string, unknown>).v;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// Los schemas del BORDE (design §5). Todos `.strict()`, y en NINGUNO existe `usuarioId`.
// ════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ R3 — EL DUEÑO SALE DE LA SESION Y NO PUEDE VIAJAR EN LA ENTRADA. `.strict()` no es cosmetico:
 * hace que un `usuarioId` inyectado sea un `validation_error` RUIDOSO en vez de un campo que se
 * ignora en silencio. Misma regla, y por el mismo motivo, que `lib/types/push.ts`.
 */
export const listarVistasFiltroSchema = z.object({ superficie: superficieVistaSchema }).strict();

export const guardarVistaFiltroSchema = z
  .object({
    superficie: superficieVistaSchema,
    nombre: z.string().max(NOMBRE_TOPE_DE_CORDURA),
    filtro: vistaFiltroPayloadSchema,
  })
  .strict();

export const renombrarVistaFiltroSchema = z
  .object({ id: z.uuid(), nombre: z.string().max(NOMBRE_TOPE_DE_CORDURA) })
  .strict();

export const actualizarVistaFiltroSchema = z
  .object({ id: z.uuid(), filtro: vistaFiltroPayloadSchema })
  .strict();

export const eliminarVistaFiltroSchema = z.object({ id: z.uuid() }).strict();

// ════════════════════════════════════════════════════════════════════════════════════════════
// Lo que sale
// ════════════════════════════════════════════════════════════════════════════════════════════

export interface VistaFiltroDTO {
  id: string;
  nombre: string;
  superficie: SuperficieVista;
  /** Ya parseado y validado. `null` = el documento guardado NO es legible (R8). */
  filtro: VistaFiltroPayload | null;
  actualizadaEn: string;
}

/**
 * R13 — el tope, con SU NUMERO y el que ya se tiene. No cabe en `ActionError` (que no lleva
 * carga), y sin los dos numeros el aviso seria «no puedes guardar mas», que no dice cuantas hay ni
 * cual es el limite.
 *
 * NOMBRE: `limite_excedido` es el termino que ya usan diez modulos de `lib/types/` para esto; el
 * diseño lo escribio como `limit_reached` y se traduce aqui a la palabra que el repo ya habla.
 */
export type VistaFiltroError =
  | ActionError
  | { status: "limite_excedido"; maximo: number; actuales: number };

export type ListarVistasFiltroResult =
  | { status: "ok"; vistas: VistaFiltroDTO[] }
  | VistaFiltroError;
export type VistaFiltroResult = { status: "ok"; vista: VistaFiltroDTO } | VistaFiltroError;
export type EliminarVistaFiltroResult = { status: "ok" } | VistaFiltroError;

// ════════════════════════════════════════════════════════════════════════════════════════════
// Los mensajes de las reglas de nombre y de contenido (R9, R10, R11, R12)
//
// Viven aqui —y no dentro del servicio— porque los escribe el servidor y los lee la pantalla, y
// porque cada uno tiene que DECIR el numero: «demasiado largo» sin el maximo obliga a probar a
// ciegas. Un test que los comparase con estas mismas funciones estaria verde siempre, asi que los
// tests afirman sobre lo que el mensaje tiene que CONTENER (el numero), no sobre la cadena entera.
// ════════════════════════════════════════════════════════════════════════════════════════════

export const MSG_VISTA = {
  nombreVacio: "Ponle un nombre a la vista.",
  nombreLargo: `El nombre no puede pasar de ${NOMBRE_VISTA_MAX} caracteres.`,
  filtroVacio: "No hay filtros puestos: pon alguno antes de guardar la vista.",
  nombreEnUso: (nombre: string) => `Ya tienes una vista llamada «${nombre}» en esta pantalla.`,
} as const;
