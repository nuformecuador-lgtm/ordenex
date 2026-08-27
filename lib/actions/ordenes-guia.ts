"use server";

import {
  asignarBodegaSchema,
  asignarRecoleccionSchema,
  desasignarRecoleccionSchema,
  generarGuiaSchema,
  rutearSateliteSchema,
  type AsignarBodegaResult,
  type AsignarRecoleccionResult,
  type GenerarGuiaResult,
  type ListarMensajerosParaAsignacionResult,
  type RutearSateliteResult,
} from "@/lib/types/orden-guia";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IGuiaAsignacionService } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { AsignabilidadCoordenadasService } from "@/lib/services/AsignabilidadCoordenadasService";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";

function buildGuiaService(): IGuiaAsignacionService {
  const prisma = getPrismaClient();
  const ordenRepo = new OrdenRepository(prisma);
  // Feature 30/R18: inyecta ademas ZonaRepository (guardia GAM); firmas estables.
  // Feature 92/R8: + el gate de asignabilidad por coordenadas, que lee la cola de jobs.
  return new GuiaAsignacionService(
    ordenRepo,
    new ZonaRepository(prisma),
    new AsignabilidadCoordenadasService(new JobRepository(prisma)),
    // 💰 FEATURE 276 (R18): EL CABLEADO DE LA PUERTA DEL TOPE. Es el MISMO servicio de historial
    // —y por tanto el MISMO criterio unico de la 215— que consultan el panel del mensajero, la
    // pestaña de ayuda y los dos crons. La dependencia es OBLIGATORIA en el constructor: borrar
    // esta linea rompe el typecheck, no deja la puerta abierta en silencio.
    new OrdenHistorialService(
      ordenRepo,
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
  );
}

function buildOrdenRepo(): Pick<
  IOrdenRepository,
  | "findMensajerosByZona"
  | "findMensajerosConOrdenesEn" // feature 157: regla de dedicación
  | "findMensajerosBloqueadosPorCierres" // feature 271/R32: los que el servidor va a rechazar
  | "findMensajerosNoAsignablesPorEstado" // 2026-08-26: inactivo/bloqueado no recibe trabajo
> {
  return new OrdenRepository(getPrismaClient());
}

function buildZonaRepoParaMensajeros(): Pick<IZonaRepository, "findCentralZonaId"> {
  return new ZonaRepository(getPrismaClient());
}

export interface GuiaActionDeps {
  guiaService?: IGuiaAsignacionService;
  getActor?: () => Promise<Actor | null>;
}

export interface ListarMensajerosDeps {
  ordenRepo?: Pick<
    IOrdenRepository,
    | "findMensajerosByZona"
    | "findMensajerosConOrdenesEn" // feature 157: regla de dedicación
    | "findMensajerosBloqueadosPorCierres" // feature 271/R32: los que el servidor va a rechazar
  | "findMensajerosNoAsignablesPorEstado" // 2026-08-26: inactivo/bloqueado no recibe trabajo
  >;
  zonaRepo?: Pick<IZonaRepository, "findCentralZonaId">;
  getActor?: () => Promise<Actor | null>;
}


// Traduce el AppErrorShape que puede producir este borde: solo ZodError
// (VALIDATION_ERROR) o falta de sesion (UNAUTHORIZED, R14). `forbidden` y
// `conflict` los devuelve el service directamente como resultado de dominio
// (nunca como excepcion), por eso NO aparecen aqui.
function toGuiaActionError(
  shape: AppErrorShape,
): { status: "validation_error"; fieldErrors: Record<string, string[]> } | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      // FORBIDDEN/NOT_FOUND/CONFLICT/INTERNAL: este borde nunca los lanza como
      // AppError; si algo desconocido llega aqui, se propaga como fallo real.
      throw new Error(`ordenes-guia: AppErrorCode inesperado ${shape.code}`);
  }
}

