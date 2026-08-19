// El servicio de las ORDENES CARGADAS POR DIA: cache de 15 min, sello `lastSync` y el total.
//
// Tercer gemelo de `ConteoEntregasService` y `ConteoPorStatusService`, con las mismas tres
// responsabilidades y ninguna consulta propia. Depende de DOS puertos neutrales
// (`IConteoCargadasPorDiaRepository`, `IAnaliticaCache`) y de un reloj inyectable, asi que se
// ejercita entero en unitario: sin `DATABASE_URL` y sin runtime de Next.
//
// POR QUE UN TERCER SERVICIO Y NO UN PARAMETRO EN LOS OTROS DOS: los tres comparten el FILTRO
// —por eso comparten `ConsultaConteoEntregas`, y por eso la misma barra los mueve a los tres a
// la vez— pero devuelven formas distintas y se cachean bajo prefijos distintos. Un servicio con
// un `modo` dentro tendria tres tipos de retorno y un `switch` en cada llamador.

import {
  claveDeConteoCargadasPorDia,
  TAG_CONTEO_CARGADAS_POR_DIA,
} from "@/lib/analytics/entregas-conteo";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoCargadasPorDiaRepository } from "@/lib/interfaces/repositories/IConteoCargadasPorDiaRepository";
import type { ConteoCargadasPorDiaDTO } from "@/lib/types/conteo-cargadas";

export interface ConteoCargadasPorDiaServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global. */
  readonly now?: () => Date;
}

export class ConteoCargadasPorDiaService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IConteoCargadasPorDiaRepository,
    private readonly cache: IAnaliticaCache,
    opts: ConteoCargadasPorDiaServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * La serie de una consulta ya validada y ya recortada — la MISMA `ConsultaConteoEntregas` que
   * consumen el anillo de desenlaces y el desglose por status, de modo que las tres lecturas de
   * la pantalla respondan siempre al mismo recorte.
   *
   * ⚠ EL ORDEN IMPORTA: **`lastSync` se sella DENTRO del productor**, no fuera. El productor es
   * el unico codigo que corre en un fallo de cache, o sea el unico momento en que se toca la
   * base de verdad. Sellarlo fuera —sobre el valor ya devuelto— escribiria la hora del render
   * en cada ACIERTO, que son todas las peticiones menos la primera de cada ventana de 15 min:
   * la pantalla juraria que la serie es de este segundo llevando hasta un cuarto de hora de
   * retraso. El sello dice cuando se LEYERON las cifras, y por eso viaja dentro del valor
   * cacheado.
   *
   * La clave lleva el ALCANCE y su propio PREFIJO (`claveDeConteoCargadasPorDia`), y las dos
   * cosas son seguridad y correccion, no higiene: sin el alcance, la entrada que se cacheo para
   * un admin la serviria un adminTienda; sin el prefijo, esta lectura y las otras dos —que
   * comparten la consulta entera— colisionarian en la MISMA clave con valores de forma
   * distinta.
   */
  async consultar(consulta: ConsultaConteoEntregas): Promise<ConteoCargadasPorDiaDTO> {
    const clave = claveDeConteoCargadasPorDia(consulta);

    return this.cache.envolver<ConteoCargadasPorDiaDTO>(
      clave,
      [TAG_CONTEO_CARGADAS_POR_DIA],
      async () => {
        const porDia = await this.repo.contarCargadasPorDia(consulta);

        // El total se DERIVA de los mismos dias que viajan, no se pide aparte. Asi no puede
        // discrepar de sus partes: si saliera de una segunda consulta, una escritura entre las
        // dos dejaria en pantalla un total que no es la suma de lo que hay debajo.
        return {
          porDia,
          total: porDia.reduce((suma, fila) => suma + fila.conteo, 0),
          // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server
          // Action, y una cadena viaja igual la serialice quien la serialice. Un `Date` a
          // traves de esa frontera depende del serializador y no de nosotros.
          lastSync: this.now().toISOString(),
        };
      },
    );
  }
}
