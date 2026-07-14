import { Prisma, type PrismaClient } from "@prisma/client";
import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
import type { OrdenDTO, OrdenListItemDTO, OrdenListItemRelaciones } from "@/lib/types/orden";
import type { TarifaDTO } from "@/lib/types/tarifa";
import type { ResumenCargaOrdenDTO } from "@/lib/types/asignacion-mensajero";
import type {
  CambioEstadoEntrada,
  HistorialContexto,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import {
  NumRemisionDuplicadoError,
  type CantonRow,
  type CreateOrdenData,
  type DistritoRow,
  type EtiquetaRow,
  type GenerarGuiaDecisionData,
  type GenerarGuiaResultRow,
  type GeoExistence,
  type IOrdenRepository,
  type ListOrdenesParams,
  type ListOrdenesResult,
  type MensajeroLiteRow,
  type OrdenTransicionRow,
  type OrderStatusLiteRow,
  type ProvinciaRow,
  type RecepcionSateliteRow,
  type UpdateOrdenData,
} from "@/lib/interfaces/repositories/IOrdenRepository";

type OrdenPrismaClient = Pick<
  PrismaClient,
  | "orden"
  | "orderStatus"
  | "zona"
  | "provincia"
  | "canton"
  | "distrito"
  | "usuario"
  | "cierreDia" // feature 41: bloqueo derivado del mensajero / bodega (R12/R17)
  | "cierreBodega" // feature 41: causa (ii) del bloqueo de bodega (R17)
  | "$transaction" // feature 17: generarGuiaLote necesita transaccion (R25)
  | "$executeRaw" // feature 41/R23: anti-TOCTOU (NOT EXISTS cierre bloqueante en el lote)
>;

// Feature 41 (R12/R16/R17): estados de cierre que BLOQUEAN. `rechazado`/`aprobado` NO
// bloquean (dinero conciliado o descartado). Fuente de verdad en lib/types/cierre.ts.
const ESTADOS_CIERRE_BLOQUEANTES: CierreEstado[] = ["solicitado", "vencido"];
const DESTINO_BODEGA_SATELITE: CierreDestinoTipo = "bodega_satelite";
const ESTADO_CIERRE_BODEGA_PENDIENTE: CierreEstado = "solicitado";

// Feature 17/R3: nombre CONSTANTE de la secuencia (nunca interpolar entrada de
// usuario en el SQL crudo). Es la misma secuencia que el SERIAL de la feature 6
// creo y que esta migracion desliga con `OWNED BY NONE`.
const NUM_GUIA_SEQUENCE = "orden_num_guia_seq";

// Feature 33/R11/R18: estado de ORIGEN de la recepcion en satelite. La escritura
// guardada (`recibirEnSatelite`) solo transiciona una orden que sigue en este
// estado (guardia por estado de origen en el propio UPDATE, patron feature 17/36).
const ORIGEN_RECEPCION_SATELITE = "en_ruta_bodega_satelite";

// Mapa columna de negocio -> columna Prisma para el orden (lista blanca R31).
const SORT_COLUMN: Record<string, "createdAt" | "numGuia" | "numRemision"> = {
  created_at: "createdAt",
  num_guia: "numGuia",
  num_remision: "numRemision",
};

// Fila de orden con el `value` del estatus incluido (para OrdenDTO.estatusValue).
type OrdenRow = Prisma.OrdenGetPayload<{
  include: { estatus: { select: { value: true } } };
}>;

const WITH_ESTATUS = {
  include: { estatus: { select: { value: true } } },
} as const;

// El LISTADO trae, en el MISMO query (via joins de Prisma `include`), los datos
// de TODAS las relaciones DIRECTAS (FK) de la orden: estatus, tienda, zona,
// provincia, canton, distrito, mensajeroSugerido y mensajeroAsignado. La relacion
// `tienda` (Orden.tienda -> Usuario) trae ademas su tarifa ACTIVA (Usuario.
// tarifasTienda, 1:N por-tienda; se acota a `status: 'activo'`, no borrada,
// `take: 1`). NO requiere migracion: son includes sobre relaciones ya existentes.
// Seleccion explicita de campos: NUNCA se traen columnas sensibles del usuario
// (passwordHash, etc.) ni `deletedAt` de las tarifas.
const TARIFA_SELECT = {
  id: true,
  tiendaId: true,
  status: true,
  valorFlete: true,
  valorFleteDevuelto: true,
  valorFleteGam: true,
  valorFleteDevueltoGam: true,
  fulfillment: true,
  comisionCod: true,
  ivaFlete: true,
  ivaComisionCod: true,
  createdAt: true,
  updatedAt: true,
} as const;

const WITH_ESTATUS_Y_TIENDA = {
  include: {
    estatus: { select: { id: true, value: true } },
    tienda: {
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        // Tarifa ACTIVA de la tienda (a lo sumo una, `take: 1`), excluyendo
        // borradas e inactivas.
        tarifasTienda: {
          where: { status: "activo", deletedAt: null },
          select: TARIFA_SELECT,
          take: 1,
        },
      },
    },
    zona: { select: { id: true, nombre: true, esCentral: true } },
    provincia: { select: { id: true, nombre: true } },
    canton: { select: { id: true, nombre: true } },
    distrito: { select: { id: true, nombre: true } },
    mensajeroSugerido: { select: { id: true, nombre: true } },
    mensajeroAsignado: { select: { id: true, nombre: true } },
  },
} as const;

// Fila de orden del listado con todas las relaciones directas resueltas.
type OrdenListRow = Prisma.OrdenGetPayload<typeof WITH_ESTATUS_Y_TIENDA>;

