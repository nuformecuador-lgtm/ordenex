// Feature 179 (T3.3, R11 / R8) — LA INVALIDACION DE LA LIQUIDACION, EN UN DECORADOR.
//
// ═══ POR QUE ESTE ARCHIVO EXISTE: DOS SPECS SE CONTRADECIAN ══════════════════════════════════
//
// `design.md §5.2` de la 179 dice que invalida «la pieza que POSEE la transaccion, justo despues
// de que confirme», y para la liquidacion esa pieza es `LiquidacionService`. Se hizo asi, y
// **un guardia de la feature 172 lo rechazo**:
//
//   tests/unit/guards/liquidacion-alcance.test.ts › «R68 / R40 [P2] / R62: la caja entra SOLO
//   por la puerta de la tienda, y **el catalogo de metricas no entra**»
//     → `expect(fuente).not.toMatch(/from\s+"@\/lib\/analytics/)`
//
// Ese guardia prohibe importar NADA de `@/lib/analytics` en los archivos de la 172, y su lista
// incluye **tanto `lib/services/LiquidacionService.ts` como `lib/actions/liquidacion.ts`**. O
// sea: ni el servicio ni su Server Action pueden nombrar el modulo de invalidacion. No es un
// despiste de nadie — es una prohibicion escrita, con motivo, de una feature de dinero.
//
// **La salida no es relajar el guardia ajeno ni forzar la 179: es un decorador.** Este archivo no
// esta en la lista de la 172, implementa `ILiquidacionService` entero, delega en el servicio real
// y **invalida despues** de que cada operacion haya resuelto. Con eso:
//
//   · el guardia de la 172 vuelve a verde SIN tocarlo — `LiquidacionService` ya no importa
//     analitica, ni la nombra, ni recibe el puerto de cache;
//   · R8 se sigue cumpliendo, y de forma MAS visible: la invalidacion no puede estar dentro de
//     la `$transaction` ni por accidente, porque ocurre cuando el metodo del servicio interno YA
//     devolvio — o sea, despues del commit. Antes era una linea bien colocada; ahora es una
//     imposibilidad estructural;
//   · R16/D4 no cambia: se llama a `invalidarAnaliticaFinanciera`, que NO propaga y deja
//     constancia;
//   · R24 no cambia: el origen sigue siendo `ledger_liquidacion`, el suyo y de nadie mas.
//
// ═══ LO QUE SE PIERDE, DICHO SIN DISIMULAR ══════════════════════════════════════════════════
//
// `design.md §5.2` descarta invalidar «demasiado arriba» con un motivo exacto: «un servicio
// llamado desde otro sitio se escaparia». Un decorador tiene esa debilidad — quien construya
// `LiquidacionService` en un composition root nuevo sin envolverlo, no invalidara. Hoy no puede
// pasar (`lib/actions/liquidacion.ts` es el UNICO sitio del arbol donde se construye, censado en
// `lib/analytics/escritores-ledger.ts`), y el censo de R17 seguiria viendo al servicio como
// escritor. **Pero el censo comprueba que el escritor esta registrado, no que su decorador este
// cableado**, asi que ese hueco existe y esta cubierto por el test de cableado del composition
// root en `cache-financiera-escritor-liquidacion.test.ts`, no por el censo.
//
// ═══ POR QUE SOLO ESTE ESCRITOR Y NO LOS SIETE ══════════════════════════════════════════════
//
// Los otros siete invalidan DENTRO de su servicio, que es lo que `design.md §5.2` manda y lo que
// da la garantia mas fuerte: no depende de que nadie recuerde envolver nada. Uniformar los ocho a
// decoradores seria cambiar la decision de §5.2 para toda la feature a cambio de estetica, y
// perder esa garantia en siete sitios donde no hay ninguna frontera ajena que respetar. La
// asimetria es deliberada, esta escrita aqui, en la entrada de `escritores-ledger.ts` y en la
// bitacora, que son los tres sitios donde alguien la va a encontrar.

import { invalidarAnaliticaFinanciera } from "@/lib/analytics/invalidacion-financiera";
import { cacheNula } from "@/lib/cache/cache-nula";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnularPagoServiceResult,
  ILiquidacionService,
  ListarPagosServiceResult,
  RegistrarPagoServiceResult,
} from "@/lib/interfaces/services/ILiquidacionService";
import type {
  AnularPagoInput,
  RegistrarPagoMensajeroInput,
  RegistrarPagoTiendaInput,
} from "@/lib/types/liquidacion";

export class LiquidacionConInvalidacionService implements ILiquidacionService {
  constructor(
    private readonly interno: ILiquidacionService,
    private readonly cache: IAnaliticaCache,
  ) {}

  /**
   * R11/R8 — invalida **solo si la operacion escribio**, y siempre despues de que la
   * transaccion del servicio interno haya confirmado.
   *
   * Las ramas que no mueven dinero —`forbidden`, `sin_saldo`, `cierre_no_aprobado`,
   * `no_encontrado`, `ya_registrado`, `ya_anulado`— no tiran la cache de nadie: vaciar la cache
   * financiera por una operacion que fue no-op es coste sin motivo.
   */
  private async trasEscribir<T extends { status: string }>(resultado: T): Promise<T> {
    if (resultado.status === "ok") {
      await invalidarAnaliticaFinanciera(this.cache, "ledger_liquidacion");
    }
    return resultado;
  }

  async registrarPagoMensajero(
    input: RegistrarPagoMensajeroInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult> {
    return this.trasEscribir(await this.interno.registrarPagoMensajero(input, actor));
  }

  async registrarPagoTienda(
    input: RegistrarPagoTiendaInput,
    actor: Actor,
  ): Promise<RegistrarPagoServiceResult> {
    return this.trasEscribir(await this.interno.registrarPagoTienda(input, actor));
  }

  async anularPago(input: AnularPagoInput, actor: Actor): Promise<AnularPagoServiceResult> {
    return this.trasEscribir(await this.interno.anularPago(input, actor));
  }

  /* --- Lecturas: delegacion pura. No mueven dinero, no invalidan. ------------------------- */

  async listarPagosDeCierre(cierreId: string, actor: Actor): Promise<ListarPagosServiceResult> {
    return this.interno.listarPagosDeCierre(cierreId, actor);
  }

  async listarPagosDeTienda(tiendaId: string, actor: Actor): Promise<ListarPagosServiceResult> {
    return this.interno.listarPagosDeTienda(tiendaId, actor);
  }
}

/**
 * Azucar para el composition root, con el mismo patron de `decorarFinancieraConCache`: el
 * default `cacheNula()` mantiene el comportamiento de las suites de la 172/173, que construyen
 * el servicio sin saber nada de cache.
 */
export function decorarLiquidacionConInvalidacion(
  interno: ILiquidacionService,
  cache: IAnaliticaCache = cacheNula(),
): ILiquidacionService {
  return new LiquidacionConInvalidacionService(interno, cache);
}
