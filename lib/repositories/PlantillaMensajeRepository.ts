import type { PlantillaEstado, PrismaClient } from "@prisma/client";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import {
  PlantillaDuplicadaError,
  type CreatePlantillaData,
  type CrearDesdeMetaData,
  type IPlantillaMensajeRepository,
  type ListPlantillasParams,
  type ListPlantillasResult,
  type PlantillaBienvenida,
  type PlantillaEnviable,
  type PlantillaListItem,
  type PlantillaPublica,
  type PlantillaTextoEnviable,
  type SetTemplateData,
  type SincronizarTemplateData,
  type UpdatePlantillaData,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

type PlantillaPrismaClient = Pick<PrismaClient, "plantillaMensaje" | "$transaction">;

const PUBLIC_SELECT = {
  id: true,
  nombre: true,
  cuerpo: true,
  variables: true,
  variablesNombres: true, // feature 282: snapshot `clave -> nombre` (presentacion)
  estado: true,
  welcomeMessage: true, // mensaje de bienvenida (como mucho una vigente en `true`)
  templateId: true,
  templateIdioma: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

const LIST_SELECT = {
  id: true,
  nombre: true,
  cuerpo: true,
  estado: true,
  variables: true,
  variablesNombres: true, // feature 282: el listado tambien pinta etiquetas legibles
  welcomeMessage: true, // el listado RESALTA la plantilla de bienvenida
  templateId: true,
  createdAt: true,
} as const;

// R28: filtro base de vigentes; TODAS las lecturas y mutaciones lo aplican.
const VIGENTE = { deletedAt: null } as const;

/**
 * Feature 282 — el `JsonValue` de Prisma normalizado a `clave -> nombre`. Cualquier cosa que no
 * sea un objeto plano de strings (null, texto, array, valores no-string) cae a `{}`: es
 * PRESENTACION, y una fila rara no puede reventar el listado. Sin `any` a proposito: la entrada
 * se declara `unknown` y se estrecha comprobando, que es lo unico que hace el lector defensivo.
 *
 * Exportada para poder afirmarlo directamente en test (T13); no forma parte del contrato del
 * repositorio.
 */
export function leerVariablesNombres(valor: unknown): Record<string, string> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return {};
  const salida: Record<string, string> = {};
  for (const [clave, nombre] of Object.entries(valor as Record<string, unknown>)) {
    // Un solo valor no-string invalida el snapshot entero: media etiqueta es peor que ninguna,
    // porque el fallback al catalogo (R21) si sabe pintar algo coherente.
    if (typeof nombre !== "string") return {};
    salida[clave] = nombre;
  }
  return salida;
}

/** Fila cruda tal como la devuelve Prisma: el snapshot llega como `JsonValue`, no tipado. */
type FilaConSnapshot<T> = Omit<T, "variablesNombres"> & { variablesNombres: unknown };

function aPlantillaPublica(row: FilaConSnapshot<PlantillaPublica>): PlantillaPublica {
  return { ...row, variablesNombres: leerVariablesNombres(row.variablesNombres) };
}

function aPlantillaListItem(row: FilaConSnapshot<PlantillaListItem>): PlantillaListItem {
  return { ...row, variablesNombres: leerVariablesNombres(row.variablesNombres) };
}

export class PlantillaMensajeRepository implements IPlantillaMensajeRepository {
  constructor(private readonly prisma: PlantillaPrismaClient) {}

  async create(data: CreatePlantillaData): Promise<PlantillaPublica> {
    try {
      const row = await this.prisma.plantillaMensaje.create({
        data: {
          nombre: data.nombre,
          cuerpo: data.cuerpo,
          variables: data.variables,
          // Feature 282 (R17): el snapshot lo sella el service con el catalogo vigente. Si no
          // llega, la columna se queda en su default `{}` y la UI cae al catalogo (R21).
          ...(data.variablesNombres !== undefined
            ? { variablesNombres: data.variablesNombres }
            : {}),
          createdBy: data.createdBy,
          // El estado inicial lo DICE el service (hoy `saved_not_aprobation`), no el default
          // de la columna: ver `CreatePlantillaData.estado`.
          estado: data.estado,
        },
        select: PUBLIC_SELECT,
      });
      return aPlantillaPublica(row);
    } catch (error) {
      throw mapDuplicadoError(error);
    }
  }

  async list(params: ListPlantillasParams): Promise<ListPlantillasResult> {
    const [rows, total] = await Promise.all([
      this.prisma.plantillaMensaje.findMany({
        where: VIGENTE, // R28
        select: LIST_SELECT,
        orderBy: { createdAt: "desc" }, // R6: orden determinista
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.plantillaMensaje.count({ where: VIGENTE }),
    ]);
    const items: PlantillaListItem[] = rows.map(aPlantillaListItem);
    return { items, total };
  }

  async count(): Promise<number> {
    return this.prisma.plantillaMensaje.count({ where: VIGENTE }); // R28
  }

  async findById(id: string): Promise<PlantillaPublica | null> {
    const row = await this.prisma.plantillaMensaje.findFirst({
      where: { id, ...VIGENTE }, // R28
      select: PUBLIC_SELECT,
    });
    return row === null ? null : aPlantillaPublica(row);
  }

  async findByNombre(nombre: string): Promise<PlantillaPublica | null> {
    const row = await this.prisma.plantillaMensaje.findFirst({
      where: { nombre, ...VIGENTE }, // R28
      select: PUBLIC_SELECT,
    });
    return row === null ? null : aPlantillaPublica(row);
  }

  async update(id: string, data: UpdatePlantillaData): Promise<PlantillaPublica | null> {
    try {
      const result = await this.prisma.plantillaMensaje.updateMany({
        where: { id, ...VIGENTE }, // R28: no toca borradas
        data: {
          ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
          ...(data.cuerpo !== undefined ? { cuerpo: data.cuerpo } : {}),
          ...(data.variables !== undefined ? { variables: data.variables } : {}),
          // Feature 282 (R17): solo se reescribe si el service lo manda, que es cuando cambio
          // el cuerpo. Un update de solo `nombre` deja el snapshot anterior intacto.
          ...(data.variablesNombres !== undefined
            ? { variablesNombres: data.variablesNombres }
            : {}),
        },
      });
      if (result.count === 0) return null; // R21
    } catch (error) {
      throw mapDuplicadoError(error);
    }
    const row = await this.prisma.plantillaMensaje.findFirst({
      where: { id, ...VIGENTE },
      select: PUBLIC_SELECT,
    });
    return row === null ? null : aPlantillaPublica(row);
  }

  async updateEstado(id: string, estado: PlantillaEstado): Promise<PlantillaPublica | null> {
    const result = await this.prisma.plantillaMensaje.updateMany({
      where: { id, ...VIGENTE }, // R26/R28
      data: { estado },
    });
    if (result.count === 0) return null; // R26
    const row = await this.prisma.plantillaMensaje.findFirst({
      where: { id, ...VIGENTE },
      select: PUBLIC_SELECT,
    });
    return row === null ? null : aPlantillaPublica(row);
  }

  /**
   * Mueve la marca de bienvenida a `id`. Las dos escrituras van en UNA transaccion porque el
   * estado intermedio —ninguna plantilla marcada— no puede quedar visible ni sobrevivir a un
   * fallo: si el `set` de la segunda reventara despues de un `clear` ya confirmado, el negocio
   * se quedaria sin mensaje de bienvenida sin que nadie lo pidiera.
   *
   * El orden CLEAR -> SET es obligatorio: el UNIQUE parcial de la base no admite dos filas
   * vigentes en `true` ni por un instante dentro de la transaccion.
   */
  async marcarWelcomeMessage(id: string): Promise<PlantillaPublica | null> {
    const [, marcada] = await this.prisma.$transaction([
      this.prisma.plantillaMensaje.updateMany({
        // Sin `VIGENTE`: si una plantilla BORRADA se quedo con el flag puesto, este es el
        // momento de limpiarlo. Excluir `id` evita reescribir la fila que se va a marcar.
        where: { welcomeMessage: true, NOT: { id } },
        data: { welcomeMessage: false },
      }),
      this.prisma.plantillaMensaje.updateMany({
        where: { id, ...VIGENTE }, // no se marca una borrada
        data: { welcomeMessage: true },
      }),
    ]);
    if (marcada.count === 0) return null; // no existe o esta soft-deleted
    const row = await this.prisma.plantillaMensaje.findFirst({
      where: { id, ...VIGENTE },
      select: PUBLIC_SELECT,
    });
    return row === null ? null : aPlantillaPublica(row);
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.prisma.plantillaMensaje.updateMany({
      where: { id, ...VIGENTE }, // R29: ya borrada -> count 0
      data: { deletedAt: new Date() }, // R27: soft delete, no borra la fila
    });
    return result.count > 0;
  }

  // --- Integracion WhatsApp ---

  async setTemplate(id: string, data: SetTemplateData): Promise<void> {
    await this.prisma.plantillaMensaje.updateMany({
      where: { id, ...VIGENTE },
      data: { templateId: data.templateId, templateIdioma: data.idioma },
    });
  }

  async sincronizarTemplatePorNombre(
    nombre: string,
    data: SincronizarTemplateData,
  ): Promise<boolean> {
    // El id/idioma del template SIEMPRE se refresca desde Meta.
    const result = await this.prisma.plantillaMensaje.updateMany({
      where: { nombre, ...VIGENTE },
      data: { templateId: data.templateId, templateIdioma: data.idioma },
    });
    if (result.count === 0) return false; // no habia plantilla local con ese nombre

    // El estado de Meta manda SALVO un `inactivo` puesto por el usuario: la desactivacion
    // local (controla si el mensajero puede enviarla) no se revierte desde Meta.
    await this.prisma.plantillaMensaje.updateMany({
      where: { nombre, ...VIGENTE, NOT: { estado: "inactivo" } },
      data: { estado: data.estado },
    });
    return true;
  }

  async listarEnviables(): Promise<PlantillaEnviable[]> {
    const rows = await this.prisma.plantillaMensaje.findMany({
      where: { ...VIGENTE, estado: "activo", NOT: { templateId: null } },
      select: {
        id: true,
        nombre: true,
        cuerpo: true,
        variables: true,
        templateId: true,
        templateIdioma: true,
      },
      orderBy: { nombre: "asc" },
    });
    // El WHERE garantiza templateId no nulo; templateIdioma podria faltar si Meta no lo dio
    // (defensivo): se cae al idioma configurado por defecto en el service de envio.
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      cuerpo: r.cuerpo,
      variables: r.variables,
      templateId: r.templateId as string,
      templateIdioma: r.templateIdioma ?? "",
    }));
  }

  async crearDesdeMeta(data: CrearDesdeMetaData): Promise<boolean> {
    try {
      await this.prisma.plantillaMensaje.create({
        data: {
          nombre: data.nombre,
          cuerpo: data.cuerpo,
          variables: data.variables,
          estado: data.estado, // importada: refleja el status de Meta (mapeado)
          templateId: data.templateId,
          templateIdioma: data.idioma,
          // createdBy queda null: la origino la sincronizacion, no un usuario.
          // `variablesNombres` queda en su default `{}` A PROPOSITO (feature 282): una
          // plantilla IMPORTADA desde Meta nunca paso por el catalogo, asi que no hay snapshot
          // que sellar. La UI derivara los nombres del catalogo al pintarla (R21).
        },
      });
      return true;
    } catch (error) {
      // Nombre ya en uso (incluye borradas: el indice unico las cuenta). No se resucita.
      if (mapDuplicadoError(error) instanceof PlantillaDuplicadaError) return false;
      throw error;
    }
  }

  async listarUsablesParaTexto(): Promise<PlantillaTextoEnviable[]> {
    return this.prisma.plantillaMensaje.findMany({
      // `saved_not_aprobation` queda FUERA junto a `inactivo` (2026-08-26): una plantilla
      // guardada sin aprobacion es un borrador, y un borrador no se le ofrece al mensajero ni
      // por el camino wa.me, que no depende de Meta pero si del texto que el negocio dio por
      // bueno. `pending` SI sigue apareciendo: esa ya se envio y su texto es definitivo.
      where: { ...VIGENTE, estado: { notIn: ["inactivo", "saved_not_aprobation"] } },
      select: { id: true, nombre: true, cuerpo: true, variables: true },
      orderBy: { nombre: "asc" },
    });
  }

  async findWelcomeMessage(): Promise<PlantillaBienvenida | null> {
    // SOLO `welcomeMessage` + vigente. Sin filtro de `estado` ni de `templateId`: quien llama
    // necesita DISTINGUIR «no hay bienvenida configurada» de «la hay pero no se puede enviar»,
    // y con un filtro estricto las dos serian `null`. El detalle esta en `PlantillaBienvenida`.
    const r = await this.prisma.plantillaMensaje.findFirst({
      where: { ...VIGENTE, welcomeMessage: true },
      select: { id: true, nombre: true, templateId: true, estado: true },
    });
    return r === null
      ? null
      : { id: r.id, nombre: r.nombre, templateId: r.templateId, estado: r.estado };
  }

  async findEnviableById(id: string): Promise<PlantillaEnviable | null> {
    const r = await this.prisma.plantillaMensaje.findFirst({
      where: { id, ...VIGENTE, estado: "activo", NOT: { templateId: null } },
      select: {
        id: true,
        nombre: true,
        cuerpo: true,
        variables: true,
        templateId: true,
        templateIdioma: true,
      },
    });
    if (r === null) return null;
    return {
      id: r.id,
      nombre: r.nombre,
      cuerpo: r.cuerpo,
      variables: r.variables,
      templateId: r.templateId as string,
      templateIdioma: r.templateIdioma ?? "",
    };
  }
}

/**
 * R10: traduce la violacion de unicidad de Postgres a un error de dominio. La constraint
 * real `plantilla_mensaje_nombre_key` contiene el substring "nombre".
 */
function mapDuplicadoError(error: unknown): unknown {
  const texto = textoConstraintP2002(error);
  if (texto && texto.includes("nombre")) return new PlantillaDuplicadaError("nombre");
  return error;
}