// Serializa la fila de Prisma a OrdenDTO: peso Decimal -> number (o null,
// feature 15/R4), nunca expone deletedAt (R42/N3).
function toDTO(row: OrdenRow): OrdenDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusId: row.estatusId,
    estatusValue: row.estatus?.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    tiendaId: row.tiendaId,
    zonaId: row.zonaId,
    provinciaId: row.provinciaId,
    cantonId: row.cantonId,
    distritoId: row.distritoId,
    producto: row.producto,
    peso: row.peso ? row.peso.toNumber() : null,
    notas: row.notas,
    mensajeroAsignadoId: row.mensajeroAsignadoId, // feature 49/R27: autoriza al mensajero asignado
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Serializa una tarifa anidada de la tienda: Decimal -> number en las 8 columnas
// numericas (patron TarifaRepository). No expone `deletedAt` (ya filtrado en el
// include).
function toTarifaDTO(t: OrdenListRow["tienda"]["tarifasTienda"][number]): TarifaDTO {
  return {
    id: t.id,
    tiendaId: t.tiendaId,
    status: t.status,
    valorFlete: t.valorFlete.toNumber(),
    valorFleteDevuelto: t.valorFleteDevuelto.toNumber(),
    valorFleteGam: t.valorFleteGam.toNumber(),
    valorFleteDevueltoGam: t.valorFleteDevueltoGam.toNumber(),
    fulfillment: t.fulfillment.toNumber(),
    comisionCod: t.comisionCod.toNumber(),
    ivaFlete: t.ivaFlete.toNumber(),
    ivaComisionCod: t.ivaComisionCod.toNumber(),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// Arma el bloque `relaciones` con los datos de las relaciones directas (FK) de la
// orden, resueltas por el include del listado. `tienda` incluye su tarifa activa.
function toRelaciones(row: OrdenListRow): OrdenListItemRelaciones {
  return {
    estatus: row.estatus ? { id: row.estatus.id, value: row.estatus.value } : null,
    tienda: row.tienda
      ? {
          id: row.tienda.id,
          nombre: row.tienda.nombre,
          email: row.tienda.email,
          telefono: row.tienda.telefono,
          // A lo sumo una tarifa activa por tienda (o null).
          tarifa: row.tienda.tarifasTienda[0] ? toTarifaDTO(row.tienda.tarifasTienda[0]) : null,
        }
      : null,
    zona: row.zona
      ? { id: row.zona.id, nombre: row.zona.nombre, esCentral: row.zona.esCentral }
      : null,
    provincia: row.provincia ? { id: row.provincia.id, nombre: row.provincia.nombre } : null,
    canton: row.canton ? { id: row.canton.id, nombre: row.canton.nombre } : null,
    distrito: row.distrito ? { id: row.distrito.id, nombre: row.distrito.nombre } : null,
    mensajeroSugerido: row.mensajeroSugerido
      ? { id: row.mensajeroSugerido.id, nombre: row.mensajeroSugerido.nombre }
      : null,
    mensajeroAsignado: row.mensajeroAsignado
      ? { id: row.mensajeroAsignado.id, nombre: row.mensajeroAsignado.nombre }
      : null,
  };
}

// R25/R26: serializa una fila del listado a OrdenListItemDTO, agregando el nombre
// legible de la tienda. Solo el listado usa este mapeo; el resto del CRUD usa toDTO.
// Feature 17/R20: agrega mensajeroSugeridoId/mensajeroAsignadoId (ya vienen en el
// row via WITH_ESTATUS_Y_TIENDA: `include` no restringe los escalares del modelo).
// Ademas expone en `relaciones` los datos de TODAS las relaciones directas (FK),
// con la tarifa activa anidada dentro de `tienda` (resueltas via joins en el listado).
function toListItemDTO(row: OrdenListRow): OrdenListItemDTO {
  return {
    ...toDTO(row),
    tiendaNombre: row.tienda.nombre,
    mensajeroSugeridoId: row.mensajeroSugeridoId,
    mensajeroAsignadoId: row.mensajeroAsignadoId,
    // Feature 30/R14/R19: nombre de zona (columna del listado) + flag GAM (la UI
    // decide por fila si muestra select de mensajero o "-> bodega satelite").
    zonaNombre: row.zona.nombre,
    zonaEsGam: row.zona.esCentral,
    // Escalares para las columnas de detalle/dinero del listado (dirección, valor
    // de cobro COD, flag de comisión). Decimal montoCobrar -> number|null.
    direccion: row.direccion,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    cobraComision: row.cobraComision,
    relaciones: toRelaciones(row),
  };
}

// Feature 16 — resumen del lote: estatus.value + mensajeroSugerido.nombre.
const WITH_RESUMEN = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    producto: true,
    montoCobrar: true,
    direccion: true,
    mensajeroSugeridoId: true,
    estatus: { select: { value: true } },
    mensajeroSugerido: { select: { nombre: true } },
  },
} as const;

type OrdenResumenRow = Prisma.OrdenGetPayload<typeof WITH_RESUMEN>;

// R6/R9: mapea Decimal montoCobrar -> number|null; NO expone deletedAt/internos.
function toResumenDTO(row: OrdenResumenRow): ResumenCargaOrdenDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    direccion: row.direccion,
    estatusValue: row.estatus?.value,
    mensajeroSugeridoId: row.mensajeroSugeridoId,
    mensajeroSugeridoNombre: row.mensajeroSugerido?.nombre ?? null,
  };
}