/** R11-R14/R18-R25/R27-R29: genera guia y transiciona el lote (solo maestro). */
export async function generarGuia(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<GenerarGuiaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R14: antes de tocar el service
    const data = generarGuiaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.guiaService ?? buildGuiaService();
    return service.generarGuia(data, actor); // resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/** R26-R29: asigna mensajero a ordenes en_bodega_central (solo maestro). */
export async function asignarDesdeBodega(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<AsignarBodegaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = asignarBodegaSchema.parse(input);
    const service = deps.guiaService ?? buildGuiaService();
    return service.asignarDesdeBodega(data, actor);
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/**
 * Feature 157 (R3-R9): asigna el mensajero que ira a la tienda a RECOLECTAR el lote. NO
 * transiciona (la orden sigue en `por_recolectar_en_tienda` hasta que el mensajero confirme):
 * escribe solo `mensajero_asignado_id`. Solo acceso total.
 */
export async function asignarRecoleccion(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<AsignarRecoleccionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = asignarRecoleccionSchema.parse(input);
    const service = deps.guiaService ?? buildGuiaService();
    return service.asignarRecoleccion(data, actor);
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/**
 * Feature 157 (ampliacion): "Quitar mensajero" de una recolección asignada. La devuelve a
 * `por_recolectar_en_tienda` y sin mensajero, para poder asignarla a otro. Solo acceso total.
 */
export async function desasignarRecoleccion(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<AsignarRecoleccionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = desasignarRecoleccionSchema.parse(input);
    const service = deps.guiaService ?? buildGuiaService();
    return service.desasignarRecoleccion(data, actor);
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

/**
 * Feature 30/R5/R18: SOLO los usuarios rol mensajero de la zona GAM (firma y tipo
 * `MensajeroLiteDTO[]` intactos respecto a la feature 17). Resuelve `centralZonaId` y
 * filtra por zona en el repo; si aun no hay zona GAM configurada -> lista vacia
 * (la UI ya maneja lista vacia; la escritura falla con R4 en el service, mensaje
 * claro). `maestro` escribe y `admin` es solo-lectura (R16); ambos pueden listar
 * mensajeros para el modal. El resto -> forbidden.
 */
export async function listarMensajerosParaAsignacion(
  deps: ListarMensajerosDeps = {},
): Promise<ListarMensajerosParaAsignacionResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    if (actor.rol !== "maestro" && actor.rol !== "admin") {
      return { status: "forbidden" as const };
    }
    const zonaRepo = deps.zonaRepo ?? buildZonaRepoParaMensajeros();
    const centralZonaId = await zonaRepo.findCentralZonaId();
    if (centralZonaId === null) {
      // R5: sin zona GAM configurada, no hay mensajeros GAM que listar.
      return { status: "ok" as const, mensajeros: [] };
    }
    const repo = deps.ordenRepo ?? buildOrdenRepo();
    const mensajeros = await repo.findMensajerosByZona(centralZonaId);
    const ids = mensajeros.map((m) => m.id);
    // FEATURE 271 (T4.4, R32) — `bloqueadosIds` VUELVE A VIAJAR, y se aplica a los DOS modales.
    //
    // Entre el 2026-08-18 y el 2026-08-23 no se calculaba: la regla 2 de la 241 decia que asignar no
    // se bloquea por cierres, y un dato que nadie debe usar es una trampa. Resuelta Q1, el dato
    // vuelve a ser exactamente lo que el servidor va a rechazar en `asignarDesdeBodega` (T4.1) y en
    // `asignarRecoleccion` (T4.3) — ni uno mas, ni uno menos.
    //
    // SE LLAMA `bloqueadosIds` Y NO `bloqueadosParaRepartoIds`: ya no hay dos respuestas. Un nombre
    // que califica el alcance invita a preguntarse cual es el otro alcance, y aqui no lo hay.
    //
    // ⚠️ Y ESTA MISMA ACCION ALIMENTA UN TERCER CONSUMIDOR QUE **NO** DEBE USARLO:
    // `FiltrosEntregas.tsx` la llama como FILTRO del listado (R33). Filtrar no es asignar — un
    // mensajero bloqueado sigue teniendo ordenes en la mano que alguien necesita buscar, y
    // esconderlo del filtro las volveria inalcanzables.
    // Feature 157 (regla de dedicación): repartir y recolectar son viajes incompatibles.
    // Se marcan las DOS caras para que cada modal deshabilite la suya y el maestro vea el
    // motivo en vez de toparse con un rechazo del servidor al confirmar.
    //
    // ⚠️ Feature 235: la primera lista es el GEMELO DE INTERFAZ de `ESTADOS_REPARTO_PENDIENTE`
    // (`GuiaAsignacionService`). Las dos tienen que decir lo mismo o el selector deja elegir a un
    // mensajero al que el servidor va a rechazar — que es el «rechazo al confirmar» que este
    // marcador existe para evitar. `ayuda_tienda` entra en las dos: el paquete sigue con él (R1).
    // La guardia `carga-del-mensajero.guardia.test.ts` cruza las dos y falla si divergen.
    const [conReparto, conRecoleccion, bloqueados, noAsignables] = await Promise.all([
      repo.findMensajerosConOrdenesEn(ids, ["por_recoger", "en_reparto", "ayuda_tienda"]),
      repo.findMensajerosConOrdenesEn(ids, ["por_recolectar_en_tienda"]),
      repo.findMensajerosBloqueadosPorCierres(ids), // feature 271/R32
      // Pedido humano 2026-08-26: los dados de baja. MISMO predicado que las tres escrituras
      // rechazan (`findMensajerosNoAsignablesPorEstado`), sin re-derivarlo aqui.
      //
      // NOTA (2026-08-27, pregunta humana «¿esto consulta todos los mensajeros?»): NO. `ids` ya
      // esta acotado a los mensajeros de la zona GAM que devolvio `findMensajerosByZona`, y el
      // repo hace `WHERE id IN (ids) AND estado IN (...)`: viaja solo el subconjunto inasignable.
      // Lo que SI es redundante es la ida en si: es una SEGUNDA lectura de `usuario` para una
      // columna (`estado`) que la primera pudo traer —`findMensajerosByZona` selecciona solo
      // `id, nombre`—. Corre en el `Promise.all`, asi que no suma latencia serial. Se deja asi a
      // proposito: el metodo del repo lo comparten las escrituras (`GuiaAsignacionService`,
      // `AsignacionSateliteService`) pasando UN id, y esa es la garantia de que selector y
      // escritura no discrepen. Optimizarlo = anadir `estado` al select de `findMensajerosByZona`
      // y derivar el Set en memoria contra `ESTADOS_USUARIO_NO_ASIGNABLES`; cambia la forma de
      // `MensajeroLiteRow`/`MensajeroLiteDTO`, asi que es una feature con spec, no un retoque.
      repo.findMensajerosNoAsignablesPorEstado(ids),
    ]);
    return {
      status: "ok" as const,
      mensajeros,
      conRepartoIds: [...conReparto],
      conRecoleccionIds: [...conRecoleccion],
      bloqueadosIds: [...bloqueados],
      noAsignablesIds: [...noAsignables],
    };
  });
  // Este borde solo puede lanzar UnauthenticatedError (no hay zod aqui): el
  // unico AppErrorShape posible es UNAUTHORIZED.
  return isAppErrorShape(r) ? { status: "unauthenticated" as const } : r;
}

/** Feature 30/R13/R16: rutea ordenes no-GAM a en_ruta_bodega_satelite (solo maestro). */
export async function rutearABodegaSatelite(
  input: unknown,
  deps: GuiaActionDeps = {},
): Promise<RutearSateliteResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // R16: antes de tocar el service
    const data = rutearSateliteSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.guiaService ?? buildGuiaService();
    return service.rutearABodegaSatelite(data, actor); // resultado tipado de dominio
  });
  return isAppErrorShape(r) ? toGuiaActionError(r) : r;
}

