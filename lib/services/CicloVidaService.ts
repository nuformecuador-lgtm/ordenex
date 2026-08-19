// El servicio del CICLO DE VIDA: cache de 15 min, sello `lastSync` y el promedio.
//
// Sexto gemelo de la vertical, con las mismas responsabilidades y ninguna consulta propia.
// Depende de DOS puertos neutrales (`ICicloVidaRepository`, `IAnaliticaCache`) y de un reloj
// inyectable, asi que se ejercita entero en unitario: sin `DATABASE_URL` y sin runtime de Next.

import { claveDeCicloVida, TAG_CICLO_VIDA } from "@/lib/analytics/entregas-conteo";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { ICicloVidaRepository } from "@/lib/interfaces/repositories/ICicloVidaRepository";
import type { CicloVidaDTO } from "@/lib/types/conteo-ciclo-vida";

export interface CicloVidaServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global. */
  readonly now?: () => Date;
}

/**
 * El promedio, o `null` si no hubo ninguna orden cerrada. Funcion PURA y exportada.
 *
 * ⚠ `null` Y NO CERO, y es la unica decision numerica de este archivo. Cero segundos de ciclo
 * es una AFIRMACION —«las ordenes se cerraron al instante»— y lo que ocurrio es que no hubo
 * ninguna que cerrar. Un cero en pantalla se lee como una operacion instantanea, que es
 * justamente lo contrario de «no hay dato».
 *
 * La division NO se redondea aqui: redondear en el servicio le quita al consumidor la
 * posibilidad de elegir la unidad (segundos, horas, dias) sin arrastrar el error. El formateo
 * es de quien pinta.
 */
export function promedioDeCiclo(segundosAcum: number, n: number): number | null {
  return n === 0 ? null : segundosAcum / n;
}

export class CicloVidaService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: ICicloVidaRepository,
    private readonly cache: IAnaliticaCache,
    opts: CicloVidaServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * El tiempo de ciclo de una consulta ya validada y ya recortada — la MISMA
   * `ConsultaConteoEntregas` que consumen las otras cinco lecturas.
   *
   * ⚠ EL ORDEN IMPORTA: **`lastSync` se sella DENTRO del productor**, no fuera. El productor es
   * el unico codigo que corre en un fallo de cache, o sea el unico momento en que se toca la
   * base. Sellarlo fuera escribiria la hora del render en cada ACIERTO, que son todas las
   * peticiones menos la primera de cada ventana de 15 min.
   *
   * El numerador y el denominador viajan JUNTO al promedio, no en su lugar: son lo unico que
   * se puede volver a agregar. Dos recortes se suman por numerador y denominador; promediar
   * promedios da un numero que no corresponde a nada. Es la misma razon por la que el rollup
   * guarda `segCicloAcum` y `segCicloN` y «jamas el promedio».
   */
  async consultar(consulta: ConsultaConteoEntregas): Promise<CicloVidaDTO> {
    const clave = claveDeCicloVida(consulta);

    return this.cache.envolver<CicloVidaDTO>(clave, [TAG_CICLO_VIDA], async () => {
      const { segundosAcum, n } = await this.repo.acumularCiclos(consulta);

      return {
        segundosAcum,
        n,
        promedioSegundos: promedioDeCiclo(segundosAcum, n),
        // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server
        // Action, y una cadena viaja igual la serialice quien la serialice.
        lastSync: this.now().toISOString(),
      };
    });
  }
}