// Feature 32/R1 — proyeccion para la etiqueta: los datos de la orden + los
// NOMBRES (no IDs) de tienda/geografia via relaciones ya existentes (patron
// WITH_ESTATUS_Y_TIENDA). `distrito` es la unica relacion opcional (R4). No
// selecciona `deletedAt` ni internos (R6); el filtro `deletedAt: null` va en el
// `where` del findMany (R3).
const WITH_ETIQUETA = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    montoCobrar: true,
    tienda: { select: { nombre: true } },
    zona: { select: { nombre: true } },
    provincia: { select: { nombre: true } },
    canton: { select: { nombre: true } },
    distrito: { select: { nombre: true } },
  },
} as const;

type OrdenEtiquetaRow = Prisma.OrdenGetPayload<typeof WITH_ETIQUETA>;

// R1/R4/R5/R6: serializa la fila de etiqueta a EtiquetaRow. Resuelve los nombres
// legibles, mapea Decimal montoCobrar -> number|null (R5, sin moneda) y deja
// distritoNombre null si la orden no tiene distrito (R4). NO expone deletedAt (R6).
function toEtiquetaRow(row: OrdenEtiquetaRow): EtiquetaRow {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    tiendaNombre: row.tienda.nombre,
    zonaNombre: row.zona.nombre,
    provinciaNombre: row.provincia.nombre,
    cantonNombre: row.canton.nombre,
    distritoNombre: row.distrito?.nombre ?? null,
  };
}

// Feature 33/R6/R8/R9 — proyeccion del modulo de la bodega satelite: los datos de
// la orden + `estatus.value` (para partir "Por recibir"/"Recibidas") + los NOMBRES
// (no IDs) de tienda/geografia via relaciones ya existentes (patron WITH_ETIQUETA).
// `distrito` es la unica relacion opcional. No selecciona `deletedAt` ni internos;
// el filtro `deletedAt: null` va en el `where` del findMany.
const WITH_RECEPCION_SATELITE = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    montoCobrar: true,
    estatus: { select: { value: true } },
    tienda: { select: { nombre: true } },
    zona: { select: { nombre: true } },
    provincia: { select: { nombre: true } },
    canton: { select: { nombre: true } },
    distrito: { select: { nombre: true } },
  },
} as const;

type OrdenRecepcionSateliteRow = Prisma.OrdenGetPayload<typeof WITH_RECEPCION_SATELITE>;

// R6/R8/R9: serializa la fila a RecepcionSateliteRow. Resuelve los nombres
// legibles, mapea Decimal montoCobrar -> number|null y deja distritoNombre null si
// la orden no tiene distrito. NO expone deletedAt.
function toRecepcionSateliteRow(row: OrdenRecepcionSateliteRow): RecepcionSateliteRow {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatus.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    tiendaNombre: row.tienda.nombre,
    zonaNombre: row.zona.nombre,
    provinciaNombre: row.provincia.nombre,
    cantonNombre: row.canton.nombre,
    distritoNombre: row.distrito?.nombre ?? null,
  };
}

export class OrdenRepository implements IOrdenRepository {
  constructor(private readonly prisma: OrdenPrismaClient) {}

