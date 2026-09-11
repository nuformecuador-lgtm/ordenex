// FICHA 410 (design §5, T3.2) — repositorio del CANAL: las suscripciones de los dispositivos y el
// cupo diario. SOLO queries Prisma (docs/architecture.md): ni una regla de negocio, ni una decision
// de elegibilidad, ni un reloj. La jornada entra ya resuelta.
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  IPushSuscripcionRepository,
  RegistrarSuscripcionInput,
  SuscripcionDeUsuario,
  TomaDeCupo,
} from "@/lib/interfaces/repositories/IPushSuscripcionRepository";

/** Lo minimo del cliente Prisma que este repositorio consume (patron `ApiKeyRepository`). */
type PushPrismaClient = Pick<PrismaClient, "pushSuscripcion" | "pushEnvioDia">;

export class PushSuscripcionRepository implements IPushSuscripcionRepository {
  constructor(private readonly prisma: PushPrismaClient) {}

  /**
   * R16/R17/R18 — UPSERT POR `endpoint`. El `where` es el endpoint SOLO, nunca el par
   * (usuario, endpoint): si Ana cierra sesion y Beto entra en el mismo telefono, el navegador
   * devuelve el MISMO endpoint y el `update` reescribe `usuario_id`. Con el par en el `where`
   * habria dos filas vivas y Ana seguiria recibiendo push en un telefono que ya no es suyo.
   */
  async registrar(usuarioId: string, input: RegistrarSuscripcionInput): Promise<void> {
    await this.prisma.pushSuscripcion.upsert({
      where: { endpoint: input.endpoint },
      create: {
        usuarioId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        etiqueta: input.etiqueta ?? null,
      },
      update: {
        // El dueno se REESCRIBE: es la mitad de R18 y la razon de que esto sea un upsert.
        usuarioId,
        // Las claves se renuevan con la suscripcion; guardarlas viejas seria entregar a un
        // destinatario que ya no puede descifrar.
        p256dh: input.p256dh,
        auth: input.auth,
        etiqueta: input.etiqueta ?? null,
      },
      select: { id: true },
    });
  }

  /** R15/R19 — solo lo suyo: el `where` lleva el `usuarioId` ademas del endpoint. */
  async eliminarDeUsuario(usuarioId: string, endpoint: string): Promise<number> {
    const { count } = await this.prisma.pushSuscripcion.deleteMany({
      where: { usuarioId, endpoint },
    });
    return count;
  }

  /**
   * R33 — retirada de una suscripcion MUERTA. `deleteMany` y no `delete` a proposito: si otra
   * corrida del drenador la borro primero, `delete` lanzaria `P2025` y convertiria una limpieza
   * exitosa en un fallo del job.
   */
  async eliminarPorId(id: string): Promise<void> {
    await this.prisma.pushSuscripcion.deleteMany({ where: { id } });
  }

  /** R26 — todas las suscripciones de esos usuarios, en una consulta. Vacio -> `[]` sin consultar. */
  async listarPorUsuarios(usuarioIds: readonly string[]): Promise<SuscripcionDeUsuario[]> {
    if (usuarioIds.length === 0) return [];
    const filas = await this.prisma.pushSuscripcion.findMany({
      where: { usuarioId: { in: [...usuarioIds] } },
      select: { id: true, usuarioId: true, endpoint: true, p256dh: true, auth: true },
      orderBy: { createdAt: "asc" },
    });
    return filas;
  }

  async sellarEnvioOk(id: string, ahora: Date): Promise<void> {
    await this.prisma.pushSuscripcion.updateMany({
      where: { id },
      data: { ultimoEnvioOkAt: ahora },
    });
  }

  /**
   * R6/R7 — EL CUPO SE TOMA INSERTANDO. `true` si esta llamada gano el dia; `false` si ya estaba
   * gastado.
   *
   * ⚠️ NO HAY `SELECT` PREVIO Y NO PUEDE HABERLO. Quien decide es el indice unico
   * `push_envio_dia_cupo`: dos productores concurrentes chocan en la base y solo uno inserta. Con
   * un `findFirst` delante, los dos leerian «no hay» y los dos insertarian —o peor, los dos
   * empujarian— porque entre la lectura y la escritura cabe la otra transaccion entera. El `P2002`
   * es el desenlace NORMAL de este metodo, no un error: se traduce a `false` y nada se propaga.
   */
  async tomarCupoDelDia(toma: TomaDeCupo): Promise<boolean> {
    try {
      await this.prisma.pushEnvioDia.create({
        data: {
          usuarioId: toma.usuarioId,
          evento: toma.evento,
          diaCr: toma.diaCr,
          notificacionId: toma.notificacionId,
        },
        select: { id: true },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Los usuarios cuyo cupo del dia lo gasto ESTE aviso. Se consulta por `notificacion_id` y NO por
   * (evento, dia): el trabajo puede ejecutarse un minuto despues y cruzar la medianoche de Costa
   * Rica, y entonces una consulta por jornada no encontraria nada y el push se perderia en
   * silencio. La pregunta correcta no es «que dia es» sino «para quien gano este aviso».
   */
  async usuariosConCupoDe(notificacionId: string): Promise<string[]> {
    const filas = await this.prisma.pushEnvioDia.findMany({
      where: { notificacionId },
      select: { usuarioId: true },
    });
    return filas.map((f) => f.usuarioId);
  }
}
