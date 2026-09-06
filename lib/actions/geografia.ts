"use server";

import { z } from "zod";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { GeoRepository } from "@/lib/repositories/GeoRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GeografiaService } from "@/lib/services/GeografiaService";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type {
  CambiarActivacionGeograficaServiceResult,
  ContarOrdenesSinEntregarServiceResult,
  CrearNodoGeograficoServiceResult,
  IGeografiaService,
  ListarArbolGeograficoServiceResult,
  RenombrarNodoGeograficoServiceResult,
} from "@/lib/interfaces/services/IGeografiaService";
import {
  cambiarActivacionGeograficaSchema,
  crearNodoGeograficoSchema,
  nodoGeograficoSchema,
  renombrarNodoGeograficoSchema,
} from "@/lib/types/geografia-nodo";

// Catalogo geografico global (provincia -> canton -> distrito).
//
// ⚠️ FICHA 374 — YA NO ES DE SOLO LECTURA. La cabecera anterior decia, con todas sus letras, que
// «el catalogo en si es de solo lectura» y que por eso se toleraba el Prisma directo. Esa premisa
// muere con la primera escritura: desde esta ficha el catalogo se administra desde la app, asi que
// la lectura del arbol tambien pasa por la cadena de siempre —Server Action -> `GeografiaService`
// -> `GeoRepository`— y este archivo deja de tocar Prisma para eso.
//
// ⚠️ LA UNICA EXCEPCION QUE QUEDA, Y SE DECLARA EN VEZ DE ESCONDERSE:
// `actualizarDistritosEspeciales`, al final del archivo, sigue yendo contra Prisma directo. Es una
// escritura VIVA del flujo de Tarifas, ya probada, que no pertenece a esta ficha; moverla no le da
// nada a la 374 y si pone en riesgo algo que funciona. Queda fuera de alcance a proposito.
//
// ⚠️ NO HAY NINGUNA ACCION DE BORRADO (R5): quitar un nodo es DESACTIVARLO. Ver el porque en
// `lib/interfaces/repositories/IGeoRepository.ts`.
//
// ⚠️ FICHA 375 — EL RENOMBRADO YA EXISTE (`renombrarNodoGeografico`), y solo porque el catalogo
// gano una clave estable (`codigo_dta`). Mientras el nombre hacia de clave, renombrar duplicaba el
// nodo en la siguiente corrida de `scripts/seed-zonas.ts`.

// Los DTO del arbol viven en `lib/types/geografia-nodo.ts` desde la ficha 374 —los produce
// `GeoRepository`, y un repositorio no puede importar un modulo `"use server"`—. Se RE-EXPORTAN
// aqui para que ningun consumidor tenga que cambiar su import.
export type {
  CantonArbolDTO,
  DistritoArbolDTO,
  ProvinciaArbolDTO,
} from "@/lib/types/geografia-nodo";

/**
 * Dependencias inyectables del borde (patron `VehiculoActionDeps`). Existen para poder probar las
 * cuatro acciones SIN base y sin sesion, no para cambiar el comportamiento en produccion.
 */
export interface GeografiaActionDeps {
  geografiaService?: IGeografiaService;
  getActor?: () => Promise<Actor | null>;
}

/**
 * EL COMPOSITION ROOT. Es el UNICO sitio del sistema que construye el servicio, y por tanto el
 * unico que le pasa sus DOS repositorios.
 *
 * ⚠️ EL SEGUNDO ARGUMENTO NO ES DECORATIVO: sin `OrdenRepository`, el conteo de ordenes sin
 * entregar de R60 reventaria en la primera confirmacion de desactivar, en produccion y no en
 * ningun test —los tests de servicio inyectan sus propios dobles—. Comprobar que el modulo lo
 * IMPORTA no basta; hay que comprobar que alguien lo PASA, y eso lo fija
 * `tests/unit/actions/geografia.composition-root.test.ts`.
 */
function buildGeografiaService(): IGeografiaService {
  const prisma = getPrismaClient();
  return new GeografiaService(new GeoRepository(prisma), new OrdenRepository(prisma));
}

