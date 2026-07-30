// Feature 141 (design §6.3) — orquesta "generar las etiquetas del lote segun el modo +
// persistir la URL donde corresponde". Servicio delgado con DI por constructor: el borde HTTP
// no puede llamar al repositorio (regla de capas de docs/architecture.md) y el generador de
// PDFs (feature 136) no conoce la tabla `carga`. NO captura errores: la politica best-effort
// (try/catch + `etiquetasPdf: { error }`) vive en el borde, igual que en la 136.
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EtiquetasDescargaResultado,
  IEtiquetasDescargaService,
} from "@/lib/interfaces/services/IEtiquetasDescargaService";
import type { IEtiquetasLotePdfService } from "@/lib/interfaces/services/IEtiquetasLotePdfService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";

const VACIO: EtiquetasDescargaResultado = { consolidado: null, porOrden: new Map() };

export class EtiquetasDescargaService implements IEtiquetasDescargaService {
  constructor(
    private readonly etiquetas: IEtiquetasLotePdfService,
    private readonly ordenRepo: IOrdenRepository,
  ) {}

  async generarYPersistir(params: {
    modo: "consolidate" | "individual";
    cargaId: string | null;
    ordenIds: string[];
    actor: Actor;
  }): Promise<EtiquetasDescargaResultado> {
    // R50: sin ordenes creadas no hay nada que generar; no se toca Storage ni la DB.
    if (params.ordenIds.length === 0) return { consolidado: null, porOrden: new Map() };

    if (params.modo === "individual") return this.individual(params);
    return this.consolidado(params);
  }

  /** R47/R53: UN PDF del lote; su URL se persiste en `carga.download_url`. */
  private async consolidado(params: {
    cargaId: string | null;
    ordenIds: string[];
    actor: Actor;
  }): Promise<EtiquetasDescargaResultado> {
    const out = await this.etiquetas.generarYAlmacenar(params.ordenIds, params.actor);
    if (out === null) return { ...VACIO, porOrden: new Map() }; // nada imprimible (R49/R50)

    // `cargaId === null` no puede darse con ordenes creadas (siempre hay lote), pero si
    // ocurriera se devuelve la URL SIN persistirla en vez de inventar una fila: la respuesta
    // no miente y la columna queda NULL, que es el estado consistente de R51.
    if (params.cargaId !== null) {
      await this.ordenRepo.setCargaDownloadUrl(params.cargaId, out.signedUrl);
    }
    return {
      consolidado: { url: out.signedUrl, expiraEnSegundos: out.expiraEnSegundos },
      porOrden: new Map(),
    };
  }

  /** R48/R54: UN PDF por orden; cada URL se persiste en el `orden.download_url` de su orden. */
  private async individual(params: {
    ordenIds: string[];
    actor: Actor;
  }): Promise<EtiquetasDescargaResultado> {
    const generados = await this.etiquetas.generarYAlmacenarPorOrden(
      params.ordenIds,
      params.actor,
    );
    // R49: las ordenes sin etiqueta imprimible no vienen en `generados` -> su `download_url`
    // queda NULL, sin abortar las demas.
    await this.ordenRepo.setOrdenesDownloadUrl(
      generados.map((g) => ({ ordenId: g.ordenId, url: g.signedUrl })),
    );
    return {
      consolidado: null, // R48: en modo individual `carga.download_url` queda NULL
      porOrden: new Map(generados.map((g) => [g.ordenId, g.signedUrl])),
    };
  }
}
