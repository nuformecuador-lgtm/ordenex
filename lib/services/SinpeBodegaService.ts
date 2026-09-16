import type {
  IZonaRepository,
  SinpeZonaRow,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IZonaService";
import type {
  ConfirmarSinpeBodegaServiceResult,
  GuardarSinpeBodegaServiceResult,
  ISinpeBodegaService,
  ListarSinpeBodegasServiceResult,
} from "@/lib/interfaces/services/ISinpeBodegaService";
import type { GuardarSinpeBodegaInput, SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";
import { puedeEditarAlgunSinpe } from "@/lib/types/sinpe-bodega";

/**
 * ⭑ FICHA 429 — QUIEN PUEDE VER Y EDITAR EL SINPE DE QUE BODEGA.
 *
 * Logica pura: ni Prisma, ni `Request`/`Response`, ni `process.env`. El repositorio entra por
 * constructor.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ LA REGLA DE PERMISO, Y POR QUE LA ZONA SE LEE DE LA BASE (R19/R20)
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * `maestro` y `admin` pueden con las ocho. El `adminSatelite`, SOLO con la suya — y «la suya» es
 * la que `usuario.zona_id` dice en la BASE, resuelta aqui por `usuarioId`. NUNCA la que venga en
 * el payload, y tampoco la del `Actor` de la sesion: un `zonaId` que decide un permiso y viaja en
 * una cookie es un permiso que viaja por el cliente.
 *
 * El `zonaId` que llega en la peticion dice QUE bodega se quiere tocar. No dice, ni puede decir,
 * SI se puede.
 *
 * Un `adminSatelite` SIN zona (`usuario.zona_id` es nullable: es un estado representable) no puede
 * editar ninguna. `null` significa «no tiene bodega», jamas «todas».
 */
export class SinpeBodegaService implements ISinpeBodegaService {
  constructor(private readonly repo: IZonaRepository) {}

  /**
   * La zona que ESTE actor puede editar. `"todas"` para `maestro`/`admin`; el id de su bodega para
   * el `adminSatelite`; `null` para todo lo demas (y para el `adminSatelite` sin zona).
   */
  private async alcance(actor: Actor): Promise<"todas" | string | null> {
    if (!puedeEditarAlgunSinpe(actor.rol)) return null;
    if (actor.rol === "maestro" || actor.rol === "admin") return "todas";
    // `adminSatelite`: la zona la dice la base, no la peticion (R20).
    return this.repo.zonaIdDeUsuario(actor.usuarioId);
  }

  private static puedeEditar(alcance: "todas" | string | null, zonaId: string): boolean {
    return alcance === "todas" || alcance === zonaId;
  }

  /**
   * R2 — el par es de la BODEGA, no de la persona: dos administradores de la misma bodega ven y
   * editan exactamente el mismo par, porque los dos leen la misma fila.
   *
   * ⚠️ `editable` SALE DECIDIDO DEL SERVIDOR. La pantalla no vuelve a razonar sobre roles: si lo
   * hiciera, habria dos reglas de permiso —la de aqui y la de alla— y divergirian sin que nada se
   * pusiera rojo. La pantalla PINTA lo que este campo dice.
   */
  async listar(actor: Actor): Promise<ListarSinpeBodegasServiceResult> {
    const alcance = await this.alcance(actor);
    if (alcance === null) return { status: "forbidden" }; // R31: quien no edita ninguna, no entra

    const filas = await this.repo.listarSinpe();
    const visibles = alcance === "todas" ? filas : filas.filter((f) => f.id === alcance);
    return { status: "ok", items: visibles.map((f) => toDTO(f, alcance)) };
  }

  /**
   * R19/R20 — el guardado. El permiso se decide ANTES de la primera escritura: un `forbidden` no
   * deja la bodega a medias ni toca la marca de revision.
   */
  async guardar(
    zonaId: string,
    input: GuardarSinpeBodegaInput,
    actor: Actor,
  ): Promise<GuardarSinpeBodegaServiceResult> {
    const alcance = await this.alcance(actor);
    if (!SinpeBodegaService.puedeEditar(alcance, zonaId)) return { status: "forbidden" };

    const fila = await this.repo.guardarSinpe(
      zonaId,
      { numero: input.numero, nombre: input.nombre },
      actor.usuarioId,
    );
    if (fila === null) return { status: "not_found" };
    return { status: "ok", bodega: toDTO(fila, alcance) };
  }

  /** R25 — confirmar. Mismo permiso que guardar: quien no puede corregirlo tampoco lo aprueba. */
  async confirmar(zonaId: string, actor: Actor): Promise<ConfirmarSinpeBodegaServiceResult> {
    const alcance = await this.alcance(actor);
    if (!SinpeBodegaService.puedeEditar(alcance, zonaId)) return { status: "forbidden" };

    const fila = await this.repo.confirmarSinpe(zonaId);
    if (fila === null) return { status: "not_found" };
    return { status: "ok" };
  }
}

/**
 * Fila -> DTO. `sinpeRevisadoAt` se serializa a ISO AQUI, en la frontera: un `Date` no cruza el
 * borde RSC, y `null` se conserva como `null` —nunca como una cadena vacia ni una fecha inventada—
 * porque R5 exige poder distinguir «nadie lo ha mirado» de «se reviso».
 */
function toDTO(fila: SinpeZonaRow, alcance: "todas" | string | null): SinpeBodegaDTO {
  return {
    zonaId: fila.id,
    zonaNombre: fila.nombre,
    esCentral: fila.esCentral,
    numero: fila.sinpeNumero,
    nombre: fila.sinpeNombre,
    revisadoAt: fila.sinpeRevisadoAt === null ? null : fila.sinpeRevisadoAt.toISOString(),
    editable: alcance === "todas" || alcance === fila.id,
  };
}
