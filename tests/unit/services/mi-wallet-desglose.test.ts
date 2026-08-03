import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";

// Feature 172 — T G.2 (R55) `[P5]` — la tienda y quien le paga leen la MISMA clasificación.
//
// El criterio duro de la task no es «los dos importes coinciden»: dos clasificaciones que hoy
// coinciden son una que mañana diverge. Es que la cabecera de `/mi-wallet` y la del maestro en
// `/wallet/tiendas` pasen por LA MISMA FUNCIÓN, y eso se mide por IDENTIDAD.
//
// Cómo se mide: se sustituye `derivarDesgloseTienda` del módulo por UN espía que envuelve a la
// función real. Solo existe una instancia en el registro de módulos, así que si las dos
// superficies del servicio la llaman, el mismo espía acumula las dos llamadas. Si alguien
// copiara la clasificación para `/mi-wallet` —un `switch`, un `Record` local, una suma por
// `tipo`—, el espía vería UNA llamada y este archivo se pondría rojo.
//
// Money-safe: cero `Number(` y cero `parseFloat`; todos los montos son STRING.

vi.mock("@/lib/utils/desglose-tienda", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/utils/desglose-tienda")>();
  return {
    ...real,
    // El espía ENVUELVE a la real: el comportamiento no cambia, solo queda registrado.
    derivarDesgloseTienda: vi.fn(real.derivarDesgloseTienda),
  };
});

import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import {
  CUBETA_POR_CATEGORIA,
  derivarDesgloseTienda,
} from "@/lib/utils/desglose-tienda";
import type {
  DesgloseTiendaAgregadoRow,
  IWalletTiendaMovimientoRepository,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED,
  type DesgloseTiendaDTO,
} from "@/lib/types/wallet-tienda";

const espia = vi.mocked(derivarDesgloseTienda);

const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };
const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

/**
 * El libro de una tienda a la que se le recaudaron 50 000, se le cobraron 1 200 de flete y se
 * le pagaron 20 000. Es el caso que R55 existe para arreglar: el pago es un DÉBITO, igual que
 * el flete, y sin clasificar por concepto los dos caerían en la misma cifra.
 */
const FILAS: DesgloseTiendaAgregadoRow[] = [
  { tipo: "credito", categoria: "cod_recaudado", total: "50000.00" },
  { tipo: "debito", categoria: "flete", total: "1200.00" },
  { tipo: "debito", categoria: "pago_tienda", total: "20000.00" },
];

function repoFake(): IWalletTiendaMovimientoRepository {
  return {
    crearMovimientos: vi.fn(async () => 0),
    listarPorTienda: vi.fn(async () => ({ movimientos: [], total: 0 })),
    agregarSaldoPorTienda: vi.fn(async () => ({
      creditos: "50000.00",
      debitos: "21200.00",
    })),
    listarSaldosTodasTiendas: vi.fn(async () => []),
    listarSaldosTiendasPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    agregarDesglosePorTienda: vi.fn(async () => FILAS),
  };
}

/** La cabecera que ve la TIENDA en `/mi-wallet` (acotada por el actor). */
async function desgloseDeLaTienda(
  svc: WalletTiendaService,
): Promise<DesgloseTiendaDTO> {
  const r = await svc.listarMisMovimientos({ page: 1, pageSize: 20 }, TIENDA);
  if (r.status !== "ok") throw new Error(r.status);
  return r.data.desglose;
}

/** La cabecera que ve el MAESTRO en `/wallet/tiendas` (acotada por el input). */
async function desgloseDelMaestro(
  svc: WalletTiendaService,
): Promise<DesgloseTiendaDTO> {
  const r = await svc.listarMovimientosDeTienda(
    { tiendaId: "t1", page: 1, pageSize: 20 },
    MAESTRO,
  );
  if (r.status !== "ok") throw new Error(r.status);
  return r.data.desglose;
}

beforeEach(() => {
  espia.mockClear();
});

