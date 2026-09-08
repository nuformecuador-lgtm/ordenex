import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CobroTiendaTxRunner,
  ICobroTiendaService,
  RegistrarCobroTiendaServiceResult,
} from "@/lib/interfaces/services/ICobroTiendaService";
import type { RegistrarCobroTiendaInput } from "@/lib/types/wallet-tienda";
import { instanteDelMovimientoManual } from "@/lib/utils/fecha-movimiento-manual";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

/** El unico rol que puede ser destinataria de un cobro: una cuenta de tienda de verdad. */
const ROL_TIENDA = "adminTienda";

/** El unico estado de la tienda que admite un cobro nuevo. */
const ESTADO_TIENDA = "activo";

/**
 * Los tres rechazos de la tienda, SEPARADOS a proposito (molde: `ApiKeyService`). Devolver el mismo
 * texto para los tres dejaria a quien registra sin saber cual arreglar.
 */
const MSG_TIENDA = {
  inexistente: "La tienda no existe",
  rol: "La cuenta elegida no es una tienda",
  inactiva: "La tienda no esta activa",
} as const;

function errorDeTienda(mensaje: string): RegistrarCobroTiendaServiceResult {
  return { status: "validation_error", fieldErrors: { tiendaId: [mensaje] } };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * FICHA 381 — COBRARLE UN COSTO A UNA TIENDA.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un cobro es UNA fila de debito en el libro de ESA tienda, categoria `cobro_manual`, y NADA MAS.
 * Con las palabras del humano (2026-09-07): «mas que marcar como ingreso es quitar del dinero
 * disponible de esa tienda»; «se debita de la plata pendiente por pagar a esa tienda, y si no hay,
 * entonces el disponible debe verse en negativo y cobrarse solo cuando mediante la gestion se le
 * deba dinero a esa tienda».
 *
 * ⚠️ NO TOCA LA CAJA DE ORDENEX (D1, R24). Este archivo NO importa `WalletMovimientoRepository` ni
 * ningun puerto de caja, y no puede: no lo recibe por constructor. Es la decision convertida en algo
 * que se rompe si alguien la deshace, en vez de una ausencia que nadie vigila.
 *
 * ⚠️ SIN CANDADO Y SIN COMPROBACION DE DISPONIBLE, Y ES DELIBERADO (R27). `registrarPagoTienda` toma
 * `bloquearBeneficiario` porque COMPARA el monto contra un disponible, y dos transacciones
 * simultaneas pagarian de mas. Un cobro no compara nada contra nada: no hay tope, el saldo puede
 * quedar negativo por decision firmada, y el saldo se deriva de la suma del ledger, que es correcta
 * con cualquier orden de insercion. Tomar un candado que no protege ninguna invariante seria
 * serializar escrituras por ceremonia.
 *
 * ⚠️ SERVICIO PROPIO Y NO UN METODO EN `WalletTiendaService`: aquel es de LECTURA —listados, saldos,
 * desglose, cierres—, se construye con un solo repositorio y lo instancian siete acciones. Meterle
 * una escritura le añadiria el repositorio de usuarios y el runner de transacciones al constructor,
 * tocando a todos sus llamadores por una razon que no es suya. `LiquidacionService` es el precedente
 * explicito: las escrituras de dinero viven en su propio servicio.
 */
export class CobroTiendaService implements ICobroTiendaService {
  constructor(
    private readonly tiendaRepo: IWalletTiendaMovimientoRepository,
    private readonly usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
    private readonly runTransaction: CobroTiendaTxRunner,
  ) {}

  /**
   * EL ORDEN DE LOS PASOS ES PARTE DEL REQUISITO:
   *
   *  1. ROL PRIMERO (R12), ANTES de tocar la base. Un `forbidden` evaluado despues del `SELECT` ya
   *     habria leido el dinero para tirarlo. Mismo predicado y mismo motivo que
   *     `WalletService.registrarMovimientoManual` y `LiquidacionService.registrarPagoTienda`.
   *  2. ESCALA 2 FIJADA UNA VEZ (R18). El MISMO string va al asiento y a la fila del historial, asi
   *     que libro y rastro no pueden discrepar por un redondeo. Ni un `Number()` en el camino: es la
   *     leccion medida de la feature 204 (14 de 66 ordenes con un centimo de desviacion).
   *  3. LA TIENDA, VALIDADA EN EL SERVIDOR (R17). Va FUERA de la transaccion: es una lectura de
   *     catalogo, y lo peor que puede pasar es que la tienda se desactive un instante despues, lo
   *     cual no invalida un cobro ya decidido.
   *  4. `id` generado AQUI: `createMany` sobre Postgres no devuelve los ids, y la fila de historial
   *     lo necesita como `entidad_id`.
   *  5. LAS DOS ESCRITURAS EN UNA TRANSACCION (R25/R42): el asiento y su rastro, o ninguno.
   *  6. El saldo DESPUES, derivado del ledger. Puede ser negativo y se devuelve entero (R27).
   */
  async registrarCobro(
    input: RegistrarCobroTiendaInput,
    actor: Actor,
  ): Promise<RegistrarCobroTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R12: antes de tocar la base

    // R18: escala 2 fijada UNA vez, desde el STRING. `montoStr` es lo unico que viaja de aqui en
    // adelante — al asiento y al historial.
    const montoStr = new Prisma.Decimal(input.monto)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);

    // R17: existe / es cuenta de tienda / esta activa. Tres mensajes distintos, todos bajo
    // `tiendaId`, y NINGUNO escribe nada.
    const cuenta = await this.usuarioRepo.obtenerCuentaTienda(input.tiendaId);
    if (cuenta === null) return errorDeTienda(MSG_TIENDA.inexistente);
    if (cuenta.rol !== ROL_TIENDA) return errorDeTienda(MSG_TIENDA.rol);
    if (cuenta.estado !== ESTADO_TIENDA) return errorDeTienda(MSG_TIENDA.inactiva);

    const id = randomUUID();
    // R21: con «hoy» (o sin fecha) la clave NO viaja y manda el `DEFAULT CURRENT_TIMESTAMP` de la
    // columna, igual que los otros cuatro conceptos manuales. Con una fecha anterior, el instante en
    // que ese dia EMPIEZA en Costa Rica.
    const fechaMovimiento = instanteDelMovimientoManual(input.fecha);

    await this.runTransaction(async (tx) => {
      // R19/R20/R23: UNA fila. Debito, categoria propia de los cobros, `origen_tipo: manual` y
      // `origen_id: null` (con lo que queda FUERA del indice unico parcial: los manuales no se
      // deduplican, igual que el ajuste manual de caja de hoy). Ningun movimiento derivado: un cobro
      // manual no tiene tarifa detras, asi que no lleva IVA aparte.
      await this.tiendaRepo.crearMovimientos(tx, [
        {
          id,
          tiendaId: input.tiendaId,
          tipo: "debito",
          categoria: "cobro_manual",
          monto: montoStr,
          origenTipo: "manual",
          origenId: null,
          descripcion: input.descripcion,
          registradoPor: actor.usuarioId,
          ...(fechaMovimiento !== undefined ? { fechaMovimiento } : {}),
        },
      ]);
      // R40/R41/R42: el rastro, en LA MISMA transaccion y por el MISMO importe.
      await this.tiendaRepo.registrarCobroEnHistorial(tx, {
        cobroId: id,
        tiendaId: input.tiendaId,
        monto: montoStr,
        actorUsuarioId: actor.usuarioId,
      });
    });

    // Se relee POR ID Y POR TIENDA, no «el mas reciente de esta categoria»: con una fecha del pasado
    // el mas reciente seria OTRO cobro, y el servicio afirmaria «este es el que registraste» sobre
    // una fila ajena. Es la leccion escrita de la ficha 334.
    const cobro = await this.tiendaRepo.obtenerPorIdDeTienda(id, input.tiendaId);
    if (cobro === null) {
      // Imposible por construccion (el cobro lleva `origen_id NULL`, queda fuera del indice unico
      // parcial y por tanto NUNCA se deduplica). Se propaga con contexto en vez de devolver una fila
      // inventada: en un libro de dinero, mentir es peor que fallar.
      throw new Error(`cobro-tienda: el cobro ${id} no se pudo releer tras insertarlo`);
    }

    // R26/R27: el saldo DESPUES del cobro, derivado del ledger entero (sin filtros) y con su signo
    // calculado en el SERVIDOR. PUEDE ser negativo, y se devuelve entero: ni se recorta a cero, ni
    // se esconde, ni se trata como error.
    const agregado = await this.tiendaRepo.agregarSaldoPorTienda(input.tiendaId, {});
    const saldo = derivarSaldoTienda(agregado.creditos, agregado.debitos);

    return { status: "ok", cobro, saldo };
  }
}
