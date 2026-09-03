import type { RolValue } from "@prisma/client";

import { ROLES_HISTORIAL_ACCIONES } from "@/lib/auth/menu-visibility";
import { descargaConfig } from "@/lib/config/descarga";
import type {
  FilaHistorialAccion,
  FiltroHistorialAccionResuelto,
  IHistorialAccionRepository,
  OrdenHistorialAccion,
} from "@/lib/interfaces/repositories/IHistorialAccionRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IHistorialAccionService } from "@/lib/interfaces/services/IHistorialAccionService";
import {
  ACCION_LABELS,
  CATEGORIA_POR_ACCION,
  accionesDeCategoria,
  filtroHistorialAccionSchema,
  type CatalogoActoresHistorialResult,
  type FiltroHistorialAccion,
  type HistorialAccionDTO,
  type HistorialAccionTipo,
  type ListarHistorialAccionesCompletoResult,
  type ListarHistorialAccionesResult,
} from "@/lib/types/historial-accion";
import { inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";

// FICHA 362 (design §4.1) — servicio de LECTURA del historial de acciones.
//
// AQUI VIVE LA AUTORIZACION, y solo aqui. Se compara contra `ROLES_HISTORIAL_ACCIONES` —la MISMA
// constante que consumen el `roles` del subitem de menu y el gate `notFound()` de la ruta—, de
// modo que las tres capas no pueden divergir. Un rol que no esta en esa lista recibe `forbidden` y
// EL REPOSITORIO NO SE LLAMA: el test lo afirma con `not.toHaveBeenCalled()`, que es lo que
// distingue «no ve nada» de «consulta y luego filtra» (R18).
//
// LO QUE ESTE SERVICIO NO HACE, y es deliberado:
//  - NO escribe NADA (R2/R21). No hay un solo camino desde aqui hasta un `update`: el repositorio
//    que recibe no declara ninguno.
//  - NO acota el conjunto por actor ni por zona. Este modulo lo lee el `maestro`, que lo ve todo;
//    no hay recorte por rol que aplicar, y por eso la descarga y la pantalla comparten conjunto
//    sin ninguna clausula extra (R33).
//  - NO deriva la categoria al leer una fila desde la base: la deriva del TIPO con
//    `CATEGORIA_POR_ACCION` (R17), que es un mapa puro y exhaustivo.

/**
 * `ROLES_HISTORIAL_ACCIONES` es una tupla de literales y su `.includes` solo acepta esos
 * literales. Se ensancha el tipo del ARRAY (nunca el de `actor.rol`) en este unico punto, igual
 * que hacen la analitica, el historico de conversaciones y `/mi-wallet`.
 */
const ROLES_CON_ACCESO: readonly RolValue[] = ROLES_HISTORIAL_ACCIONES;

/** El primer problema del borde, en texto corto y SIN ecoar el valor recibido. */
function motivoDe(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const primero = error.issues[0];
  if (primero === undefined) return "Entrada invalida";
  const ruta = primero.path.map(String).join(".");
  return ruta === "" ? primero.message : `${ruta}: ${primero.message}`;
}

/**
 * `categoria` -> `accion IN (…)`, e INTERSECCION con `accion` cuando llegan las dos (design §4.2).
 *
 * `null` = sin filtro de tipo. Una lista VACIA no es lo mismo: significa «los tipos pedidos y la
 * categoria pedida no tienen nada en comun», y el `where` devuelve cero filas, que es la respuesta
 * correcta. Colapsar el vacio a «sin filtro» enseñaria el conjunto ENTERO a quien pidio una
 * combinacion imposible, que es el fallo mudo que R31 persigue en su propio terreno.
 */
export function resolverTiposDelFiltro(
  filtro: Pick<FiltroHistorialAccion, "accion" | "categoria">,
): readonly HistorialAccionTipo[] | null {
  const porCategoria =
    filtro.categoria === undefined
      ? null
      : [...new Set(filtro.categoria.flatMap((c) => accionesDeCategoria(c)))];
  const porTipo = filtro.accion === undefined ? null : [...filtro.accion];

  if (porCategoria === null) return porTipo;
  if (porTipo === null) return porCategoria;
  const enCategoria = new Set(porCategoria);
  return porTipo.filter((tipo) => enCategoria.has(tipo));
}

/**
 * `Decimal` -> STRING de escala 2 y el resto de la proyeccion.
 *
 * ⚠️ `.toFixed(2)` ES DEL PROPIO `Decimal`: NO pasa por coma flotante. Ni un `Number(`, ni un
 * `parseFloat(`, ni una suma sobre el importe en todo este archivo (R6). Un `Number(fila.monto)`
 * aqui es la mutacion que la guardia money-safe caza.
 */
export function aDTO(fila: FilaHistorialAccion): HistorialAccionDTO {
  return {
    id: fila.id,
    fecha: fila.createdAt.toISOString(),
    accion: fila.accion,
    accionLabel: ACCION_LABELS[fila.accion],
    // R17: DERIVADA, no leida de una columna. La tabla no tiene `categoria` a proposito.
    categoria: CATEGORIA_POR_ACCION[fila.accion],
    entidadTipo: fila.entidadTipo,
    entidadEtiqueta: fila.entidadEtiqueta,
    // R3/R36: el nombre y el rol CONGELADOS de la fila, jamas resueltos contra el usuario vivo.
    // `null` = el sistema, y la pantalla lo pinta como tal.
    actorNombre: fila.actorNombre,
    actorRol: fila.actorRol,
    monto: fila.monto === null ? null : fila.monto.toFixed(2),
    valorAnterior: fila.valorAnterior,
    valorNuevo: fila.valorNuevo,
    loteId: fila.loteId,
  };
}

export class HistorialAccionService implements IHistorialAccionService {
  constructor(private readonly repo: IHistorialAccionRepository) {}

  /** El gate, en un solo sitio. `true` = puede leer. */
  private puedeLeer(actor: Actor | null): actor is Actor {
    return actor !== null && ROLES_CON_ACCESO.includes(actor.rol);
  }

  /**
   * Traduce la entrada YA VALIDADA a lo que el repositorio entiende: la interseccion de tipos y el
   * rango de fechas convertido de CALENDARIO de Costa Rica a instantes.
   */
  private resolverFiltro(filtro: FiltroHistorialAccion): FiltroHistorialAccionResuelto {
    return {
      q: filtro.q ?? null,
      actorId: filtro.actorId ?? null,
      accion: resolverTiposDelFiltro(filtro),
      entidadTipo: filtro.entidadTipo ?? null,
      // `desde` incluye el dia entero; `hasta` es el INICIO DEL DIA SIGUIENTE y el repositorio lo
      // compara con `lt`. Es la convencion del repo (feature 166) y evita perder las filas
      // escritas entre las 00:00 y las 23:59:59.999 del ultimo dia pedido.
      desde: filtro.desde === undefined ? null : inicioDelDiaCREnUtc(filtro.desde),
      hasta: filtro.hasta === undefined ? null : inicioDelDiaSiguienteCREnUtc(filtro.hasta),
    };
  }

  private ordenDe(filtro: FiltroHistorialAccion): OrdenHistorialAccion {
    return { sortBy: filtro.sortBy, sortDir: filtro.sortDir };
  }

  async listar(input: unknown, actor: Actor | null): Promise<ListarHistorialAccionesResult> {
    if (actor === null) return { status: "unauthenticated" };
    // ⚠️ EL GATE VA ANTES DE LA PRIMERA LECTURA (R18). Ni siquiera se valida la entrada: un
    // `validation_error` que solo reciben los roles autorizados es un oraculo menos.
    if (!ROLES_CON_ACCESO.includes(actor.rol)) return { status: "forbidden" };

    // R15/R26/R32: entrada invalida -> `validation_error` SIN ejecutar consulta. `input ?? {}`
    // porque «sin filtros, primera pagina, mas reciente primero» es una entrada VALIDA y se
    // expresa no mandando nada.
    const parsed = filtroHistorialAccionSchema.safeParse(input ?? {});
    if (!parsed.success) return { status: "validation_error", motivo: motivoDe(parsed.error) };

    const filtro = parsed.data;
    const pagina = await this.repo.list({
      filtro: this.resolverFiltro(filtro),
      orden: this.ordenDe(filtro),
      page: filtro.page,
      pageSize: filtro.pageSize,
    });

    // R22: el recorte lo hizo la BASE. Lo que vuelve son `pageSize` filas y un `total` del
    // conjunto entero; el navegador no selecciona, no ordena y no recorta nada.
    return {
      status: "ok",
      items: pagina.items.map(aDTO),
      page: filtro.page,
      pageSize: filtro.pageSize,
      total: pagina.total,
    };
  }

  async listarCompleto(
    input: unknown,
    actor: Actor | null,
  ): Promise<ListarHistorialAccionesCompletoResult> {
    if (actor === null) return { status: "unauthenticated" };
    // R33: EL MISMO gate que la pantalla, en la MISMA posicion. Ninguna fila que el actor no pueda
    // ver en pantalla puede aparecer en el archivo, y la forma de garantizarlo no es un filtro
    // extra: es que el rol denegado no llegue nunca a la consulta.
    if (!ROLES_CON_ACCESO.includes(actor.rol)) return { status: "forbidden" };

    const parsed = filtroHistorialAccionSchema.safeParse(input ?? {});
    if (!parsed.success) return { status: "validation_error", motivo: motivoDe(parsed.error) };

    const filtro = parsed.data;
    const maximo = descargaConfig.MAX_FILAS;
    // Se piden `maximo + 1` para poder DISTINGUIR «cabe justo» de «se paso»: con `take: maximo` un
    // conjunto de exactamente `maximo + 1` filas saldria truncado y en silencio, que es lo que
    // R21 de la 151 prohibe.
    const filas = await this.repo.listAll({
      filtro: this.resolverFiltro(filtro),
      orden: this.ordenDe(filtro),
      limite: maximo + 1,
    });
    if (filas.length > maximo) return { status: "limite_excedido", maximo };

    // R30: MISMO `where` y MISMO `orderBy` que la pantalla — los construye el repositorio una sola
    // vez para los dos caminos, asi que no pueden divergir.
    return { status: "ok", items: filas.map(aDTO) };
  }

  async obtenerCatalogoActores(actor: Actor | null): Promise<CatalogoActoresHistorialResult> {
    if (actor === null) return { status: "unauthenticated" };
    if (!ROLES_CON_ACCESO.includes(actor.rol)) return { status: "forbidden" };
    return { status: "ok", actores: await this.repo.listarActores() };
  }
}
