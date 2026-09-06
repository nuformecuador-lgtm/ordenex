import { z } from "zod";

// FICHA 374 (design §5.1) — EL VOCABULARIO, LOS SCHEMAS DEL BORDE Y LOS DTO DEL ARBOL.
//
// POR QUE ESTE MODULO EXISTE Y NO VIVE DENTRO DE `lib/actions/geografia.ts`, que es donde el
// `design.md` los dibuja: aquel archivo lleva `"use server"`, y un modulo de Server Actions SOLO
// puede exportar funciones asincronas. Un `export const NIVELES_GEOGRAFICOS` ahi dentro no
// compila. Es exactamente el reparto que ya usa el precedente de vehiculos —`lib/types/vehiculos.ts`
// tiene el schema y `lib/actions/vehiculos.ts` la accion—, asi que el molde se sigue igual.
//
// Modulo PURO: solo zod. Sin Prisma, sin React, sin `lib/services`.

/**
 * El vocabulario CERRADO del nivel. Se usa igual en el schema del borde, en el service y en el
 * repositorio: el nivel viaja como DATO en vez de multiplicar
 * `crearProvincia`/`crearCanton`/`crearDistrito` x `activar`/`desactivar`, que serian seis cuerpos
 * identicos y cinco sitios donde olvidar la comprobacion de rol (design §9, A6).
 */
export const NIVELES_GEOGRAFICOS = ["provincia", "canton", "distrito"] as const;
export type NivelGeografico = (typeof NIVELES_GEOGRAFICOS)[number];

/** Etiqueta legible del nivel, para los mensajes de la pantalla. */
export const NIVEL_LABELS: Record<NivelGeografico, string> = {
  provincia: "Provincia",
  canton: "Cantón",
  distrito: "Distrito",
};

/** El nivel del PADRE de cada nivel; `null` para provincia, que no tiene. */
export const NIVEL_PADRE: Record<NivelGeografico, NivelGeografico | null> = {
  provincia: null,
  canton: "provincia",
  distrito: "canton",
};

// Cotas del nombre. Minimo para que no entre un caracter accidental; maximo porque la columna es
// TEXT sin tope propio y un pegado accidental entraria entero.
export const GEO_NOMBRE_MIN = 2;
export const GEO_NOMBRE_MAX = 80;

/**
 * Normaliza el nombre PARA GUARDARLO: recorta y colapsa los espacios internos (R16).
 *
 * ⚠️ NO baja a minusculas y NO quita acentos, y esa es la diferencia con `normalizeName`. Lo que
 * se PERSISTE es el nombre tal y como lo escribio la persona —«San José», con su mayuscula y su
 * acento—, porque es lo que se lee en toda la app y lo que dice la DTA del IGN. La forma plegada
 * de `normalizeName` se usa para COMPARAR (R17), nunca para guardar. Son dos cosas distintas y
 * confundirlas escribiria «san jose» en el catalogo.
 */
