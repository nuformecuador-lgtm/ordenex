import type { PrismaClient } from "@prisma/client";
import type {
  CrearOrdenNotaInput,
  IOrdenNotaRepository,
  OrdenNotaRow,
  OrdenParaHilo,
} from "@/lib/interfaces/repositories/IOrdenNotaRepository";

// Feature 227 (T2.4, design §2.1) — acceso a `orden_nota`. SOLO Prisma: ni una decision de
// negocio, ni una comprobacion de permisos, ni una proyeccion. Todo eso vive en
// `OrdenNotaService` (R26).

/** Los dos modelos que toca el repo. `Pick` para poder inyectar un `tx` de transaccion o un
 *  doble en los tests sin arrastrar el cliente entero. */
type OrdenNotaPrismaClient = Pick<PrismaClient, "ordenNota" | "orden">;

/** El `select` de la fila del hilo, en un solo sitio: `crear` y `listarPorOrden` DEBEN devolver
 *  exactamente la misma forma (`OrdenNotaRow`), y dos listas de campos escritas por separado se
 *  desincronizan a la primera columna nueva. `autor: { nombre }` resuelve el nombre por JOIN en
 *  la misma consulta; `autorId` viaja al service para que calcule `esPropia` (y muere ahi: el
 *  DTO no lo publica). */
const SELECT_NOTA = {
  id: true,
  autorId: true,
  rolAutor: true,
  cuerpo: true,
  createdAt: true,
  deletedAt: true,
  autor: { select: { nombre: true } },
} as const;

export class OrdenNotaRepository implements IOrdenNotaRepository {
  constructor(private readonly prisma: OrdenNotaPrismaClient) {}

  async listarPorOrden(ordenId: string): Promise<OrdenNotaRow[]> {
    // R3/R28: UNA sola consulta para el hilo entero, apoyada en el indice
    // `(orden_id, created_at)`. El `id` desempata los instantes REPETIDOS: sin el, dos notas
    // creadas en el mismo milisegundo podrian volver en distinto orden en dos lecturas
    // consecutivas y el hilo "se movería" solo.
    //
    // R34: NO se filtra `deletedAt`. Las borradas tienen que llegar para que la UI pinte el
    // hueco marcado en su posicion; el CUERPO lo descarta el service (design §A9).
    return this.prisma.ordenNota.findMany({
      where: { ordenId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: SELECT_NOTA,
    });
  }

  async crear(input: CrearOrdenNotaInput): Promise<OrdenNotaRow> {
    // R1: un solo `create`, sin leer ni tocar ninguna fila previa del hilo. `autorId` y
    // `rolAutor` llegan ya resueltos desde el actor (el repo no sabe quien es el actor).
    return this.prisma.ordenNota.create({
      data: {
        ordenId: input.ordenId,
        autorId: input.autorId,
        rolAutor: input.rolAutor,
        cuerpo: input.cuerpo,
      },
      select: SELECT_NOTA,
    });
  }

  async marcarBorrada(notaId: string, ordenId: string, autorId: string): Promise<number> {
    // R31/R32/R33: borrado LOGICO. El `autorId` (y el `ordenId` del hilo ya autorizado) van en
    // el WHERE, no en un `if` previo: la propiedad se comprueba en el MISMO statement que muta,
    // asi que no existe ventana entre el chequeo y el efecto. `deletedAt: null` hace el borrado
    // idempotente: repetirlo devuelve `count = 0`, no vuelve a mover la marca.
    //
    // `updateMany` y no `update` a proposito: `update` lanzaria P2025 cuando la nota es ajena o
    // no existe, y este repo no debe convertir un caso de negocio en excepcion. El `count` (0 o
    // 1) es la respuesta.
    const { count } = await this.prisma.ordenNota.updateMany({
      where: { id: notaId, ordenId, autorId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count;
  }

  async findOrdenParaHilo(ordenId: string): Promise<OrdenParaHilo | null> {
    // La lectura MINIMA para autorizar: tienda (pertenencia del adminTienda), mensajero
    // asignado (pertenencia del mensajero), estatus (ventana) y `deletedAt` (orden borrada, que
    // el service trata igual que inexistente).
    const orden = await this.prisma.orden.findUnique({
      where: { id: ordenId },
      select: {
        tiendaId: true,
        mensajeroAsignadoId: true,
        deletedAt: true,
        // 2026-08-18: la ventana del adminTienda tambien se abre con una solicitud de ayuda viva.
        ayuda: true,
        estatus: { select: { value: true } },
      },
    });
    if (!orden) return null;
    return {
      tiendaId: orden.tiendaId,
      mensajeroAsignadoId: orden.mensajeroAsignadoId,
      estatusValue: orden.estatus.value,
      ayuda: orden.ayuda,
      deletedAt: orden.deletedAt,
    };
  }
}
