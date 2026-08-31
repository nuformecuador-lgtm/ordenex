import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearCobroRechazoTiendaInput,
  IRechazoTiendaCobroRepository,
  RechazoTiendaCobroEstadoDecidido,
  RechazoTiendaCobroRegistro,
  RechazoTiendaCobroTxClient,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroRepository";
import type { RechazoTiendaCobroDTO } from "@/lib/types/rechazo-tienda-cobro";

// Cliente Prisma acotado a lo que este repo necesita (patron `GastoFijoCobroRepository`): no
// puede tocar `wallet_movimiento`, `gestion_orden` ni `orden` aunque quisiera, por el TIPO. Lo
// que si puede es LEER sus columnas por relacion, que es lo que hace la cola.
type CobroPrismaClient = Pick<PrismaClient, "rechazoTiendaCobro">;

type CobroRow = Prisma.RechazoTiendaCobroGetPayload<Record<string, never>>;

/**
 * Lo que la COLA necesita ademas de la fila: el nombre de la tienda CONGELADA y los dos
 * identificadores del paquete. Es un `include` de LECTURA sobre relaciones propias; no convierte
 * a este repositorio en dueño de esas tablas ni le permite escribirlas.
 */
const CON_ETIQUETAS = {
  tienda: { select: { nombre: true } },
  orden: { select: { numGuia: true, numRemision: true } },
} as const;

type CobroRowConEtiquetas = Prisma.RechazoTiendaCobroGetPayload<{ include: typeof CON_ETIQUETAS }>;

/**
 * `generado_el` es una columna `DATE`: Prisma la entrega como `Date` a medianoche UTC, asi que el
 * `YYYY-MM-DD` sale de recortar el ISO. NO se usa la hora local — la fila YA es medianoche UTC y
 * leerla en local reabre el off-by-one que cerro la feature 166. Mismo par de helpers que
 * `GastoFijoCobroRepository`.
 */
