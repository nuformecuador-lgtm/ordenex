// El servicio del DESGLOSE DE DEVOLUCIONES POR CAUSA: cache de 15 min, sello `lastSync`,
// el total y —lo propio de esta lectura— LA TRADUCCION del motivo.
//
// Quinto gemelo de la vertical, con las mismas responsabilidades que los otros cuatro y una
// mas. Depende de DOS puertos neutrales (`IConteoDevolucionesRepository`, `IAnaliticaCache`) y
// de un reloj inyectable, asi que se ejercita entero en unitario: sin `DATABASE_URL` y sin
// runtime de Next.

import { claveDeConteoDevoluciones, TAG_CONTEO_DEVOLUCIONES } from "@/lib/analytics/entregas-conteo";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoDevolucionesRepository } from "@/lib/interfaces/repositories/IConteoDevolucionesRepository";
import { MOTIVO_DE_CAUSA } from "@/lib/types/conteo-devoluciones";
import type { ConteoDeCausa, ConteoDevolucionesDTO } from "@/lib/types/conteo-devoluciones";

export interface ConteoDevolucionesServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global. */
  readonly now?: () => Date;
}

/**
 * De la causa cruda al motivo que pinta el cliente. Funcion PURA y exportada: es la unica
 * decision propia de este servicio y se comprueba sin cache ni base de datos.
 *
 * ⚠ UNA CAUSA DESCONOCIDA VIAJA CON SU VALOR CRUDO, no se descarta y no se renombra a «otros».
 * No deberia pasar —el mapa cubre el enum entero— pero un valor anadido en la base y no en el
 * codigo lo produciria. Las tres salidas posibles, por orden de lo malo que es cada una:
 * traducir (correcto), mostrar `not_found` en la leyenda (feo, y evidentemente un bug), u
 * omitir la fila (una devolucion que desaparece de la cuenta y un total que no cuadra). Se
 * elige la segunda: fea pero honesta y detectable.
 */
export function traducirCausa(causa: string, conteo: number): ConteoDeCausa {
  return { causa, motivo: MOTIVO_DE_CAUSA[causa] ?? causa, conteo };
}

export class ConteoDevolucionesService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IConteoDevolucionesRepository,
    private readonly cache: IAnaliticaCache,
    opts: ConteoDevolucionesServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * El desglose de una consulta ya validada y ya recortada — la MISMA `ConsultaConteoEntregas`
   * que consumen las otras cuatro lecturas, para que la barra las mueva a todas a la vez.
   *
   * ⚠ EL ORDEN IMPORTA: **`lastSync` se sella DENTRO del productor**, no fuera. El productor es
   * el unico codigo que corre en un fallo de cache, o sea el unico momento en que se toca la
   * base. Sellarlo fuera escribiria la hora del render en cada ACIERTO, que son todas las
   * peticiones menos la primera de cada ventana de 15 min.
   *
   * La TRADUCCION tambien va dentro: lo que se cachea es el DTO ya traducido, asi que un
   * acierto de cache no vuelve a mapear nada. Si el mapa cambiara, las entradas vivas seguirian
   * sirviendo el texto viejo hasta 15 minutos — que es el mismo trato que reciben las cifras y
   * el precio conocido de esta cache.
   */
  async consultar(consulta: ConsultaConteoEntregas): Promise<ConteoDevolucionesDTO> {
    const clave = claveDeConteoDevoluciones(consulta);

    return this.cache.envolver<ConteoDevolucionesDTO>(clave, [TAG_CONTEO_DEVOLUCIONES], async () => {
      const crudas = await this.repo.contarDevolucionesPorCausa(consulta);
      const porCausa = crudas.map((fila) => traducirCausa(fila.causa, fila.conteo));

      // El total se DERIVA de las mismas filas que viajan, no se pide aparte. Asi no puede
      // discrepar de sus partes: si saliera de una segunda consulta, una gestion registrada
      // entre las dos dejaria en pantalla un total que no es la suma de lo que hay debajo.
      return {
        porCausa,
        total: porCausa.reduce((suma, fila) => suma + fila.conteo, 0),
        // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server
        // Action, y una cadena viaja igual la serialice quien la serialice.
        lastSync: this.now().toISOString(),
      };
    });
  }
}