  async create(data: CreateOrdenData, historial: HistorialContexto): Promise<OrdenDTO> {
    try {
      // Feature 49/#2 (R7/R10): create + append del historial en la MISMA transaccion.
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.orden.create({
          data: {
            numRemision: data.numRemision,
            estatusId: data.estatusId,
            destinatario: data.destinatario,
            telefonoDest: data.telefonoDest,
            tiendaId: data.tiendaId,
            zonaId: data.zonaId,
            provinciaId: data.provinciaId,
            cantonId: data.cantonId,
            distritoId: data.distritoId ?? null,
            producto: data.producto,
            peso: data.peso !== null ? new Prisma.Decimal(data.peso) : null,
            notas: data.notas ?? null,
            direccion: data.direccion ?? null,
            montoCobrar: data.montoCobrar != null ? new Prisma.Decimal(data.montoCobrar) : null,
            mensajeroSugeridoId: data.mensajeroSugeridoId ?? null,
          },
          ...WITH_ESTATUS,
        });
        // R10/R20: la creacion es la transicion `vacio -> estado inicial`.
        await appendCambioEstado(tx, [
          {
            ordenId: row.id,
            estatusOrigenId: null, // creacion (R1/R20)
            estatusDestinoId: data.estatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // creacion_manual
          },
        ]);
        return toDTO(row);
      });
    } catch (error) {
      throw mapCreateError(error, data.numRemision);
    }
  }

  async findById(id: string): Promise<OrdenDTO | null> {
    const row = await this.prisma.orden.findFirst({
      where: { id, deletedAt: null }, // R34: excluye borradas
      ...WITH_ESTATUS,
    });
    return row ? toDTO(row) : null;
  }

  async list(params: ListOrdenesParams): Promise<ListOrdenesResult> {
    const where: Prisma.OrdenWhereInput = {
      deletedAt: null, // R34
      ...(params.where.tiendaId ? { tiendaId: params.where.tiendaId } : {}),
      ...(params.where.estatusId ? { estatusId: params.where.estatusId } : {}),
    };
    const orderBy = { [SORT_COLUMN[params.sortBy]]: params.sortDir };

    const [items, total] = await Promise.all([
      this.prisma.orden.findMany({
        where,
        orderBy,
        skip: params.skip,
        take: params.take,
        ...WITH_ESTATUS_Y_TIENDA, // R25: incluye estatus.value + tienda.nombre
      }),
      this.prisma.orden.count({ where }),
    ]);

    return { items: items.map(toListItemDTO), total };
  }

  async update(
    id: string,
    data: UpdateOrdenData,
    historial: HistorialContexto,
  ): Promise<OrdenDTO | null> {
    // Feature 49/#11 (R7/R19): update + append (si cambia estatus) en la MISMA tx.
    return this.prisma.$transaction(async (tx) => {
      // R20: estatus de ORIGEN pre-leido dentro de la tx, SOLO si el update podria cambiarlo.
      let origenEstatusId: string | null = null;
      if (data.estatusId !== undefined) {
        const actual = await tx.orden.findFirst({
          where: { id, deletedAt: null },
          select: { estatusId: true },
        });
        origenEstatusId = actual?.estatusId ?? null;
      }
      // Solo aplica si existe y no esta borrada (R36); updateMany no lanza si 0 filas.
      const result = await tx.orden.updateMany({
        where: { id, deletedAt: null },
        data: this.toUpdateData(data),
      });
      if (result.count === 0) return null;
      // R19/R20: registra SOLO cuando el update EFECTIVAMENTE cambia el `estatus_id`
      // (nuevo != previo). Si el update no toca estatus, o lo deja igual, no deja rastro.
      if (
        data.estatusId !== undefined &&
        origenEstatusId !== null &&
        data.estatusId !== origenEstatusId
      ) {
        await appendCambioEstado(tx, [
          {
            ordenId: id,
            estatusOrigenId: origenEstatusId,
            estatusDestinoId: data.estatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // ajuste_estado
          },
        ]);
      }
      const row = await tx.orden.findFirst({
        where: { id, deletedAt: null },
        ...WITH_ESTATUS,
      });
      return row ? toDTO(row) : null;
    });
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.prisma.orden.updateMany({
      where: { id, deletedAt: null }, // R40: solo si no estaba ya borrada
      data: { deletedAt: new Date() }, // R39
    });
    return result.count > 0;
  }

  async existsEstatus(estatusId: string): Promise<boolean> {
    const found = await this.prisma.orderStatus.findUnique({ where: { id: estatusId } });
    return found !== null;
  }

  async findEstatusIdByValue(value: string): Promise<string | null> {
    const found = await this.prisma.orderStatus.findUnique({ where: { value } });
    return found?.id ?? null;
  }

  /** Feature 27/R15/R16/R17: `usuario.fulfillment` de la tienda; `false` si no resuelve. */
  async findUsuarioFulfillment(usuarioId: string): Promise<boolean> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { fulfillment: true },
    });
    return row?.fulfillment ?? false;
  }

  async existsGeo(input: {
    zonaId: string;
    provinciaId: string;
    cantonId: string;
    distritoId?: string | null;
  }): Promise<GeoExistence> {
    const [zona, provincia, canton, distrito] = await Promise.all([
      this.prisma.zona.findUnique({ where: { id: input.zonaId } }),
      this.prisma.provincia.findUnique({ where: { id: input.provinciaId } }),
      this.prisma.canton.findUnique({ where: { id: input.cantonId } }),
      input.distritoId
        ? this.prisma.distrito.findUnique({ where: { id: input.distritoId } })
        : Promise.resolve(true),
    ]);
    return {
      zona: zona !== null,
      provincia: provincia !== null,
      canton: canton !== null,
      distrito: distrito !== null,
    };
  }

  private toUpdateData(data: UpdateOrdenData): Prisma.OrdenUncheckedUpdateManyInput {
    const out: Prisma.OrdenUncheckedUpdateManyInput = {};
    if (data.estatusId !== undefined) out.estatusId = data.estatusId;
    if (data.destinatario !== undefined) out.destinatario = data.destinatario;
    if (data.telefonoDest !== undefined) out.telefonoDest = data.telefonoDest;
    if (data.tiendaId !== undefined) out.tiendaId = data.tiendaId;
    if (data.zonaId !== undefined) out.zonaId = data.zonaId;
    if (data.provinciaId !== undefined) out.provinciaId = data.provinciaId;
    if (data.cantonId !== undefined) out.cantonId = data.cantonId;
    if (data.distritoId !== undefined) out.distritoId = data.distritoId;
    if (data.producto !== undefined) out.producto = data.producto;
    if (data.peso !== undefined) {
      out.peso = data.peso !== null ? new Prisma.Decimal(data.peso) : null;
    }
    if (data.notas !== undefined) out.notas = data.notas;
    return out;
  }

  // --- Feature 15: carga masiva (metodos batch) ---

  /** R25: remision -> estatus.value de la orden existente (no borrada). */
  async findExistingRemisiones(nums: string[]): Promise<Map<string, string>> {
    if (nums.length === 0) return new Map();
    const rows = await this.prisma.orden.findMany({
      where: { numRemision: { in: nums }, deletedAt: null },
      select: { numRemision: true, estatus: { select: { value: true } } },
    });
    return new Map(rows.map((r) => [r.numRemision, r.estatus.value]));
  }

  /** R19/R21: provincias candidatas por nombre; el service resuelve jerarquia/ambiguedad. */
  async findProvinciasByNombres(nombres: string[]): Promise<ProvinciaRow[]> {
    if (nombres.length === 0) return [];
    const rows = await this.prisma.provincia.findMany({
      where: { nombre: { in: nombres, mode: "insensitive" } },
      select: { id: true, nombre: true },
    });
    return rows;
  }

  /** R19: cantones de las provincias resueltas (todo el universo, el service filtra por jerarquia). */
  async findCantonesByProvinciaIds(provinciaIds: string[]): Promise<CantonRow[]> {
    if (provinciaIds.length === 0) return [];
    const rows = await this.prisma.canton.findMany({
      where: { provinciaId: { in: provinciaIds } },
      select: { id: true, nombre: true, provinciaId: true },
    });
    return rows;
  }

  /** R19: distritos de los cantones resueltos. */
  async findDistritosByCantonIds(cantonIds: string[]): Promise<DistritoRow[]> {
    if (cantonIds.length === 0) return [];
    const rows = await this.prisma.distrito.findMany({
      where: { cantonId: { in: cantonIds } },
      // La zona del distrito vive en la N:M `zona_distrito` (feature 24): es ahi donde
      // la UI/ZonaForm asigna distritos a zonas, NO en la columna escalar distrito.zona_id
      // (que quedo sin poblar). La carga masiva deriva orden.zona_id de esta relacion.
      select: { id: true, nombre: true, cantonId: true, zonas: { select: { zonaId: true } } },
    });
    // Un distrito con EXACTAMENTE una zona resuelve orden.zona_id; con 0 zonas -> sin zona
    // asignada (error de fila); con >1 -> ambiguo/no derivable -> null (mismo trato seguro:
    // no se inventa una zona). El caso normal de negocio es 1 zona por distrito.
    return rows.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      cantonId: d.cantonId,
      zonaId: d.zonas.length === 1 ? d.zonas[0].zonaId : null,
    }));
  }

  /** R22: subconjunto de `ids` con rol `mensajero`. */
  async findMensajerosByIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.usuario.findMany({
      where: { id: { in: ids }, rol: { value: "mensajero" } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** R27: insercion masiva en lotes de `batchSize`, tolerando carreras de num_remision. */
  async createManyOrdenes(
    data: CreateOrdenData[],
    batchSize: number,
    historial: HistorialContexto,
  ): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize);
      const chunkNums = chunk.map((d) => d.numRemision);
      // Feature 49/#1 (R7): cada chunk hace su createMany + append en la MISMA tx.
      const chunkInserted = await this.prisma.$transaction(async (tx) => {
        // R8/R9: para registrar SOLO las EFECTIVAMENTE insertadas (skipDuplicates puede
        // saltar duplicadas), se comparan las filas con esos num_remision antes/despues:
        // las nuevas son las que no existian antes del insert.
        const before = await tx.orden.findMany({
          where: { numRemision: { in: chunkNums } },
          select: { id: true },
        });
        const beforeIds = new Set(before.map((r) => r.id));
        const result = await tx.orden.createMany({
          data: chunk.map((d) => this.toCreateManyInput(d)),
          skipDuplicates: true,
        });
        const after = await tx.orden.findMany({
          where: { numRemision: { in: chunkNums } },
          select: { id: true, estatusId: true },
        });
        const nuevas = after.filter((r) => !beforeIds.has(r.id));
        // R9/R20: por cada orden creada, origen null (creacion) -> destino estado inicial.
        await appendCambioEstado(
          tx,
          nuevas.map((r) => ({
            ordenId: r.id,
            estatusOrigenId: null,
            estatusDestinoId: r.estatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // carga_masiva
          })),
        );
        return result.count;
      });
      inserted += chunkInserted;
    }
    return inserted;
  }

  private toCreateManyInput(data: CreateOrdenData): Prisma.OrdenCreateManyInput {
    return {
      numRemision: data.numRemision,
      estatusId: data.estatusId,
      destinatario: data.destinatario,
      telefonoDest: data.telefonoDest,
      tiendaId: data.tiendaId,
      zonaId: data.zonaId,
      provinciaId: data.provinciaId,
      cantonId: data.cantonId,
      distritoId: data.distritoId ?? null,
      producto: data.producto,
      peso: data.peso !== null ? new Prisma.Decimal(data.peso) : null,
      notas: data.notas ?? null,
      direccion: data.direccion ?? null,
      montoCobrar: data.montoCobrar != null ? new Prisma.Decimal(data.montoCobrar) : null,
      mensajeroSugeridoId: data.mensajeroSugeridoId ?? null,
    };
  }

  // --- Feature 16: carga masiva etapa 2 (resumen + asignacion de mensajero) ---

  /** R6/R8/R9/R10: filas del resumen, acotadas a tienda del actor y no borradas. */
  async findResumenByNumRemisiones(
    nums: string[],
    tiendaId: string,
  ): Promise<ResumenCargaOrdenDTO[]> {
    if (nums.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { numRemision: { in: nums }, tiendaId, deletedAt: null },
      ...WITH_RESUMEN,
    });
    return rows.map(toResumenDTO);
  }

  /** R15/R16: actualiza en lote, solo ordenes no borradas de `tiendaId`. */
  async asignarMensajeroSugerido(
    ordenIds: string[],
    mensajeroSugeridoId: string,
    tiendaId: string,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    const result = await this.prisma.orden.updateMany({
      where: { id: { in: ordenIds }, tiendaId, deletedAt: null },
      data: { mensajeroSugeridoId },
    });
    return result.count;
  }

  /** R14: cuenta cuantas de `ordenIds` pertenecen a `tiendaId` y no estan borradas. */
  async countOrdenesDeTienda(ordenIds: string[], tiendaId: string): Promise<number> {
    if (ordenIds.length === 0) return 0;
    return this.prisma.orden.count({
      where: { id: { in: ordenIds }, tiendaId, deletedAt: null },
    });
  }

  // --- Feature 17: "Generar guia" / asignacion de mensajero (R5/R18-R29) ---

  /** R27/R29: INCLUYE borradas (el service distingue "no existe" de "borrada"). */
  async findByIdsForTransicion(ids: string[]): Promise<OrdenTransicionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        numGuia: true,
        deletedAt: true,
        estatus: { select: { value: true } },
        // Feature 30/R8/R9/R11/R12: zona de la orden + flag GAM de esa zona.
        zonaId: true,
        zona: { select: { esCentral: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      estatusValue: r.estatus.value,
      numGuia: r.numGuia,
      deletedAt: r.deletedAt,
      zonaId: r.zonaId,
      zonaEsGam: r.zona.esCentral,
    }));
  }

  /** R28: subconjunto de `ids` con rol `mensajero`, SIN filtro de zona. */
  async findMensajeroIdsValidos(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.usuario.findMany({
      where: { id: { in: ids }, rol: { value: "mensajero" } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** R28/T15: TODOS los usuarios con rol `mensajero`, SIN filtro de zona. */
  async findAllMensajeros(): Promise<MensajeroLiteRow[]> {
    return this.prisma.usuario.findMany({
      where: { rol: { value: "mensajero" } },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  /** Feature 30/R5 + 34/R5: usuarios rol `mensajero` cuyo `zonaId` sea la zona pasada. */
  async findMensajerosByZona(zonaId: string): Promise<MensajeroLiteRow[]> {
    return this.prisma.usuario.findMany({
      where: { rol: { value: "mensajero" }, zonaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  /** Feature 30/R6 + 34/R9: subconjunto de `ids` con rol `mensajero` Y `zonaId` = zona pasada. */
  async findMensajeroIdsValidosByZona(ids: string[], zonaId: string): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.usuario.findMany({
      where: { id: { in: ids }, rol: { value: "mensajero" }, zonaId },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * R15/R16 + feature 63/R5: catalogo completo `order_status` (id, value), solo
   * lectura. `orderBy: { value: "asc" }` garantiza un orden determinista y estable
   * entre renders (tabs de la feature 63); `value` es UNIQUE, asi que el orden es
   * total (sin empates que rompan la estabilidad).
   */
  async listOrderStatus(): Promise<OrderStatusLiteRow[]> {
    return this.prisma.orderStatus.findMany({
      select: { id: true, value: true },
      orderBy: { value: "asc" },
    });
  }

  /**
   * R5/R19/R25: transaccional (todo-o-nada, Prisma revierte automaticamente si
   * el callback lanza). Por cada decision: asigna `num_guia = nextval(...)` SOLO
   * si es NULL (idempotente, no consume la secuencia para filas ya numeradas) y
   * fija `estatusId`/`mensajeroAsignadoId`. El nombre de la secuencia es la
   * constante del modulo (nunca se interpola entrada de usuario en el SQL).
   */
  async generarGuiaLote(
    decisiones: GenerarGuiaDecisionData[],
    historial: HistorialContexto,
  ): Promise<GenerarGuiaResultRow[]> {
    if (decisiones.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      // Feature 49/#3 (R20): estatus de ORIGEN por orden, leido dentro de la tx antes de
      // escribir (cada orden puede venir de en_fulfillment/en_preparacion/en_bodega).
      const origenRows = await tx.orden.findMany({
        where: { id: { in: decisiones.map((d) => d.ordenId) } },
        select: { id: true, estatusId: true },
      });
      const origenById = new Map(origenRows.map((r) => [r.id, r.estatusId]));

      const resultados: GenerarGuiaResultRow[] = [];
      const entradas: CambioEstadoEntrada[] = [];
      for (const d of decisiones) {
        // R5: idempotente — solo consume nextval() si num_guia es NULL.
        await tx.$executeRawUnsafe(
          `UPDATE "orden" SET num_guia = nextval('${NUM_GUIA_SEQUENCE}') WHERE id = $1 AND num_guia IS NULL`,
          d.ordenId,
        );
        const updated = await tx.orden.update({
          where: { id: d.ordenId },
          data: { estatusId: d.estatusId, mensajeroAsignadoId: d.mensajeroAsignadoId },
          select: { numGuia: true },
        });
        if (updated.numGuia === null) {
          // Guarda defensiva: no deberia ocurrir (el UPDATE previo siempre deja
          // num_guia asignado), pero se documenta en vez de mentir con `as number`.
          throw new Error(`num_guia no asignado para la orden ${d.ordenId}`);
        }
        resultados.push({ ordenId: d.ordenId, numGuia: updated.numGuia });
        // R11: destino real por orden (en_espera_aceptacion/en_bodega/en_ruta_bodega_satelite).
        entradas.push({
          ordenId: d.ordenId,
          estatusOrigenId: origenById.get(d.ordenId) ?? null,
          estatusDestinoId: d.estatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // generacion_guia
        });
      }
      // R7: el append comparte la tx del lote; si falla, se revierten guias y estados.
      await appendCambioEstado(tx, entradas);
      return resultados;
    });
  }

  /** R26: fija mensajero/estatus en lote; NUNCA toca num_guia (idempotencia R5). */
  async asignarBodegaLote(
    ordenIds: string[],
    mensajeroId: string,
    estatusId: string,
    historial: HistorialContexto,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    // Feature 49/#4 (R7/R8/R12): updateMany + append en la MISMA tx. La guarda del
    // updateMany (`id IN`) no depende de estado mutable, asi que el conjunto que
    // transiciona = las filas existentes de `ordenIds`, pre-leidas para su origen.
    return this.prisma.$transaction(async (tx) => {
      const origenRows = await tx.orden.findMany({
        where: { id: { in: ordenIds } },
        select: { id: true, estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: { id: { in: ordenIds } },
        data: { mensajeroAsignadoId: mensajeroId, estatusId },
      });
      // R8: registra SOLO las filas efectivamente afectadas (las existentes).
      await appendCambioEstado(
        tx,
        origenRows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: r.estatusId,
          estatusDestinoId: estatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // asignacion_bodega
        })),
      );
      return result.count;
    });
  }

  /**
   * Feature 30/R10/R13: rutea el lote no-GAM a `en_ruta_bodega_satelite`.
   * Transaccional (todo-o-nada, Prisma revierte si el callback lanza). Por cada
   * orden asigna `num_guia = nextval(...)` SOLO si es NULL (idempotente, R10, no
   * consume la secuencia para filas ya numeradas), fija `estatusId` y deja
   * `mensajeroAsignadoId = NULL` (R9). El nombre de la secuencia es la constante
   * del modulo (nunca se interpola entrada de usuario en el SQL).
   */
  async rutearBodegaSateliteLote(
    ordenIds: string[],
    estatusId: string,
    historial: HistorialContexto,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      // Feature 49/#5 (R20): estatus de ORIGEN por orden, leido dentro de la tx.
      const origenRows = await tx.orden.findMany({
        where: { id: { in: ordenIds } },
        select: { id: true, estatusId: true },
      });
      const origenById = new Map(origenRows.map((r) => [r.id, r.estatusId]));
      for (const id of ordenIds) {
        // R10: idempotente — solo consume nextval() si num_guia es NULL.
        await tx.$executeRawUnsafe(
          `UPDATE "orden" SET num_guia = nextval('${NUM_GUIA_SEQUENCE}') WHERE id = $1 AND num_guia IS NULL`,
          id,
        );
        await tx.orden.update({
          where: { id },
          data: { estatusId, mensajeroAsignadoId: null }, // R9
        });
      }
      // R13: destino en_ruta_bodega_satelite; append en la MISMA tx (R7).
      await appendCambioEstado(
        tx,
        ordenIds.map((id) => ({
          ordenId: id,
          estatusOrigenId: origenById.get(id) ?? null,
          estatusDestinoId: estatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // ruteo_satelite
        })),
      );
      return ordenIds.length;
    });
  }

  // --- Feature 32: etiqueta de guia (READ derivado, R1/R3) ---

  /**
   * Feature 32/R1/R3: filas para la etiqueta por id. `where` filtra
   * `deletedAt: null` (R3: borrada/inexistente -> ausente, el service la reporta
   * como `no_encontrada`). NO filtra por `num_guia`: devuelve filas con `numGuia`
   * posible null y el service decide `sin_guia` (R2). Solo query.
   */
  async findEtiquetasByIds(ids: string[]): Promise<EtiquetaRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids }, deletedAt: null }, // R3
      ...WITH_ETIQUETA,
    });
    return rows.map(toEtiquetaRow);
  }

  // --- Feature 33: recepcion por QR en la bodega satelite (R4/R5/R6/R8/R11/R18) ---

  /** Feature 33/R4/R5: `usuario.zonaId` del adminSatelite; `null` si no tiene. */
  async findUsuarioZonaId(usuarioId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { zonaId: true },
    });
    return row?.zonaId ?? null;
  }

  /** Feature 39/R1/R4: `usuario.vehiculoId` del mensajero; `null` si no tiene. */
  async findUsuarioVehiculoId(usuarioId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { vehiculoId: true },
    });
    return row?.vehiculoId ?? null;
  }

  /**
   * Feature 33/R6/R8/R9: ordenes NO borradas de `zonaId` cuyo `estatus.value`
   * esta en `estatusValues`, con nombres legibles de tienda/geografia. Solo query.
   */
  async findRecepcionSateliteByZona(
    zonaId: string,
    estatusValues: string[],
  ): Promise<RecepcionSateliteRow[]> {
    if (estatusValues.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: {
        zonaId,
        deletedAt: null, // R6: excluye borradas
        estatus: { value: { in: estatusValues } },
      },
      ...WITH_RECEPCION_SATELITE,
    });
    return rows.map(toRecepcionSateliteRow);
  }

  /**
   * Feature 33/R11/R18: transiciona UNA orden a `en_bodega_satelite` SOLO si sigue
   * en `en_ruta_bodega_satelite`, es de `zonaId` y no esta borrada (guardia por
   * estado de origen + zona en el propio UPDATE; concurrencia-segura). Devuelve
   * `true` si afecto 1 fila. NO toca `mensajeroAsignadoId` ni `numGuia`.
   */
  async recibirEnSatelite(
    ordenId: string,
    zonaId: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<boolean> {
    // Feature 49/#6 (R7/R8/R14): updateMany guardado + append en la MISMA tx.
    return this.prisma.$transaction(async (tx) => {
      // R20: origen pre-leido con la MISMA guarda (estado en_ruta_bodega_satelite + zona).
      const actual = await tx.orden.findFirst({
        where: {
          id: ordenId,
          zonaId,
          deletedAt: null,
          estatus: { value: ORIGEN_RECEPCION_SATELITE },
        },
        select: { estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: {
          id: ordenId,
          zonaId,
          deletedAt: null,
          estatus: { value: ORIGEN_RECEPCION_SATELITE },
        },
        data: { estatusId: destinoEstatusId },
      });
      // R8: SOLO si transiciono (count 1); una orden que perdio la carrera no deja rastro.
      if (result.count === 1 && actual !== null) {
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: actual.estatusId,
            estatusDestinoId: destinoEstatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // recepcion_satelite
          },
        ]);
      }
      return result.count === 1;
    });
  }

  // --- Feature 34: asignacion satelite a mensajeros de la zona (R7/R14) ---

  /**
   * Feature 34/R7/R14: transiciona el lote a `en_espera_aceptacion` fijando
   * `mensajeroAsignadoId`, con escritura guardada por estado de ORIGEN + zona (solo
   * las que sigan en `origenEstatusId`, de `zonaId` y no borradas; patron
   * `recibirEnSatelite`, concurrencia-segura). Filtra por `estatusId` (id ya
   * resuelto por el service), NO por `estatus.value`. NUNCA toca `numGuia` (R8).
   * Devuelve el numero de filas efectivamente transicionadas.
   */
  async asignarSateliteLote(
    ordenIds: string[],
    mensajeroId: string,
    zonaId: string,
    destinoEstatusId: string,
    origenEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    // Feature 41/R23 (anti-TOCTOU): la guardia de bloqueo del mensajero va en el MISMO
    // UPDATE via `NOT EXISTS` sobre cierre_dia (estado solicitado/vencido). Si un cierre
    // bloqueante aparece entre el pre-check del service y esta escritura, el NOT EXISTS es
    // falso -> 0 filas transicionadas -> el service detecta count != lote -> conflict SIN
    // efectos parciales. El resto de la guardia (estado de origen + zona + no borrada) se
    // conserva igual (patron `recibirEnSatelite`). NO toca num_guia (R8). `updated_at` se
    // fija a mano (raw no dispara el @updatedAt de Prisma).
    //
    // Feature 49/#7 (R7/R8/R15): el UPDATE crudo pasa a `RETURNING "id"` DENTRO de un
    // `$transaction`, y con los ids retornados (EXACTAMENTE las ordenes que ganaron la
    // guarda anti-TOCTOU) hace el append del historial en la MISMA tx. Una orden que
    // pierde la guarda (bloqueo/estado/zona) NO aparece en el RETURNING -> no deja rastro.
    // El contrato de retorno sigue siendo el count de filas transicionadas (`rows.length`).
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "orden"
        SET "mensajero_asignado_id" = ${mensajeroId},
            "estatus_id" = ${destinoEstatusId},
            "updated_at" = NOW()
        WHERE "id" IN (${Prisma.join(ordenIds)})
          AND "estatus_id" = ${origenEstatusId}
          AND "zona_id" = ${zonaId}
          AND "deleted_at" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "cierre_dia" c
            WHERE c."mensajero_id" = ${mensajeroId}
              AND c."estado" IN ('solicitado', 'vencido')
          )
        RETURNING "id"`;
      await appendCambioEstado(
        tx,
        rows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: origenEstatusId, // la guarda garantiza este origen (R20)
          estatusDestinoId: destinoEstatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // asignacion_satelite
        })),
      );
      return rows.length;
    });
  }

  // --- Feature 41: bloqueo derivado en asignacion (R12/R16/R17) ---

  /** R12/R16: de `ids`, los mensajeros con un cierre_dia en `solicitado`/`vencido`. */
  async findMensajerosBloqueados(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.cierreDia.findMany({
      where: { mensajeroId: { in: ids }, estado: { in: ESTADOS_CIERRE_BLOQUEANTES } },
      select: { mensajeroId: true },
      distinct: ["mensajeroId"], // usa el indice (mensajero_id, estado)
    });
    return new Set(rows.map((r) => r.mensajeroId));
  }

  /**
   * R17 (regla estricta F1.4-Q4): `bloqueada = (i) || (ii)`. (i) cierre_dia de sus
   * mensajeros (destino satelite de su zona) en `solicitado`/`vencido`; (ii) su propio
   * CierreBodega hacia la central en `solicitado`. Dos EXISTS en paralelo.
   */
  async existeBodegaSateliteBloqueada(zonaId: string): Promise<{
    bloqueada: boolean;
    porMensajeros: boolean;
    porCierreBodega: boolean;
  }> {
    const [countMensajeros, countCierreBodega] = await Promise.all([
      // (i) usa el indice (destino_tipo, destino_zona_id) + filtro por estado.
      this.prisma.cierreDia.count({
        where: {
          destinoTipo: DESTINO_BODEGA_SATELITE,
          destinoZonaId: zonaId,
          estado: { in: ESTADOS_CIERRE_BLOQUEANTES },
        },
      }),
      // (ii) mismo criterio que la guardia de unicidad de la feature 40 (indice unico
      // parcial WHERE estado='solicitado'): a lo sumo uno por zona.
      this.prisma.cierreBodega.count({
        where: { zonaId, estado: ESTADO_CIERRE_BODEGA_PENDIENTE },
      }),
    ]);
    const porMensajeros = countMensajeros > 0;
    const porCierreBodega = countCierreBodega > 0;
    return { bloqueada: porMensajeros || porCierreBodega, porMensajeros, porCierreBodega };
  }
}

/** R28/R14: traduce la violacion de unicidad de num_remision a error de dominio. */
function mapCreateError(error: unknown, numRemision: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]) : [];
    if (target.some((t) => t.includes("num_remision") || t.includes("numRemision"))) {
      return new NumRemisionDuplicadoError(numRemision);
    }
    // Cualquier otra unicidad se traduce igual a conflicto de num_remision por ser
    // el unico campo unico que el usuario provee.
    return new NumRemisionDuplicadoError(numRemision);
  }
  return error;
}