function diaADTO(dia: Date): string {
  return dia.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> `Date` a medianoche UTC, la convencion con que se persiste la columna DATE. */
function diaAColumna(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

/**
 * Money-safe: `Decimal` -> STRING escala 2. `Decimal.toFixed(2)` es del propio Decimal, NO pasa
 * por `number`: ni un `parseFloat`, ni un `Number(`, ni aritmetica sobre los importes en todo el
 * archivo. Y no hay ninguna SUMA: los dos conceptos viajan separados hasta la pantalla, que es
 * como los enseña el detalle del cierre.
 */
function toDTO(r: CobroRowConEtiquetas): RechazoTiendaCobroDTO {
  return {
    id: r.id,
    tiendaNombre: r.tienda.nombre,
    numGuia: r.orden.numGuia,
    numRemision: r.orden.numRemision,
    montoFlete: r.montoFlete.toFixed(2),
    montoIva: r.montoIva.toFixed(2),
    generadoEl: diaADTO(r.generadoEl),
    estado: r.estado,
  };
}

/** La lectura COMPLETA, para uso interno del servidor. Lleva la clave del libro; el DTO no. */
function toRegistro(r: CobroRow): RechazoTiendaCobroRegistro {
  return {
    id: r.id,
    gestionId: r.gestionId,
    ordenId: r.ordenId,
    tiendaId: r.tiendaId,
    montoFlete: r.montoFlete.toFixed(2),
    montoIva: r.montoIva.toFixed(2),
    tarifaId: r.tarifaId,
    estado: r.estado,
    generadoEl: diaADTO(r.generadoEl),
    decididoPor: r.decididoPor,
    decididoAt: r.decididoAt === null ? null : r.decididoAt.toISOString(),
  };
}

/**
 * ⚠️ EL ORDEN DE LA COLA, declarado UNA vez: del MAS ANTIGUO al mas reciente.
 *
 * Es un orden TOTAL y no una sola columna, por la leccion que la ficha 334 dejo escrita en
 * `WalletMovimientoRepository.listar` y que la 333 copio: `generado_el` es un `DATE`, asi que
 * TODOS los cobros del mismo dia empatan por construccion —no es un caso raro, es el caso normal
 * en una operacion que rechaza varios paquetes en una tarde— y ordenar solo por el deja el
 * desempate indefinido. `created_at` desempata por creacion real e `id` cierra el orden aunque
 * dos filas compartieran tambien el instante.
 */
const ORDEN_COLA: Prisma.RechazoTiendaCobroOrderByWithRelationInput[] = [
  { generadoEl: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

/**
 * 💰 FICHA 337 (segunda mitad) — repositorio de COBROS POR RECHAZO DESDE NOVEDADES. SOLO queries
 * Prisma: sin logica de negocio, sin guardias de rol y sin decidir nada.
 *
 * ⚠️ AQUI NO SE CALCULA UN SOLO COLON. Los dos importes llegan ya derivados por
 * `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts`) desde la tarifa que resolvia en el
 * instante del rechazo, y este archivo solo los guarda como `Decimal` y los devuelve como STRING.
 * Ni una multiplicacion, ni una suma, ni un porcentaje.
 *
 * ⚠️ `gestionId` ES LA CLAVE y NO SE CONSTRUYE AQUI: llega ya resuelta en
 * `CrearCobroRechazoTiendaInput`. Es la misma cadena que acabara en
 * `wallet_movimiento.origen_id` y en `wallet_tienda_movimiento.origen_id` al aprobar, con
 * `origen_tipo = 'gestion_orden'`. Este archivo no la compone, no la parsea y no la reescribe.
 */
export class RechazoTiendaCobroRepository implements IRechazoTiendaCobroRepository {
  constructor(private readonly prisma: CobroPrismaClient) {}

  /**
   * Inserta el pendiente DENTRO de `tx`, idempotente por `rechazo_tienda_cobro_gestion_uq`:
   * `skipDuplicates` compila a `ON CONFLICT DO NOTHING`, asi que un segundo intento sobre la
   * misma gestion inserta 0 filas y la unicidad la decide el MOTOR, no una lectura previa (sin
   * TOCTOU). Devuelve cuantas filas se insertaron.
   *
   * `createMany` con UN elemento y no `create` a proposito: es lo que da el `skipDuplicates`.
   * Un `create` lanzaria `P2002` y obligaria a traducir un error de la ORM a un caso de negocio
   * — el mismo criterio por el que `marcarDecidido` usa `updateMany` y no `update`.
   */
  async crearPendiente(
    tx: RechazoTiendaCobroTxClient,
    input: CrearCobroRechazoTiendaInput,
  ): Promise<number> {
    const res = await tx.rechazoTiendaCobro.createMany({
      data: [
        {
          gestionId: input.gestionId,
          ordenId: input.ordenId,
          tiendaId: input.tiendaId,
          montoFlete: new Prisma.Decimal(input.montoFlete), // STRING -> Decimal (money-safe)
          montoIva: new Prisma.Decimal(input.montoIva),
          tarifaId: input.tarifaId,
          generadoEl: diaAColumna(input.generadoEl),
        },
      ],
      skipDuplicates: true,
    });
    return res.count;
  }

  /** Lee un cobro por id; `null` si no existe. Con `tx` lee dentro de esa transaccion. */
  async obtenerPorId(
    id: string,
    tx?: RechazoTiendaCobroTxClient,
  ): Promise<RechazoTiendaCobroRegistro | null> {
    const cliente = tx ?? this.prisma;
    const row = await cliente.rechazoTiendaCobro.findUnique({ where: { id } });
    return row === null ? null : toRegistro(row);
  }

  /** La cola de pendientes, del mas antiguo al mas reciente, recortada a `tope`. */
  async listarPendientes(tope: number): Promise<RechazoTiendaCobroDTO[]> {
    const rows = await this.prisma.rechazoTiendaCobro.findMany({
      where: { estado: "pendiente" },
      include: CON_ETIQUETAS,
      orderBy: ORDEN_COLA,
      take: tope,
    });
    return rows.map(toDTO);
  }

  /**
   * Cuantos siguen `pendiente`. TODOS, sin recorte: es el numero que la pantalla enseña al lado
   * de una lista que SI viene recortada, para que no pueda mentir con `items.length`.
   */
  async contarPendientes(): Promise<number> {
    return this.prisma.rechazoTiendaCobro.count({ where: { estado: "pendiente" } });
  }

  /**
   * ⚠️ LA TRANSICION. El `where` lleva `id` **y `estado: "pendiente"`**, y ese segundo termino es
   * lo que serializa a dos humanos: bajo `READ COMMITTED` la segunda transaccion espera el
   * bloqueo de fila, re-evalua el `WHERE` tras el commit de la primera, afecta CERO filas y sale
   * sin escribir. Devuelve el `count`: 1 = la decision es tuya, 0 = `ya_decidido`.
   *
   * `updateMany` y no `update`, mismo criterio que `GastoFijoCobroRepository.marcarDecidido`: el
   * `count` ES la respuesta, sin traducir un `P2025` de la ORM a un caso de negocio.
   *
   * Quitar `estado: "pendiente"` de este `where` es una de las mutaciones que la ficha obliga a
   * matar con un test de concurrencia real contra Postgres.
   */
  async marcarDecidido(
    tx: RechazoTiendaCobroTxClient,
    id: string,
    estado: RechazoTiendaCobroEstadoDecidido,
    actorId: string,
    ahora: Date,
  ): Promise<number> {
    const res = await tx.rechazoTiendaCobro.updateMany({
      where: { id, estado: "pendiente" },
      data: { estado, decididoPor: actorId, decididoAt: ahora },
    });
    return res.count;
  }
}
