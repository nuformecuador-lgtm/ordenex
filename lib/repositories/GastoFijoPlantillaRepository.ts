import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ActualizarPlantillaInput,
  CrearPlantillaInput,
  IGastoFijoPlantillaRepository,
} from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletMovimientoRepository).
type PlantillaPrismaClient = Pick<PrismaClient, "gastoFijoPlantilla">;

type PlantillaRow = Prisma.GastoFijoPlantillaGetPayload<Record<string, never>>;

// Feature 84 — la columna `fecha_cobro` es DATE: Prisma la entrega como Date a medianoche UTC.
// El DTO la expone como `YYYY-MM-DD` (misma convencion que `lib/utils/periodicidad.ts`), asi que
// alcanza con recortar el ISO. NO uses la hora local: la fila YA es medianoche UTC.
function fechaCobroADTO(fechaCobro: Date): string {
  return fechaCobro.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> Date a medianoche UTC, la convencion con que se persiste la columna DATE. */
function fechaCobroAColumna(fechaCobro: string): Date {
  return new Date(`${fechaCobro}T00:00:00.000Z`);
}

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
function toDTO(r: PlantillaRow): GastoFijoPlantillaDTO {
  return {
    id: r.id,
    concepto: r.concepto,
    monto: r.monto.toFixed(2),
    activa: r.activa,
    periodicidadUnidad: r.periodicidadUnidad,
    periodicidadCantidad: r.periodicidadCantidad,
    fechaCobro: fechaCobroADTO(r.fechaCobro),
    // Ficha 333 (R1/R4): el interruptor viaja en el DTO para que la tabla lo pinte y el diálogo
    // lo fije. `boolean` puro: no hay monto ni fecha que traducir.
    requiereAprobacion: r.requiereAprobacion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Feature 184 — Tanda G (R16) — el ORDEN de las plantillas, declarado UNA vez.
 *
 * Estaba escrito TRES veces en este archivo (`listar`, `listarPaginado`, `listarActivas`) con
 * el mismo literal. Mientras el conjunto entero solo alimentaba una tabla sin paginar, dos
 * copias divergentes eran un defecto cosmetico. Desde que el conjunto sostiene el ARCHIVO de
 * la descarga deja de serlo: si el orden del conjunto se separa del de la pagina, la fila 26
 * del archivo deja de ser la primera de la pagina 2 y no hay ninguna pantalla que lo diga.
 *
 * Lo que distingue a las tres lecturas es su `where` —`listarActivas` es el conjunto del CRON,
 * y ese filtro sigue siendo suyo—, no la secuencia en que presentan las filas.
 */
const ORDEN_PLANTILLAS: Prisma.GastoFijoPlantillaOrderByWithRelationInput = { createdAt: "desc" };

/**
 * Feature 45 — repositorio de PLANTILLAS de gasto fijo. SOLO queries Prisma: crear, actualizar
 * (concepto/monto/ciclo), setActiva (activar/desactivar), eliminar, listar (todas), listarActivas
 * (cron), obtenerPorId. Montos SIEMPRE STRING en el DTO (money-safe, R12).
 *
 * El CRUD incluye BORRADO desde la ficha 332, que **revoca** el «sin borrado» de `45/R25` con
 * decision humana del 2026-08-29: la tabla acumula ruido y el historico del libro no depende de
 * la plantilla (sin FK, referencia derivada). Ver `specs/332-eliminar-plantilla-gasto-fijo` y la
 * nota larga en `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts`.
 */
export class GastoFijoPlantillaRepository implements IGastoFijoPlantillaRepository {
  constructor(private readonly prisma: PlantillaPrismaClient) {}

  /** R24: crea la plantilla (activa=true por default de la columna). Feature 84: + periodicidad. */
  async crear(input: CrearPlantillaInput): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.create({
      data: {
        concepto: input.concepto,
        monto: new Prisma.Decimal(input.monto),
        periodicidadUnidad: input.periodicidadUnidad,
        periodicidadCantidad: input.periodicidadCantidad,
        fechaCobro: fechaCobroAColumna(input.fechaCobro),
        // Ficha 333 (R2): SOLO viaja si el llamador lo trae; ausente ⇒ manda el `DEFAULT true` de
        // la columna, o sea «requiere aprobación». Mismo patrón que `CrearMovimientoInput.id`.
        ...(input.requiereAprobacion !== undefined
          ? { requiereAprobacion: input.requiereAprobacion }
          : {}),
      },
    });
    return toDTO(row);
  }

  /**
   * R25: edita concepto/monto (el @updatedAt de Prisma refresca updated_at). Feature 84: tambien
   * la periodicidad. Mover `fechaCobro` mueve el ancla del ciclo, no reescribe egresos pasados.
   */
  async actualizar(id: string, input: ActualizarPlantillaInput): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.update({
      where: { id },
      data: {
        concepto: input.concepto,
        monto: new Prisma.Decimal(input.monto),
        periodicidadUnidad: input.periodicidadUnidad,
        periodicidadCantidad: input.periodicidadCantidad,
        fechaCobro: fechaCobroAColumna(input.fechaCobro),
        // Ficha 333 (R1): SOLO viaja si el llamador lo trae; ausente ⇒ la fila conserva el valor
        // que tenía. Una edición parcial NO puede cambiar en silencio si un gasto se cobra solo.
        ...(input.requiereAprobacion !== undefined
          ? { requiereAprobacion: input.requiereAprobacion }
          : {}),
      },
    });
    return toDTO(row);
  }

  /** R25: activa/desactiva. Reversible y conserva el id (y con el la clave del cron). */
  async setActiva(id: string, activa: boolean): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.update({ where: { id }, data: { activa } });
    return toDTO(row);
  }

  /**
   * Ficha 332 (R2/R3/R8) — borra la plantilla. `true` si borro una fila, `false` si ya no existia.
   *
   * `deleteMany` y no `delete`, igual que `VehiculoRepository.delete`: `delete` lanza `P2025`
   * cuando la fila ya no esta y obligaria al servicio a traducir un codigo de error de la ORM a
   * `not_found`. El `count` es esa misma respuesta, sin excepcion y sin ventana TOCTOU.
   *
   * El `where` lleva SOLO la clave primaria (R3): ni `activa`, ni fechas, ni nada mas. Y no puede
   * tocar `wallet_movimiento` (R8) porque `PlantillaPrismaClient` no lo expone — el libro queda
   * intacto por el TIPO, no por buena voluntad. Lo afirma
   * `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts`.
   */
  async eliminar(id: string): Promise<boolean> {
    const res = await this.prisma.gastoFijoPlantilla.deleteMany({ where: { id } });
    return res.count > 0;
  }

  /**
   * R26: todas las plantillas, mas recientes primero.
   *
   * Feature 184 — Tanda G: este es ademas el CONJUNTO del que sale el archivo de la descarga
   * (listado 11 del Anexo A). No se le anadio un gemelo `listarCompleto`: seria un tercer
   * `findMany` sin `where` con el mismo orden, o sea una segunda declaracion del mismo
   * criterio, que es justo lo que R16 prohibe. Sin `skip`/`take` y sin `count` (R15): el total
   * del archivo es el numero de filas que devuelve, no un conteo aparte.
   */
  async listar(): Promise<GastoFijoPlantillaDTO[]> {
    const rows = await this.prisma.gastoFijoPlantilla.findMany({ orderBy: ORDEN_PLANTILLAS });
    return rows.map(toDTO);
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina de las plantillas + el
   * total. Sin `where`: este listado no acota nada (lo unico que decide quien lo ve es el ROL,
   * y eso vive en el servicio), asi que la pagina y el conteo miran el mismo conjunto por
   * construccion.
   */
  async listarPaginado(rango: RangoPagina): Promise<PaginaRepositorio<GastoFijoPlantillaDTO>> {
    const [rows, total] = await Promise.all([
      this.prisma.gastoFijoPlantilla.findMany({
        orderBy: ORDEN_PLANTILLAS, // R51/R16: el MISMO criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
      }),
      this.prisma.gastoFijoPlantilla.count(), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toDTO), total };
  }

  /** R27: solo las activas (consumo del cron). */
  async listarActivas(): Promise<GastoFijoPlantillaDTO[]> {
    const rows = await this.prisma.gastoFijoPlantilla.findMany({
      where: { activa: true }, // lo que distingue al conjunto del CRON es ESTO, no el orden
      orderBy: ORDEN_PLANTILLAS,
    });
    return rows.map(toDTO);
  }

  async obtenerPorId(id: string): Promise<GastoFijoPlantillaDTO | null> {
    const row = await this.prisma.gastoFijoPlantilla.findUnique({ where: { id } });
    return row === null ? null : toDTO(row);
  }
}