/** Traduce el ZodError del borde a `validation_error` con los errores por campo. */
function errorDeValidacion(error: z.ZodError): {
  status: "validation_error";
  fieldErrors: Record<string, string[]>;
} {
  return {
    status: "validation_error",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

// ── Lectura del arbol ────────────────────────────────────────────────────────────────────────

export type ArbolGeograficoResult =
  | ListarArbolGeograficoServiceResult
  | { status: "unauthenticated" };

/**
 * Devuelve el arbol geografico COMPLETO —activos e inactivos— ordenado alfabeticamente en cada
 * nivel. Autoriza solo al rol `maestro` (misma puerta que /configuracion).
 *
 * CONSERVA SU FIRMA: lo llaman `app/(app)/configuracion/tarifas/page.tsx` y
 * `ZonasTarifasModule.tsx` sin argumentos, y siguen compilando. `deps` es opcional y solo sirve
 * para probarlo sin base.
 */
export async function listarArbolGeografico(
  deps: GeografiaActionDeps = {},
): Promise<ArbolGeograficoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };
  const service = deps.geografiaService ?? buildGeografiaService();
  return service.listarArbol(actor);
}

// ── Alta ─────────────────────────────────────────────────────────────────────────────────────

export type CrearNodoGeograficoResult =
  | CrearNodoGeograficoServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/**
 * Alta de una provincia, un canton o un distrito (solo `maestro`).
 *
 * UNA accion para los tres niveles, no tres: el nivel viaja como dato de un vocabulario cerrado y
 * la `discriminatedUnion` mantiene el borde igual de estricto. Tres cuerpos identicos serian dos
 * sitios mas donde olvidar la comprobacion de rol.
 */
export async function crearNodoGeografico(
  input: unknown,
  deps: GeografiaActionDeps = {},
): Promise<CrearNodoGeograficoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" }; // R23

  const parsed = crearNodoGeograficoSchema.safeParse(input);
  if (!parsed.success) return errorDeValidacion(parsed.error); // R25

  const service = deps.geografiaService ?? buildGeografiaService();
  try {
    return await service.crear(parsed.data, actor);
  } catch {
    // R18 — El UNIQUE de la base es la ultima palabra: si dos altas simultaneas pasan la
    // comprobacion del service, una de las dos falla aqui y se cuenta como conflict en vez de
    // escapar como error crudo de Postgres.
    return { status: "conflict" };
  }
}

// ── Activacion ───────────────────────────────────────────────────────────────────────────────

export type CambiarActivacionGeograficaResult =
  | CambiarActivacionGeograficaServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/**
 * Desactiva o reactiva un nodo del catalogo (solo `maestro`).
 *
 * `activo` es el estado DESEADO, no un toggle: pedir el estado en el que el nodo ya esta devuelve
 * `ok` sin escribir nada (R21). Esta escritura NO toca a ningun descendiente (R8) ni a
 * `zona_distrito` (R50).
 */
export async function cambiarActivacionGeografica(
  input: unknown,
  deps: GeografiaActionDeps = {},
): Promise<CambiarActivacionGeograficaResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsed = cambiarActivacionGeograficaSchema.safeParse(input);
  if (!parsed.success) return errorDeValidacion(parsed.error);

  const service = deps.geografiaService ?? buildGeografiaService();
  return service.cambiarActivacion(parsed.data, actor);
}

// ── Renombrado (ficha 375) ───────────────────────────────────────────────────────────────────

export type RenombrarNodoGeograficoResult =
  | RenombrarNodoGeograficoServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/**
 * FICHA 375 — cambia el NOMBRE de un nodo del catalogo (solo `maestro`).
 *
 * POR QUE ESTA ACCION NO EXISTIA HASTA HOY, y no era una omision: la ficha 374 la dejo fuera porque
 * `scripts/seed-zonas.ts` resolvia la geografia por NOMBRE y creaba lo que no encontraba, asi que
 * renombrar habria hecho que la siguiente corrida del seed creara un duplicado ACTIVO con el nombre
 * viejo — y a partir de ahi toda carga masiva que lo mencionara moriria con «distrito ambiguo en el
 * canton». Lo que lo desbloquea es `codigo_dta`: con una clave estable el seed cruza por codigo y
 * el nombre pasa a ser una etiqueta mutable.
 *
 * Renombrar a SU PROPIO nombre devuelve `ok` —guardar sin cambios tiene que seguir funcionando—;
 * al de un HERMANO devuelve `conflict`.
 */