export function normalizarNombreGeografico(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

const nombreGeoSchema = z
  .string()
  .transform(normalizarNombreGeografico)
  .pipe(
    z
      .string()
      .min(GEO_NOMBRE_MIN, `El nombre debe tener al menos ${GEO_NOMBRE_MIN} caracteres.`)
      .max(GEO_NOMBRE_MAX, `El nombre no puede superar los ${GEO_NOMBRE_MAX} caracteres.`),
  );

/**
 * El alta, como union DISCRIMINADA por el nivel (R25).
 *
 * La discriminada mantiene el borde igual de estricto que seis acciones separadas: un `cantonId`
 * en un alta de provincia es `validation_error`, NO un campo ignorado en silencio. `.strict()` no
 * es decorativo: una clave desconocida se rechaza, no se descarta.
 */
export const crearNodoGeograficoSchema = z.discriminatedUnion("nivel", [
  z.object({ nivel: z.literal("provincia"), nombre: nombreGeoSchema }).strict(),
  z
    .object({
      nivel: z.literal("canton"),
      nombre: nombreGeoSchema,
      provinciaId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      nivel: z.literal("distrito"),
      nombre: nombreGeoSchema,
      cantonId: z.string().min(1),
    })
    .strict(),
]);

export type CrearNodoGeograficoInput = z.infer<typeof crearNodoGeograficoSchema>;

/** El cambio de activacion. `activo` es el estado DESEADO, no un toggle: pedir dos veces lo mismo
 * tiene que ser idempotente (R21) y un toggle no puede serlo. */
export const cambiarActivacionGeograficaSchema = z
  .object({
    nivel: z.enum(NIVELES_GEOGRAFICOS),
    id: z.string().min(1),
    activo: z.boolean(),
  })
  .strict();

export type CambiarActivacionGeograficaInput = z.infer<typeof cambiarActivacionGeograficaSchema>;

/**
 * FICHA 375 — el RENOMBRADO. Mismo `{nivel, id}` que el resto, mas el nombre nuevo.
 *
 * REUSA `nombreGeoSchema`, el MISMO del alta, a proposito: recorta, colapsa espacios y exige las
 * mismas cotas. Un segundo esquema de nombre seria un segundo contrato capaz de admitir por
 * renombrado lo que el alta rechaza —y al reves—, y la base tiene UN solo `@@unique` para los dos
 * caminos. `.strict()` no es decorativo: una clave desconocida se rechaza, no se descarta.
 */
export const renombrarNodoGeograficoSchema = z
  .object({
    nivel: z.enum(NIVELES_GEOGRAFICOS),
    id: z.string().min(1),
    nombre: nombreGeoSchema,
  })
  .strict();

export type RenombrarNodoGeograficoInput = z.infer<typeof renombrarNodoGeograficoSchema>;

/** Un nodo, sin mas: lo que necesita el conteo de la confirmacion (R60). */
export const nodoGeograficoSchema = z
  .object({ nivel: z.enum(NIVELES_GEOGRAFICOS), id: z.string().min(1) })
  .strict();

export type NodoGeograficoInput = z.infer<typeof nodoGeograficoSchema>;

/** El padre que exige el alta de cada nivel; `null` cuando el nivel no lleva padre. */
export function padreDeAlta(input: CrearNodoGeograficoInput): string | null {
  if (input.nivel === "canton") return input.provinciaId;
  if (input.nivel === "distrito") return input.cantonId;
  return null;
}

// ── Los DTO del arbol ────────────────────────────────────────────────────────────────────────
//
// VIVEN AQUI Y NO EN LA SERVER ACTION porque desde la ficha 374 los produce `GeoRepository`, y un
// repositorio no puede importar un modulo `"use server"`. `lib/actions/geografia.ts` los
// RE-EXPORTA como tipos para que ningun consumidor actual tenga que cambiar su import.

export interface DistritoArbolDTO {
  id: string;
  nombre: string;
  /**
   * La zona UTILIZABLE del distrito, o `null`.
   *
   * ⚠️ FICHA 374 — CAMBIO DE COMPORTAMIENTO DELIBERADO. Antes esto era «la primera zona»
   * (`zonas: { take: 1 }`), asi que un distrito en DOS zonas se pintaba «(zona: X)» aunque la
   * carga masiva lo rechace por ambiguo. Esa etiqueta MENTIA. Ahora se aplica el MISMO colapso
   * 1/0/>1 de `_shared/zona-colapso.ts`: `null` con 0 zonas y tambien con mas de una.
   */
  zonaId: string | null;
  zonaNombre: string | null;
  /**
   * Marca de zona especial. La columna es `BOOLEAN NULL` (null = nadie lo decidio todavia), pero
   * hacia la UI se normaliza a dos valores con la unica lectura correcta: `zona_especial IS TRUE`.
   */
  zonaEspecial: boolean;
  /** FICHA 374: el flag PROPIO de esta fila. La disponibilidad efectiva la deriva quien lee, con
   * `estaDisponible`, mirando a sus ascendientes en este mismo arbol. */
  activo: boolean;
}

export interface CantonArbolDTO {
  id: string;
  nombre: string;
  /** FICHA 374: el flag PROPIO de este canton. */
  activo: boolean;
  distritos: DistritoArbolDTO[];
}

export interface ProvinciaArbolDTO {
  id: string;
  nombre: string;
  /** FICHA 374: el flag PROPIO de esta provincia. */
  activo: boolean;
  cantones: CantonArbolDTO[];
}
