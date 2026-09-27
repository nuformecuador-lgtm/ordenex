import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IComoQuedoRepository } from "@/lib/interfaces/repositories/IComoQuedoRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { ComoQuedoServiceResult, IComoQuedoService } from "@/lib/interfaces/services/IComoQuedoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { LectorSaldoInicial } from "@/lib/interfaces/services/IWalletService";
import type { ComoQuedoDTO, ComoQuedoInput } from "@/lib/types/como-quedo";
import { derivarCaja } from "@/lib/utils/caja-tesoreria";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

/**
 * FICHA 458-B (design §3.7, R58) — «Cómo quedó»: `derivarCaja` sobre las lineas de la caja hasta el
 * movimiento (o hasta su contrapartida en la caja) y el saldo de la cuenta afectada tras el. Sin
 * derivaciones nuevas: las tres funciones puras de siempre sobre agregados hasta una posicion.
 *
 * Desviacion anotada (impl): el design lo pone «en `EstadoCuentaService`/`WalletService`»; va en un
 * servicio propio para no ensanchar dos constructores que construyen decenas de tests y la 458-A.
 */
export class ComoQuedoService implements IComoQuedoService {
  constructor(
    private readonly repo: IComoQuedoRepository,
    private readonly caja: Pick<IWalletMovimientoRepository, "primerDiaDeLaCaja">,
    private readonly saldoInicial: LectorSaldoInicial,
  ) {}

  async comoQuedo(input: ComoQuedoInput, actor: Actor): Promise<ComoQuedoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R82: antes de leer

    const { libro, movimientoId } = input.destino;
    const fila = await this.repo.fila(libro, movimientoId);
    if (fila === null) return { status: "no_encontrado" };

    let cajaFilaId: string | null;
    let cuenta: { tipo: "tienda" | "mensajero"; id: string; filaId: string } | null = null;
    if (libro === "caja") {
      cajaFilaId = fila.id;
      const cuentas = await this.repo.cuentasDeFilaCaja(fila.id);
      // La cuenta afectada es UNA: si la contrapartida reparte entre varias (un cierre), no hay una.
      const todas = [
        ...cuentas.tiendas.map((t) => ({ tipo: "tienda" as const, id: t.tiendaId, filaId: t.filaId })),
        ...cuentas.mensajeros.map((m) => ({ tipo: "mensajero" as const, id: m.mensajeroId, filaId: m.filaId })),
      ];
      cuenta = todas.length === 1 ? todas[0] : null;
    } else {
      cajaFilaId = await this.repo.cajaDeFila(libro, fila.id);
      cuenta = { tipo: libro, id: fila.cuentaId as string, filaId: fila.id };
    }

    const dto: ComoQuedoDTO = { caja: null, cuenta: null };
    if (cajaFilaId !== null) {
      const resumen = derivarCaja(await this.repo.agregadoCajaHasta(cajaFilaId), {
        haySaldoInicialVigente: await this.saldoInicial.haySaldoInicialVigente(),
        primerDia: await this.caja.primerDiaDeLaCaja(),
      });
      dto.caja = {
        cifraPrincipal: resumen.enCaja,
        rotulo: resumen.estado,
        ganancia: resumen.ganancia,
        deTiendas: resumen.deTerceros,
        capital: resumen.capital,
      };
    }
    if (cuenta !== null) {
      const saldo =
        cuenta.tipo === "tienda"
          ? await this.repo.saldoTiendaHasta(cuenta.id, cuenta.filaId).then((s) => derivarSaldoTienda(s.creditos, s.debitos).saldo)
          : await this.repo
              .cuentaMensajeroHasta(cuenta.id, cuenta.filaId)
              .then((s) => derivarCuentaPorPagar(s.devengado, s.pagado).cuentaPorPagar);
      dto.cuenta = { tipo: cuenta.tipo, id: cuenta.id, saldo };
    }
    return { status: "ok", comoQuedo: dto };
  }
}