export async function renombrarNodoGeografico(
  input: unknown,
  deps: GeografiaActionDeps = {},
): Promise<RenombrarNodoGeograficoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsed = renombrarNodoGeograficoSchema.safeParse(input);
  if (!parsed.success) return errorDeValidacion(parsed.error);

  const service = deps.geografiaService ?? buildGeografiaService();
  try {
    return await service.renombrar(parsed.data, actor);
  } catch {
    // El UNIQUE de la base es la ultima palabra: si dos renombrados simultaneos pasan la
    // comprobacion del service, uno de los dos falla aqui y se cuenta como conflict en vez de
    // escapar como error crudo de Postgres. Mismo `catch` que el alta.
    return { status: "conflict" };
  }
}

// ── El dato de la confirmacion (R60) ─────────────────────────────────────────────────────────

export type ContarOrdenesSinEntregarDeNodoResult =
  | ContarOrdenesSinEntregarServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/**
 * SOLO LECTURA: cuantas ordenes sin entregar cuelgan del nodo. Alimenta la confirmacion de
 * desactivar y NUNCA escribe.
 *
 * Es informacion para decidir, no una condicion de la operacion: si esta llamada falla, la
 * pantalla lo dice y NO bloquea (R62). Un conteo caido que impidiera retirar un distrito
 * convertiria un dato de cortesia en un bloqueo.
 */
export async function contarOrdenesSinEntregarDeNodo(
  input: unknown,
  deps: GeografiaActionDeps = {},
): Promise<ContarOrdenesSinEntregarDeNodoResult> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "unauthenticated" };

  const parsed = nodoGeograficoSchema.safeParse(input);
  if (!parsed.success) return errorDeValidacion(parsed.error);

  const service = deps.geografiaService ?? buildGeografiaService();
  return service.contarOrdenesSinEntregar(parsed.data, actor);
}

// ── Marca de zona especial ─────────────────────────────────────────────────
//
// ⚠️ FICHA 374: ESTA ACCION NO SE TOCA, y queda declarado por que. Va contra Prisma directo desde
// la ficha que la creo; es una escritura VIVA del flujo de Tarifas, ya probada, y no pertenece al
// alcance de la 374. Moverla a la cadena de capas no le da nada a esta ficha y si arriesga algo
// que funciona. Cuando le toque su ficha, se mueve entera.

const distritosEspecialesSchema = z.object({
  /** Distritos que pasan a `zona_especial = true`. */
  marcar: z.array(z.string().min(1)).default([]),
  /** Distritos que pasan a `zona_especial = false`. */
  desmarcar: z.array(z.string().min(1)).default([]),
});

export type ActualizarDistritosEspecialesResult =
  | { status: "ok"; actualizados: number }
  | { status: "validation_error" }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

/**
 * Escribe la marca `distrito.zona_especial` de un lote de distritos. Recibe el
 * DELTA (lo que cambio en el formulario), no el estado completo: asi dos zonas
 * abiertas a la vez no se pisan la marca de los distritos que ninguna toco.
 *
 * La marca es del distrito, de modo que al guardarla queda visible desde
 * CUALQUIER zona que lo contenga; el llamador refresca el arbol para verlo.
 * Misma puerta que el resto de /configuracion: solo `maestro`.
 */
export async function actualizarDistritosEspeciales(
  input: unknown,
): Promise<ActualizarDistritosEspecialesResult> {
  const actor = await resolveActorFromSession();
  if (!actor) return { status: "unauthenticated" };
  if (actor.rol !== "maestro") return { status: "forbidden" };

  const parsed = distritosEspecialesSchema.safeParse(input);
  if (!parsed.success) return { status: "validation_error" };

  const { marcar, desmarcar } = parsed.data;
  // Un id en las dos listas seria una orden contradictoria: se rechaza en vez
  // de dejar que gane la ultima escritura.
  const enAmbas = marcar.filter((id) => desmarcar.includes(id));
  if (enAmbas.length > 0) return { status: "validation_error" };
  if (marcar.length === 0 && desmarcar.length === 0) {
    return { status: "ok", actualizados: 0 };
  }

  const prisma = getPrismaClient();
  // Una sola transaccion: o quedan las dos mitades del cambio, o ninguna.
  const [on, off] = await prisma.$transaction([
    prisma.distrito.updateMany({
      where: { id: { in: marcar } },
      data: { zonaEspecial: true },
    }),
    prisma.distrito.updateMany({
      where: { id: { in: desmarcar } },
      data: { zonaEspecial: false },
    }),
  ]);

  return { status: "ok", actualizados: on.count + off.count };
}