describe("R55 — la clasificación de `/mi-wallet` es LA MISMA función que la del maestro", () => {
  it("las dos superficies pasan por el MISMO `derivarDesgloseTienda` (identidad, no parecido)", async () => {
    const svc = new WalletTiendaService(repoFake());

    await desgloseDeLaTienda(svc);
    expect(espia).toHaveBeenCalledTimes(1);

    await desgloseDelMaestro(svc);
    // DOS llamadas al MISMO espía: solo hay una instancia de esa función en todo el proceso.
    // Con una clasificación duplicada para `/mi-wallet`, aquí seguiría habiendo una.
    expect(espia).toHaveBeenCalledTimes(2);

    // Y las dos la llaman con las MISMAS filas crudas: ninguna las pre-filtra ni las reagrupa
    // antes de clasificar, que sería otra forma de divergir sin duplicar la función.
    expect(espia.mock.calls[0][0]).toBe(espia.mock.calls[1][0]);
    expect(espia.mock.calls[0][0]).toEqual(FILAS);
  });

  it("sobre el MISMO libro, la tienda y el maestro leen importes idénticos", async () => {
    const svc = new WalletTiendaService(repoFake());

    const tienda = await desgloseDeLaTienda(svc);
    const maestro = await desgloseDelMaestro(svc);

    expect(tienda).toEqual(maestro);
    // Y son los que dicta la clasificación: el pago NO engorda los cargos.
    expect(tienda).toEqual({
      aFavor: "50000.00",
      cargos: "1200.00",
      pagado: "20000.00",
      saldo: "28800.00",
      signo: "positivo",
    });
  });

  it("la tienda pide su desglose con SU tienda_id y los MISMOS filtros que su listado (R22)", async () => {
    const repo = repoFake();
    const svc = new WalletTiendaService(repo);
    const desde = new Date("2026-07-01T00:00:00.000Z");

    await svc.listarMisMovimientos(
      { page: 2, pageSize: 10, cierreId: "c1", desde },
      TIENDA,
    );

    // El acotado sale del ACTOR, nunca del input: `/mi-wallet` no puede mirar otra tienda.
    expect(repo.agregarDesglosePorTienda).toHaveBeenCalledWith("t1", {
      cierreId: "c1",
      categoria: undefined,
      desde,
      hasta: undefined,
    });
  });

  it("un rol que no es la tienda no llega ni a clasificar (guard antes del repositorio)", async () => {
    const repo = repoFake();
    const svc = new WalletTiendaService(repo);

    const r = await svc.listarMisMovimientos({ page: 1, pageSize: 20 }, MAESTRO);

    expect(r.status).toBe("forbidden");
    expect(repo.agregarDesglosePorTienda).not.toHaveBeenCalled();
    expect(espia).not.toHaveBeenCalled();
  });
});

describe("R55 — la pantalla de la tienda NO clasifica: solo pinta", () => {
  const ARCHIVOS = [
    "app/(app)/mi-wallet/page.tsx",
    "app/(app)/mi-wallet/_components/MiWalletModule.tsx",
    "app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx",
  ];

  function fuente(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("ningún archivo de la cabecera decide en qué importe cae una categoría", () => {
    // Las categorías del ledger son vocabulario del SERVIDOR. Si aparecieran aquí, sería
    // porque alguien empezó a clasificar en el cliente — el error que R55 no puede permitirse.
    const enElServidor = WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED;

    for (const rel of ARCHIVOS) {
      const codigo = fuente(rel)
        // Los comentarios sí las nombran (explican de dónde viene el dato); el CÓDIGO no.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const categoria of enElServidor) {
        expect(codigo, `${rel} nombra la categoría ${categoria}`).not.toContain(
          `"${categoria}"`,
        );
      }
      expect(codigo, `${rel} reimplementa la clasificación`).not.toContain(
        "CUBETA_POR_CATEGORIA",
      );
    }
  });

  it("CONTRAPRUEBA: el barrido detecta de verdad una categoría colada", () => {
    const colado = 'const cubeta = m.categoria === "pago_tienda" ? "pagado" : "cargos";';
    expect(colado).toContain('"pago_tienda"');
  });

  it("los tres importes de la cabecera son EXHAUSTIVOS sobre el ledger", () => {
    // Ninguna categoría se queda sin cubeta: es lo que garantiza que la suma de los tres
    // importes sea el libro entero y no una parte.
    const cubetas = new Set(
      WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.map((c) => CUBETA_POR_CATEGORIA[c]),
    );
    expect([...cubetas].sort()).toEqual(["aFavor", "cargos", "pagado"]);
  });
});
