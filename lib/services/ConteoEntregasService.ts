// El servicio del conteo de entregas: cache de 15 min, sello `lastSync` y la resta.
//
// Tres responsabilidades y ninguna consulta propia. Depende de DOS puertos neutrales
// (`IConteoEntregasRepository`, `IAnaliticaCache`) y de un reloj inyectable, asi que se
// ejercita entero en unitario: sin `DATABASE_URL` y sin runtime de Next.

import { claveDeConteoEntregas, TAG_CONTEO_ENTREGAS } from "@/lib/analytics/entregas-conteo";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoEntregasRepository } from "@/lib/interfaces/repositories/IConteoEntregasRepository";
import type { ConteoEntregasDTO } from "@/lib/types/conteo-entregas";

export interface ConteoEntregasServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global. */
  readonly now?: () => Date;
}

export class ConteoEntregasService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IConteoEntregasRepository,
    private readonly cache: IAnaliticaCache,
    opts: ConteoEntregasServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * El conteo de una consulta ya validada y ya recortada.
   *
   * ⚠ EL ORDEN IMPORTA, y es lo unico delicado de este archivo: **`lastSync` se sella DENTRO
   * del productor**, no fuera. El productor es el unico codigo que corre en un fallo de
   * cache, es decir, el unico momento en que se toca la base de verdad. Sellarlo fuera —sobre
   * el valor ya devuelto— escribiria la hora del render en cada ACIERTO de cache, que son
   * todas las peticiones menos la primera de cada ventana de 15 min: la pantalla juraria que
   * la cifra es de este segundo llevando hasta un cuarto de hora de retraso. El sello dice
   * cuando se LEYERON las cifras, y por eso viaja dentro del valor cacheado.
   *
   * La clave incluye el ALCANCE (`claveDeConteoEntregas`), y eso es seguridad, no higiene:
   * sin el, la entrada que se cacheo para un admin la serviria un adminTienda.
   */
  async consultar(consulta: ConsultaConteoEntregas): Promise<ConteoEntregasDTO> {
    const clave = claveDeConteoEntregas(consulta);

    return this.cache.envolver<ConteoEntregasDTO>(clave, [TAG_CONTEO_ENTREGAS], async () => {
      const { porDesenlace } = await this.repo.contar(consulta);

      // El total se DERIVA sumando los seis buckets, no se consulta aparte. Es lo que hace
      // que `suma de segmentos = total` sea cierto por CONSTRUCCION: si saliera de una
      // segunda consulta, una escritura entre las dos dejaria en pantalla un total que no es
      // la suma de lo que hay debajo (ver `ConteoEntregasDTO`).
      return {
        porDesenlace,
        total: Object.values(porDesenlace).reduce((suma, n) => suma + n, 0),
        // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server
        // Action, y una cadena viaja igual la serialice quien la serialice. Un `Date` a
        // traves de esa frontera depende del serializador y no de nosotros.
        lastSync: this.now().toISOString(),
      };
    });
  }
}
