import type { PrismaClient } from "@prisma/client";
import type {
  IOrdenHabilitacionApiRepository,
  RegistrarHabilitacionApiInput,
} from "@/lib/interfaces/repositories/IOrdenHabilitacionApiRepository";

// Feature 266 (T3.2, design §4.3) — acceso a `orden_habilitacion_api`. SOLO Prisma: ni una
// decision de negocio, ni una comprobacion de permisos, ni una proyeccion. La puerta —la orden
// tiene que ser del owner de la key— la pone `ApiHabilitacionService` (patron del repo, y la tabla
// lleva RLS habilitada SIN policies, R29).

/** El unico modelo que toca el repo. `Pick` para poder inyectar un `tx` o un doble en los tests
 *  sin arrastrar el cliente entero (patron `OrdenNotaRepository`). */
type OrdenHabilitacionApiPrismaClient = Pick<PrismaClient, "ordenHabilitacionApi">;

/**
 * **APPEND-ONLY (R24).** Esta clase expone UN solo metodo, `registrar`, y no tiene —ni debe
 * ganar— ningun `actualizar`, `editar`, `borrar` ni `marcarBorrada`: cuando la misma orden se
 * habilita de nuevo se INSERTA una fila mas, jamas se toca la anterior. Una segunda habilitacion
 * con otra nota es un hecho nuevo, no una correccion. La tabla tampoco tiene `updated_at` ni
 * `deleted_at` que permitirian escribirlos. Hay un test que lo afirma sobre el prototipo.
 */
export class OrdenHabilitacionApiRepository implements IOrdenHabilitacionApiRepository {
  constructor(private readonly prisma: OrdenHabilitacionApiPrismaClient) {}

  async registrar(input: RegistrarHabilitacionApiInput): Promise<void> {
    // Un solo `create`, sin leer ni tocar ninguna fila previa de la bitacora. `actorUsuarioId`
    // llega ya resuelto desde el actor de la key (el repo no sabe quien es el actor) y
    // `estadoResultante` es un SNAPSHOT que el service decidio, no algo que este repo derive.
    await this.prisma.ordenHabilitacionApi.create({
      data: {
        ordenId: input.ordenId,
        actorUsuarioId: input.actorUsuarioId,
        nota: input.nota,
        cambioDeEstado: input.cambioDeEstado,
        estadoResultante: input.estadoResultante,
      },
    });
  }
}
