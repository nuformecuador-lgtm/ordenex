// El servicio del dinero POR DIA: resuelve la ventana, pide el agregado y deriva.
//
// Tres responsabilidades y ninguna consulta propia: depende de UN puerto neutral
// (`IFinanzasDiarioRepository`) y de un reloj inyectable, asi que se ejercita entero en
// unitario sin `DATABASE_URL` y sin runtime de Next.
//
// ─── LA VENTANA LA PONE EL RELOJ, NO EL USUARIO ─────────────────────────────────────────
//
// Esta lectura vive en la seccion financiera, que NO recibe filtros (decision del 2026-08-18),
// asi que la ventana no puede venir de fuera: son los ULTIMOS 30 DIAS de Costa Rica, resueltos
// con `resolverRango({ preset: "mes" })` — el mismo modulo que resuelve «hoy» y «esta semana»
// para el resto de la analitica, no una aritmetica de fechas propia.
//
// ⚠ SUPUESTO DECLARADO: 30 dias no lo pidio nadie. Se elige porque es el preset movil que ya
// existe y porque cabe holgadamente bajo `TOPE_PUNTOS_SERIE` (62 puntos), que es lo que el
// paquete de graficas admite por serie. Aceptar un rango es cambiar la firma de `consultar` y
// nada mas: el repositorio ya recibe la ventana como dos instantes.
//
// ─── SIN CACHE, Y ES DELIBERADO ─────────────────────────────────────────────────────────
//
// Las otras verticales de esta pantalla cachean 15 min porque cuentan ordenes. Esta suma
// DINERO, y una cifra de caja con hasta un cuarto de hora de retraso es la clase de dato que
// alguien concilia contra el banco. Ademas la seccion no tiene filtros, asi que es UNA consulta
// por carga de pantalla y no hay una explosion de claves que amortizar. Si algun dia se cachea,
// `lastSync` ya viaja en el DTO para poder decir la edad de la cifra.

import { resolverRango } from "@/lib/analytics/ranges";
import { derivarFinanzasDiarias } from "@/lib/utils/finanzas-diarias";
import type { IFinanzasDiarioRepository } from "@/lib/interfaces/repositories/IFinanzasDiarioRepository";
import type { FinanzasDiarioDTO } from "@/lib/types/finanzas-diario";

export interface FinanzasDiarioServiceOpts {
  /** Reloj inyectable: ningun `Date.now()` escondido. Aqui decide QUE 30 dias se suman. */
  readonly now?: () => Date;
}

export class FinanzasDiarioService {
  private readonly now: () => Date;

  constructor(
    private readonly repo: IFinanzasDiarioRepository,
    opts: FinanzasDiarioServiceOpts = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Las cuatro cifras del dinero, dia a dia, de la ventana movil de 30 dias.
   *
   * La ventana viaja en el DTO (`desde`/`hasta`) porque la serie OMITE los dias sin movimiento:
   * sin esos dos extremos, quien pinte el eje no puede saber si el hueco del dia 12 es «no se
   * movio dinero» o «la ventana empezaba el 13».
   */
  async consultar(): Promise<FinanzasDiarioDTO> {
    const rango = resolverRango({ preset: "mes" }, this.now());
    const filas = await this.repo.sumarPorDia(rango.desde, rango.hasta);

    return {
      porDia: derivarFinanzasDiarias(filas),
      desde: rango.desdeFecha,
      hasta: rango.hastaFecha,
      // ISO-8601 UTC: el DTO cruza a un componente cliente por la frontera de la Server Action,
      // y una cadena viaja igual la serialice quien la serialice.
      lastSync: this.now().toISOString(),
    };
  }
}
