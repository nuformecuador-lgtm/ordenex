// El servicio del desglose por status: cache de 15 min, sello `lastSync` y el total.
//
// Gemelo de `ConteoEntregasService` y con las mismas tres responsabilidades. No se fundieron
// en uno con un parametro: comparten el FILTRO (por eso comparten `ConsultaConteoEntregas`),
// pero devuelven formas distintas y se cachean bajo prefijos distintos. Un servicio con un
// `modo` dentro tendria dos tipos de retorno y un `switch` en cada llamador.

import { claveDeConteoPorStatus, TAG_CONTEO_POR_STATUS } from "@/lib/analytics/entregas-conteo";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoPorStatusRepository } from "@/lib/interfaces/repositories/IConteoPorStatusRepository";
import type { ConteoPorStatusDTO } from "@/lib/types/conteo-por-status";

export interface ConteoPorStatusServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global. */
  readonly now?: () => Date;
}

export class ConteoPorStatusService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IConteoPorStatusRepository,
    private readonly cache: IAnaliticaCache,
    opts: ConteoPorStatusServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * El desglose de una consulta ya validada y ya recortada.
   *
   * ⚠ `lastSync` se sella DENTRO del productor, no fuera — el mismo motivo que en
   * `ConteoEntregasService`: el productor es el unico codigo que corre en un fallo de cache, o
   * sea el unico momento en que se toca la base. Sellarlo fuera escribiria la hora del render
   * en cada ACIERTO, que son todas las peticiones menos la primera de cada ventana de 15 min.
   *
   * La clave lleva su propio PREFIJO (`claveDeConteoPorStatus`). No es cosmetica: esta lectura
   * comparte `ConsultaConteoEntregas` entera con el conteo entregadas/no-entregadas, asi que
   * sin prefijo las dos producirian la MISMA clave con valores de forma distinta.
   */
  async consultar(consulta: ConsultaConteoEntregas): Promise<ConteoPorStatusDTO> {
    const clave = claveDeConteoPorStatus(consulta);

    return this.cache.envolver<ConteoPorStatusDTO>(clave, [TAG_CONTEO_POR_STATUS], async () => {
      const porStatus = await this.repo.contarPorStatus(consulta);

      // El total se DERIVA de los mismos buckets que viajan, no se pide aparte. Asi no puede
      // discrepar de sus partes: si saliera de una segunda consulta, una escritura entre las
      // dos dejaria en pantalla un total que no es la suma de lo que hay debajo.
      return {
        porStatus,
        total: porStatus.reduce((suma, fila) => suma + fila.conteo, 0),
        // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server
        // Action, y una cadena viaja igual la serialice quien la serialice.
        lastSync: this.now().toISOString(),
      };
    });
  }
}
