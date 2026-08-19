// El servicio del CONTADOR DE HOY: resuelve el dia, cachea 15 min, sella `lastSync` y suma.
//
// Cuarto de la familia (`ConteoEntregasService`, `ConteoPorStatusService`,
// `ConteoCargadasPorDiaService`) y el unico con una responsabilidad de mas: **decidir que dia es
// hoy**. Las otras tres reciben la ventana ya resuelta dentro de la consulta; esta no recibe
// ninguna —no acepta filtro de fecha— asi que el «hoy» lo pone el reloj INYECTADO de este
// servicio y de ningun otro sitio.
//
// Sigue sin consultar nada: depende de DOS puertos neutrales (`IConteoHoyGestionRepository`,
// `IAnaliticaCache`) y del reloj, asi que se ejercita entero en unitario sin `DATABASE_URL` y
// sin runtime de Next.

import { claveDeConteoHoyGestion, TAG_CONTEO_HOY_GESTION } from "@/lib/analytics/entregas-conteo";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { resolverRango } from "@/lib/analytics/ranges";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoHoyGestionRepository } from "@/lib/interfaces/repositories/IConteoHoyGestionRepository";
import type { ConteoHoyGestionDTO } from "@/lib/types/conteo-hoy-gestion";

export interface ConteoHoyGestionServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido, ningun test falseando el reloj global.
   *  Aqui pesa mas que en sus tres hermanos, porque de este reloj sale QUE DIA se cuenta. */
  readonly now?: () => Date;
}

export class ConteoHoyGestionService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IConteoHoyGestionRepository,
    private readonly cache: IAnaliticaCache,
    opts: ConteoHoyGestionServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Las dos cifras del dia en curso para una consulta ya validada y ya recortada.
   *
   * De la consulta se usan el ALCANCE y las cinco facetas de recorte; se IGNORAN la ventana
   * (`rango`) y el mensajero — ver `ConteoHoyGestionDTO`, donde esta escrito por que y que
   * tiene que decir la pantalla al respecto.
   *
   * ⚠ EL DIA SE RESUELVE FUERA DEL PRODUCTOR, y esto es lo contrario que `lastSync`: el dia
   * forma parte de la CLAVE, asi que tiene que estar decidido ANTES de preguntarle a la cache.
   * Resolverlo dentro serviria la entrada de ayer despues de medianoche durante lo que quedara
   * del TTL. `lastSync`, en cambio, se sella DENTRO —es el unico momento en que se toca la base
   * de verdad—; sellarlo fuera escribiria la hora del render en cada ACIERTO de cache y la
   * pantalla juraria que la cifra es de este segundo llevando hasta 15 minutos de retraso.
   *
   * El dia sale de `resolverRango({ preset: "dia" }, now)` y no de aritmetica propia: es la
   * UNICA definicion del dia operativo del repo (00:00-24:00 de Costa Rica), y calcularlo aqui
   * a mano reintroduciria el off-by-one de seis horas del que avisa `lib/analytics/ranges.ts`.
   */
  async consultar(consulta: ConsultaConteoEntregas): Promise<ConteoHoyGestionDTO> {
    const dia = resolverRango({ preset: "dia" }, this.now());
    const clave = claveDeConteoHoyGestion(consulta, dia);

    return this.cache.envolver<ConteoHoyGestionDTO>(clave, [TAG_CONTEO_HOY_GESTION], async () => {
      const { sinGestion, conGestion } = await this.repo.contarDeHoy(consulta, dia);

      // El total se DERIVA de las dos cifras que viajan, no se consulta aparte. Asi no puede
      // discrepar de sus partes: si saliera de una segunda consulta, una gestion registrada
      // entre las dos dejaria en pantalla dos numeros que no suman lo que dicen sumar.
      return {
        sinGestion,
        conGestion,
        total: sinGestion + conGestion,
        // La fecha CR del dia contado, tal como la resolvio el servidor. Viaja para que la
        // pantalla no tenga que deducirla —un navegador en otro huso deduciria otra— y para
        // que pueda notar que su contador es de ayer.
        fecha: dia.desdeFecha,
        // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server
        // Action, y una cadena viaja igual la serialice quien la serialice.
        lastSync: this.now().toISOString(),
      };
    });
  }
}
