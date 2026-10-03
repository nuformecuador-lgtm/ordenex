import type { DescargaConfigEnv } from "@/lib/config/descarga";
import type { IAlmacenDescargas } from "@/lib/interfaces/external/IAlmacenDescargas";
import type { IPurgaDescargasService, PurgaDescargasResultado } from "@/lib/interfaces/services/IPurgaDescargasService";

/** Objetos borrados como maximo por corrida (design §3.3): el resto lo retoma la siguiente (cada 15 min). */
export const MAX_OBJETOS_POR_CORRIDA = 5000;

const MINUTO_MS = 60 * 1000;

/** Lector de configuracion inyectado; se invoca EN CADA corrida (el proceso serverless sobrevive). */
export type LeerDescargaConfig = () => Pick<DescargaConfigEnv, "RETENCION_MINUTOS">;

/**
 * Ficha 470 (design §3.6, R17/R20) — la barrida periodica del bucket de descargas. No conoce HTTP ni
 * Storage concreto: el almacen y el lector de config entran por constructor (dobles en los tests).
 * Idempotente: lo que ya no existe no se cuenta, y una corrida que falla se repite en la siguiente.
 */
export class PurgaDescargasService implements IPurgaDescargasService {
  constructor(
    private readonly almacen: IAlmacenDescargas,
    private readonly leerConfig: LeerDescargaConfig,
  ) {}

  async ejecutar(now: Date): Promise<PurgaDescargasResultado> {
    const corte = new Date(now.getTime() - this.leerConfig().RETENCION_MINUTOS * MINUTO_MS);
    const r = await this.almacen.purgarAnterioresA(corte, MAX_OBJETOS_POR_CORRIDA);
    return { objetosBorrados: r.borrados, quedaPendiente: r.quedaPendiente };
  }
}
