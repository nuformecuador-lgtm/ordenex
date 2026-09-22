import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CreacionVista,
  EscrituraVista,
  IVistaFiltroRepository,
  VistaFiltroFila,
} from "@/lib/interfaces/repositories/IVistaFiltroRepository";
import type { VistaFiltroPayload } from "@/lib/types/vista-filtro";
import { esP2002 } from "@/lib/repositories/_shared/prisma-unique";

// FICHA 453 (design §6, T1.5) — repositorio de LAS VISTAS DE FILTROS. SOLO queries Prisma
// (docs/architecture.md): ni una regla de negocio, ni un reloj, ni una decision de permiso.
//
// ⚠️ EL DUEÑO VA EN EL `WHERE` DE CADA ESCRITURA, NO EN UNA COMPROBACION PREVIA (R2). Por eso las
// tres escrituras usan `updateMany`/`deleteMany` con `{ id, usuarioId }` en vez de `update` por id:
// asi la propiedad la aplica LA CONSULTA, y el numero de filas afectadas es la prueba. Con un
// `findFirst` delante y un `update` por `id` a secas, la version de alguien con prisa —o el
// siguiente metodo que se copie de este— escribiria sobre la vista de otra persona.

/** Lo minimo del cliente Prisma que este repositorio consume (patron `UsuarioPreferenciaRepository`). */
type VistaFiltroPrismaClient = Pick<PrismaClient, "vistaFiltro">;

/** Las columnas que salen. `created_at` no sale: nada de la ficha la lee. */
const SELECT = {
  id: true,
  usuarioId: true,
  superficie: true,
  nombre: true,
  filtro: true,
  version: true,
  updatedAt: true,
} as const;

interface FilaPrisma {
  id: string;
  usuarioId: string;
  superficie: string;
  nombre: string;
  filtro: Prisma.JsonValue;
  version: number;
  updatedAt: Date;
}

function aFila(fila: FilaPrisma): VistaFiltroFila {
  return {
    id: fila.id,
    usuarioId: fila.usuarioId,
    superficie: fila.superficie,
    nombre: fila.nombre,
    // Sale CRUDO y tipado como `unknown`: interpretarlo aqui seria meter la regla de legibilidad
    // (R8) en la capa de datos, y quien lo reciba dejaria de estar obligado a validarlo.
    filtro: fila.filtro,
    version: fila.version,
    actualizadaEn: fila.updatedAt,
  };
}

/** El documento, en la forma que Prisma acepta para una columna JSONB. */
function aJson(filtro: VistaFiltroPayload): Prisma.InputJsonValue {
  return filtro as unknown as Prisma.InputJsonValue;
}

export class VistaFiltroRepository implements IVistaFiltroRepository {
  constructor(private readonly prisma: VistaFiltroPrismaClient) {}

  /**
   * La unica consulta caliente de la ficha. `WHERE usuario_id = ? AND superficie = ? ORDER BY
   * nombre` es prefijo EXACTO del indice unico, asi que el orden sale gratis y no hace falta ningun
   * indice mas.
   */
  async listar(usuarioId: string, superficie: string): Promise<VistaFiltroFila[]> {
    const filas = await this.prisma.vistaFiltro.findMany({
      where: { usuarioId, superficie },
      orderBy: { nombre: "asc" },
      select: SELECT,
    });
    return filas.map(aFila);
  }

  async contar(usuarioId: string, superficie: string): Promise<number> {
    return this.prisma.vistaFiltro.count({ where: { usuarioId, superficie } });
  }

  /**
   * R11 — el nombre duplicado lo decide EL INDICE UNICO. No hay `SELECT` previo aqui a proposito:
   * entre una lectura y una escritura cabe otra pestaña entera, y el `P2002` es la unica forma de
   * que dos guardados simultaneos del mismo nombre no dejen dos filas.
   */
  async crear(
    usuarioId: string,
    superficie: string,
    nombre: string,
    filtro: VistaFiltroPayload,
    version: number,
  ): Promise<CreacionVista> {
    try {
      const fila = await this.prisma.vistaFiltro.create({
        data: { usuarioId, superficie, nombre, filtro: aJson(filtro), version },
        select: SELECT,
      });
      return { estado: "creada", fila: aFila(fila) };
    } catch (error) {
      if (esP2002(error)) return { estado: "nombre_en_uso" };
      throw error;
    }
  }

  /**
   * R14 — renombrar. El `WHERE` lleva el dueño: renombrar la vista de otra persona afecta a CERO
   * filas y devuelve `sin_coincidencia`, sin decir si ese id existe.
   */
  async renombrar(id: string, usuarioId: string, nombre: string): Promise<EscrituraVista> {
    try {
      const { count } = await this.prisma.vistaFiltro.updateMany({
        where: { id, usuarioId },
        data: { nombre },
      });
      if (count === 0) return { estado: "sin_coincidencia" };
      return this.leerTrasEscribir(id, usuarioId);
    } catch (error) {
      if (esP2002(error)) return { estado: "nombre_en_uso" };
      throw error;
    }
  }

  /**
   * R15 — reemplaza el documento y CONSERVA el nombre (no aparece en `data`). El `WHERE` lleva el
   * dueño por el mismo motivo que arriba.
   */
  async actualizarFiltro(
    id: string,
    usuarioId: string,
    filtro: VistaFiltroPayload,
    version: number,
  ): Promise<EscrituraVista> {
    const { count } = await this.prisma.vistaFiltro.updateMany({
      where: { id, usuarioId },
      data: { filtro: aJson(filtro), version },
    });
    if (count === 0) return { estado: "sin_coincidencia" };
    return this.leerTrasEscribir(id, usuarioId);
  }

  /** Filas borradas. `0` = no era suya (o no existia); el `WHERE` es el que lo decide. */
  async eliminar(id: string, usuarioId: string): Promise<number> {
    const { count } = await this.prisma.vistaFiltro.deleteMany({ where: { id, usuarioId } });
    return count;
  }

  /**
   * La fila recien escrita, releida POR EL MISMO `WHERE` (id + dueño).
   *
   * Hace falta porque `updateMany` devuelve un conteo y no la fila, y la pantalla necesita la vista
   * actualizada —con su `updated_at` nuevo— para repintarse sin recargar la lista entera. Releer
   * con el dueño puesto, y no solo por `id`, mantiene la propiedad tambien en la lectura.
   */
  private async leerTrasEscribir(id: string, usuarioId: string): Promise<EscrituraVista> {
    const fila = await this.prisma.vistaFiltro.findFirst({
      where: { id, usuarioId },
      select: SELECT,
    });
    return fila === null
      ? { estado: "sin_coincidencia" }
      : { estado: "actualizada", fila: aFila(fila) };
  }
}