// BORRADO 2026-08-07 (chore de deuda de superficie, decision humana): aqui vivia
// `listarCatalogoEstatus` (soporte R15/R16, feature 17), el loader de solo lectura del catalogo
// `order_status`. Es la SEGUNDA VICTIMA del commit `54757be4` (2026-07-31), el mismo que dejo a
// `rutearABodegaSatelite` sin boton y causo el incidente de produccion. Ese commit borro
// `OrdenesRevisionMaestro.tsx`, que era su UNICO consumidor (la importaba y la llamaba). Aquel
// borrado dejo dos cosas colgando y solo se reparo una; esto cierra la otra.
//
// NO es capacidad perdida: la sustituta viva es `listarOrderStatus`
// (`lib/actions/order-status.ts`), montada desde `ordenes/_components/OrdenesListado.tsx`, con
// autorizacion MAS AMPLIA (todos menos mensajero, frente a solo maestro/admin) y mejor probada.
// `IOrdenRepository.listOrderStatus()` NO se toca: lo sigue usando esa sustituta.

// Pedido humano 2026-08-18 — AQUI VIVIA `listarZonasBloqueadasPorCierre`, el loader del gate de
// seleccion del maestro: devolvia las zonas con >=1 mensajero con cierre abierto para que el
// checkbox de esas ordenes saliera deshabilitado. Se elimina con la regla que servia: los cierres
// dejaron de bloquear la asignacion, asi que no queda nadie a quien informar. Se borra en vez de
// anotarse `@sin-superficie` porque no hay un motivo real para conservarla — si algun dia vuelve
// el aviso, vuelve con su consumidor.
