import type {
  CreateZonaData,
  IZonaRepository,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  Actor,
  ActualizarZonaServiceResult,
  BorrarZonaServiceResult,
  CrearZonaServiceResult,
  ImpactoZonaCentralServiceResult,
  IZonaService,
  ListarZonasServiceResult,
  ObtenerZonaServiceResult,
} from "@/lib/interfaces/services/IZonaService";
import type { ActualizarZonaInput, CrearZonaInput, ListarZonasInput } from "@/lib/types/zona";
import { rechazoDeNombreDeEtiqueta } from "@/lib/utils/nombre-imprimible-etiqueta";

/**
 * ⭑ FICHA 376 (R6) — EL MOTIVO DEL RECHAZO DE R5, EN ESPAÑOL Y ACCIONABLE.
 *
 * Va colgado del campo `esCentral` para que la pantalla lo pinte JUNTO A LA CASILLA (R23), y no
 * como un toast generico. Dice ademas QUE HACER: la salida no es reintentar, es marcar otra zona.
 */
const MSG_SIN_ZONA_CENTRAL =
  "Tiene que haber una zona central. Para quitarle la marca a ésta, márcala en otra zona.";

// Feature 24: el CRUD de zonas es EXCLUSIVO del rol maestro.
function esMaestro(actor: Actor): boolean {
  return actor.rol === "maestro";
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * FICHA 376: `prepararDatos` deja de decidir la marca. Devuelve todo MENOS `esCentral`, y cada
 * llamador la añade con SU tipo: `crear` con un `boolean` (el zod le puso el default, R2) y
 * `actualizar` con un `boolean | undefined` (ausente = no tocar, R1). Sin `any` y sin duplicar la
 * validacion referencial.
 */
type DatosSinMarca = Omit<CreateZonaData, "esCentral">;

type PrepararResult =
  | { ok: true; data: DatosSinMarca }
  | { ok: false; fieldErrors: Record<string, string[]> };

export class ZonaService implements IZonaService {
  constructor(private readonly repo: IZonaRepository) {}

  // Valida existencia de distritos y vehiculos y deduplica distritoIds. La regla
  // cobroVehiculo<->tarifas ya la garantizo Zod en el borde; aqui solo integridad
  // referencial (para errores de dominio limpios en vez de fallos de FK).
  private async prepararDatos(
    input: CrearZonaInput | ActualizarZonaInput,
  ): Promise<PrepararResult> {
    const fieldErrors: Record<string, string[]> = {};

    // ⭑ FICHA 392 — el nombre de la zona SE IMPRIME en la etiqueta: es la primera parte de
    // `geografiaLegible` (`zona / provincia / canton / distrito`), que va al dato `ubicacion`.
    //
    // Va AQUI, en `prepararDatos`, y no en `crear` y `actualizar` por separado, porque es el
    // punto que los DOS caminos ya comparten: un solo sitio cierra las dos escrituras y no hay
    // forma de que una gane la comprobacion y la otra la pierda. Mismo criterio con el que la 383
    // eligio `BulkOrdenService.resolveFila` para cerrar las dos vias de carga de una vez.
    //
    // Y NO se cuelga del zod de `lib/types/zona.ts` por el motivo de siempre: ese modulo viaja al
    // navegador y la decision de «que es imprimible» se toma con la cobertura de la fuente.
    Object.assign(fieldErrors, rechazoDeNombreDeEtiqueta(input.nombre) ?? {});

    const distritoIds = distinct(input.distritoIds);
    const distritosExistentes = await this.repo.countExistingDistritos(distritoIds);
    if (distritosExistentes !== distritoIds.length) {
      fieldErrors.distritoIds = ["uno o mas distritoIds no existen"];
    }

    const vehiculoIds = distinct(
      input.tarifas
        .map((t) => t.vehiculoId)
        .filter((v): v is string => v !== undefined),
    );
    if (vehiculoIds.length > 0) {
      const vehiculosExistentes = await this.repo.countExistingVehiculos(vehiculoIds);
      if (vehiculosExistentes !== vehiculoIds.length) {
        fieldErrors.tarifas = ["uno o mas vehiculoId no existen"];
      }
    }

    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

    return {
      ok: true,
      data: {
        nombre: input.nombre,
        cobroVehiculo: input.cobroVehiculo,
        distritoIds,
        tarifas: input.tarifas.map((t) => ({
          cobroEntregado: t.cobroEntregado,
          cobroRechazado: t.cobroRechazado,
          vehiculoId: t.vehiculoId ?? null,
        })),
      },
    };
  }

  async crear(input: CrearZonaInput, actor: Actor): Promise<CrearZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const prep = await this.prepararDatos(input);
    if (!prep.ok) return { status: "validation_error", fieldErrors: prep.fieldErrors };
    // 376/R2: al CREAR, `esCentral` es siempre un `boolean` —el zod le puso el default `false`—.
    // 376/R12: QUIEN crea firma las filas del traslado que la marca provoque.
    const zona = await this.repo.create(
      { ...prep.data, esCentral: input.esCentral },
      actor.usuarioId,
    );
    return { status: "ok", zona };
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const zona = await this.repo.findById(id, true);
    if (!zona) return { status: "not_found" };
    return { status: "ok", zona };
  }

  async listar(input: ListarZonasInput, actor: Actor): Promise<ListarZonasServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const includeTarifas = input.include?.includes("tarifas") ?? false;
    const skip = (input.page - 1) * input.pageSize;
    const { items, total } = await this.repo.list({
      skip,
      take: input.pageSize,
      includeTarifas,
    });
    return { status: "ok", items, page: input.page, pageSize: input.pageSize, total };
  }

  async actualizar(
    id: string,
    input: ActualizarZonaInput,
    actor: Actor,
  ): Promise<ActualizarZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const prep = await this.prepararDatos(input);
    if (!prep.ok) return { status: "validation_error", fieldErrors: prep.fieldErrors };
    // 362/R4/R9 + 366/R10: QUIEN guarda la zona ESTA, y es quien firma cada fila de historial que
    // produzca la reconciliacion o el cambio de marca. Mismo patron que `borrar` con `hardDelete`.
    //
    // 376/R1/R3: `input.esCentral` puede ser `undefined` (el payload no traia el campo) y ese
    // `undefined` se propaga TAL CUAL hasta Prisma, que no toca la columna. Ponerle aqui un
    // `?? false` seria reintroducir el defecto que esta ficha arregla.
    const res = await this.repo.update(
      id,
      { ...prep.data, esCentral: input.esCentral },
      actor.usuarioId,
    );
    if (res.estado === "not_found") return { status: "not_found" };
    // 376/R6: el desenlace del repositorio se traduce a la rama de validacion que ya existia, con
    // el motivo colgado del CAMPO de la marca para que la pantalla lo pinte junto a la casilla.
    if (res.estado === "sin_zona_central") {
      return { status: "validation_error", fieldErrors: { esCentral: [MSG_SIN_ZONA_CENTRAL] } };
    }
    // 366/R12 + 377/R7/R8: LOS DOS conteos se reenvian TAL CUAL. El service no los interpreta, no
    // los suma y no los redondea: quien guardo la zona tiene que ver cuantas ordenes se movieron
    // por su guardado y cuantas se quedaron en la bodega que ya las tiene.
    return {
      status: "ok",
      zona: res.zona,
      ordenesReconciliadas: res.ordenesReconciliadas,
      ordenesRetenidasEnBodegaSatelite: res.ordenesRetenidasEnBodegaSatelite,
    };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarZonaServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const res = await this.repo.hardDelete(id, actor.usuarioId); // 362/R4/R9: QUIEN borro ESTA
    if (res === "not_found") return { status: "not_found" };
    // 376/R10/R11: dos conflictos, dos motivos. `es_central` pide marcar OTRA zona como central;
    // `en_uso` pide vaciar la zona. Compartir palabra obligaria a quien lee a adivinar cual es.
    if (res === "es_central") return { status: "conflict", motivo: "es_central" };
    if (res === "referenced") return { status: "conflict", motivo: "en_uso" };
    return { status: "ok" };
  }

  /**
   * FICHA 376 (Q4): el impacto de mover la marca, para que la confirmacion lo diga. Solo lectura,
   * mismo gate `maestro` que el resto del CRUD de zonas (design §6.4: esta ficha no crea
   * superficies nuevas de permiso).
   */
  async impactoZonaCentral(
    zonaIds: string[],
    actor: Actor,
  ): Promise<ImpactoZonaCentralServiceResult> {
    if (!esMaestro(actor)) return { status: "forbidden" };
    const impacto = await this.repo.contarOrdenesVivasPorZona(zonaIds);
    return { status: "ok", impacto };
  }
}
