import { describe, it, expect, vi } from "vitest";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CierreParaPagoDTO,
  ILiquidacionPagoRepository,
  LiquidacionPagoDTO,
} from "@/lib/interfaces/repositories/ILiquidacionPagoRepository";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  LiquidacionTx,
  LiquidacionTxRunner,
} from "@/lib/interfaces/services/ILiquidacionService";
import type {
  CajaPagoTiendaTxClient,
  ICajaPagoTiendaFeedService,
  MovimientoDeCajaDePagoTienda,
} from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";
import { decorarLiquidacionConInvalidacion } from "@/lib/services/LiquidacionConInvalidacionService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";

// Feature 179 / T3.3 — R8: LA INVALIDACION VA DESPUES DEL COMMIT, NUNCA DENTRO.
//
// ⚠ POR QUE ESTO TIENE REQUISITO Y TEST PROPIOS, Y NO ES UN DETALLE DE ESTILO.
//
// Invalidar DENTRO de la transaccion abre una ventana entre la invalidacion y el commit en la
// que una lectura concurrente repuebla la cache **con el estado ANTERIOR**, y esa entrada vive
// el TTL entero (una hora). Nada lanza, nada se registra, ningun test feliz se pone rojo: la
// cifra se congela vieja. Es el peor modo de fallo de esta feature, porque es el unico que
// sobrevive a que todos los demas tests esten verdes.
//
// Se mide con un doble de transaccion que REGISTRA EL ORDEN DE LOS EVENTOS. No se lee el codigo
// ni se cuenta una llamada: se compara la secuencia.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const TX = {} as unknown as LiquidacionTx;

const INPUT_TIENDA = {
  claveIdempotencia: "11111111-1111-4111-8111-111111111111",
  tiendaId: "t1",
  monto: "15000.00",
  metodo: "SINPE" as const,
  referencia: "1234567",
  fechaPago: "2026-07-30",
};

function pagoDTO(): LiquidacionPagoDTO {
  return {
    id: "pago-1",
    mensajeroId: null,
    tiendaId: "t1",
    cierreId: null,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    nota: null,
    fechaPago: "2026-07-30",
    registradoPorNombre: "Ana Admin",
    registradoAt: "2026-08-02T15:04:05.000Z",
    anulacion: null,
  } as LiquidacionPagoDTO;
}

/** El servicio real, con un runner y un puerto de caja que apuntan CUANDO ocurre cada cosa. */
function armar(opciones: { cajaExplota?: boolean } = {}) {
  const eventos: string[] = [];

  const pagoRepo: ILiquidacionPagoRepository = {
    bloquearBeneficiario: vi.fn(async () => {}),
    crear: vi.fn(async () => {
      eventos.push("escribe:documento");
      return { status: "creado" as const, pago: pagoDTO() };
    }),
    obtenerCierreParaPago: vi.fn(async () => ({ id: "c1" }) as unknown as CierreParaPagoDTO),
    obtenerPorClave: vi.fn(async () => null),
    obtenerPorId: vi.fn(async () => pagoDTO()),
    sumarVigentesPorCierre: vi.fn(async () => ({})),
    sumarVigentesPorTienda: vi.fn(async () => "0.00"),
    listarPorCierre: vi.fn(async () => []),
    listarPorTienda: vi.fn(async () => []),
    anular: vi.fn(),
  } as unknown as ILiquidacionPagoRepository;

  const tiendaRepo = {
    crearMovimientos: vi.fn(async () => {
      eventos.push("escribe:ledger-tienda");
      return 1;
    }),
    agregarSaldoPorTienda: vi.fn(async () => ({ creditos: "90000.00", debitos: "0.00" })),
  } as unknown as IWalletTiendaMovimientoRepository;

  const caja: ICajaPagoTiendaFeedService = {
    async emitirEgresoDePago(_tx: CajaPagoTiendaTxClient, _m: MovimientoDeCajaDePagoTienda) {
      if (opciones.cajaExplota === true) throw new Error("la caja exploto dentro de la tx");
      eventos.push("escribe:caja");
      return 1;
    },
    async emitirReversoDeAnulacion() {
      return 1;
    },
  };

  const cache: IAnaliticaCache = {
    async envolver<T>(_c: string, _t: readonly string[], producir: () => Promise<T>): Promise<T> {
      return producir();
    },
    async invalidar(origen: OrigenInvalidacion): Promise<void> {
      eventos.push(`invalida:${origen}`);
    },
  };

  /** El runner: `commit` se apunta cuando el cuerpo YA resolvio, igual que `$transaction`. */
  const runner: LiquidacionTxRunner = async (fn) => {
    eventos.push("tx:abre");
    const r = await fn(TX);
    eventos.push("tx:commit");
    return r;
  };

  // El sujeto es la COMPOSICION de produccion: decorador + servicio. Con la invalidacion en el
  // decorador, «despues del commit» deja de ser una linea bien colocada y pasa a ser una
  // imposibilidad estructural — el decorador ni siquiera ve la `tx`. Este test lo MIDE igual,
  // porque lo que se afirma es la secuencia observada, no donde este escrita la llamada.
  const servicio = decorarLiquidacionConInvalidacion(
    new LiquidacionService(
      pagoRepo,
      tiendaRepo,
      {} as unknown as IPagoMensajeroMovimientoRepository,
      runner,
      caja,
      () => new Date("2026-08-03T12:00:00.000Z"),
    ),
    cache,
  );
  return { servicio, eventos };
}

describe("R8 · la invalidacion no se observa antes del commit", () => {
  it("la secuencia es: abrir, escribir los tres libros, COMMIT y solo entonces invalidar", async () => {
    const { servicio, eventos } = armar();

    const r = await servicio.registrarPagoTienda(INPUT_TIENDA, MAESTRO);
    expect(r.status).toBe("ok");

    expect(
      eventos,
      "la invalidacion ocurrio ANTES del commit. Entre las dos cosas cabe una lectura " +
        "concurrente que repuebla la cache con el estado ANTERIOR, y esa entrada vive el TTL " +
        "entero. Nada falla; la cifra se congela vieja.",
    ).toEqual([
      "tx:abre",
      "escribe:documento",
      "escribe:ledger-tienda",
      "escribe:caja",
      "tx:commit",
      "invalida:ledger_liquidacion",
    ]);
  });

  it("y una transaccion que REVIENTA no invalida nada: no hubo dinero que anunciar", async () => {
    const { servicio, eventos } = armar({ cajaExplota: true });

    await expect(servicio.registrarPagoTienda(INPUT_TIENDA, MAESTRO)).rejects.toThrow(
      "la caja exploto dentro de la tx",
    );

    // Esta es la mutacion que el caso caza: con la invalidacion metida DENTRO de la `tx` —justo
    // despues del ledger, que es donde uno la pone «para no olvidarse»— aqui habria una
    // invalidacion por una escritura que la base revirtio entera.
    expect(eventos.filter((e) => e.startsWith("invalida:"))).toEqual([]);
    expect(eventos).not.toContain("tx:commit");
  });
});
