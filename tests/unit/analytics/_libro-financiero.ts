import { Prisma } from "@prisma/client";
import type { AgregadoCategoriaCaja } from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type {
  CrearMovimientoInput,
  IWalletMovimientoRepository,
  ListarMovimientosPage,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IAnaliticaFinancieraService } from "@/lib/interfaces/services/IAnaliticaFinancieraService";
import { decorarFinancieraConCache } from "@/lib/services/CachedAnaliticaFinancieraService";
import type { ResultadoFinanciero } from "@/lib/types/analitica-financiera";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";
import { cacheFalsa, type CacheFalsa } from "./_cache-falsa";

// Feature 179 (T3) — EL LIBRO COMPARTIDO DE LOS TESTS DE ESCRITOR.
//
// NO acaba en `.test.ts`: vitest no lo recoge como suite.
//
// ─── POR QUE UN LIBRO COMPARTIDO Y NO DOS DOBLES SEPARADOS ──────────────────────────────────
//
// El criterio de «hecho» de T3 dice que la asercion del paso 5 va sobre el DATO SERVIDO, no
// sobre un espia de `invalidar`. Para que eso sea verdad de punta a punta, lo que el escritor
// ESCRIBE y lo que el tablero LEE tienen que ser la MISMA cosa. Aqui lo son: los escritores
// reales llaman a `cajaRepo.crearMovimientos(...)`, que apila las filas en este libro y
// recalcula el agregado por (tipo, categoria); y el `AnaliticaFinancieraService` real lee ese
// mismo agregado por su repositorio de ingresos.
//
// Con dos dobles independientes —uno que traga la escritura y otro que devuelve una cifra
// fijada a mano— el paso 5 comprobaria que alguien cambio una variable del test, no que el
// dinero movido llegue al tablero. La diferencia se nota en la mutacion: aqui, borrar la
// invalidacion de un escritor deja su paso 5 devolviendo la cifra ANTERIOR A SU PROPIA
// ESCRITURA, que es exactamente el fallo de produccion.
//
// ─── LA FORMA DE CINCO PASOS (`design.md §11`) ──────────────────────────────────────────────
//
//   1. consultar                       -> V1
//   2. mover dinero AL MARGEN del escritor (el libro pasa a valer V2)
//   3. consultar                       -> sigue V1   ← si esto falla, la cache no cachea y el
//                                                      resto del test es vacuo
//   4. correr el ESCRITOR REAL de produccion, que mueve mas dinero (-> V3) e invalida
//   5. consultar                       -> V3         ← si devuelve V1, la invalidacion de ESE
//                                                      escritor no llego
//
// El paso 2 existe para que el paso 3 pueda afirmarse sin haber tocado al escritor todavia. Sin
// el, «la segunda consulta devolvio otra cosa» no distinguiria una cache que invalida de una
// cache que no cachea.
//
// Todo corre SIN runtime de Next y SIN `DATABASE_URL`: los repositorios financieros entran por
// interfaz (dobles de la 127) y el puerto de cache es el falso de la 128, con semantica de tags
// real.

/** La metrica con la que se mide: `egresos` sale de `wallet_movimiento` por `deCaja`. */
export const METRICA = "egresos";

/** Una fila del libro, tal cual la escribio un escritor. */
export type FilaDelLibro = CrearMovimientoInput;

export interface LibroFinanciero {
  /** El repositorio del libro de la caja: es el que los escritores REALES reciben. */
  readonly cajaRepo: IWalletMovimientoRepository;
  /** El puerto de cache que se le pasa a los escritores. Falso, con semantica de tags real. */
  readonly cache: CacheFalsa;
  /** El lector CACHEADO: el mismo decorador de produccion sobre el servicio real de la 127. */
  readonly lector: IAnaliticaFinancieraService;
  /** Total bruto de `egresos` servido por el lector cacheado. La cifra del tablero. */
  readonly consultar: () => Promise<string>;
  /** Mueve dinero SIN pasar por ningun escritor. Paso 2 de los cinco. */
  readonly moverAlMargen: (monto: string) => void;
  /** Las filas escritas, en orden. Para afirmar que el dinero escrito SIGUE escrito (R16). */
  readonly filas: () => readonly FilaDelLibro[];
}

function totalBrutoDe(datos: ResultadoFinanciero): string {
  if (datos.tipo !== "vistas") throw new Error(`${METRICA}: se esperaba un resultado de vistas`);
  return datos.vistas[0].total.bruto;
}

/**
 * El libro de la caja + el tablero que lo lee, cableados entre si.
 *
 * @param cache puerto de cache a usar. Se puede pasar uno que FALLE al invalidar (R16).
 */
export function libroFinanciero(cache: CacheFalsa = cacheFalsa()): LibroFinanciero {
  const filas: FilaDelLibro[] = [];
  /** El agregado que lee el repositorio de ingresos. Se MUTA EN SITIO: la referencia es la que
   *  el doble de la 127 devuelve en cada llamada, asi que el tablero ve lo que el libro tiene. */
  const caja: AgregadoCategoriaCaja[] = [];

  function recalcular(): void {
    const sumas = new Map<string, { fila: AgregadoCategoriaCaja; suma: Prisma.Decimal }>();
    for (const f of filas) {
      const clave = `${f.tipo}${f.categoria}`;
      const previo = sumas.get(clave);
      const suma = (previo?.suma ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(f.monto));
      sumas.set(clave, {
        fila: { tipo: f.tipo, categoria: f.categoria, suma: suma.toFixed(2) },
        suma,
      });
    }
    // `splice` y no reasignacion: el doble de la 127 cerro sobre ESTA referencia.
    caja.splice(0, caja.length, ...[...sumas.values()].map((v) => v.fila));
  }

  /** Idempotencia del indice unico parcial `(origen_tipo, origen_id, categoria)`, replicada. */
  function esDuplicada(m: FilaDelLibro): boolean {
    if (m.origenId === null || m.origenId === undefined) return false;
    return filas.some(
      (f) =>
        f.origenTipo === m.origenTipo && f.origenId === m.origenId && f.categoria === m.categoria,
    );
  }

  function comoDTO(f: FilaDelLibro, i: number): WalletMovimientoDTO {
    return {
      id: `mov-${i}`,
      tipo: f.tipo,
      categoria: f.categoria,
      monto: f.monto,
      origenTipo: f.origenTipo,
      origenId: f.origenId,
      descripcion: f.descripcion ?? null,
      registradoPor: f.registradoPor ?? null,
      fechaMovimiento: (f.fechaMovimiento ?? new Date("2026-08-10T00:00:00.000Z")).toISOString(),
    };
  }

  const cajaRepo: IWalletMovimientoRepository = {
    async crearMovimientos(_tx: WalletTxClient, movs: CrearMovimientoInput[]): Promise<number> {
      let insertadas = 0;
      for (const m of movs) {
        if (esDuplicada(m)) continue; // `skipDuplicates`, igual que la base
        filas.push(m);
        insertadas += 1;
      }
      recalcular();
      return insertadas;
    },
    async listar(f): Promise<ListarMovimientosPage> {
      const candidatas = filas
        .map(comoDTO)
        .filter((m) => (f.tipo === undefined || m.tipo === f.tipo))
        .filter((m) => (f.categoria === undefined || m.categoria === f.categoria));
      const ultimas = candidatas.slice(-f.pageSize).reverse();
      return { movimientos: ultimas, total: candidatas.length };
    },
    async obtenerPorId(id) {
      const i = filas.findIndex((_f, idx) => `mov-${idx}` === id);
      return i === -1 ? null : comoDTO(filas[i], i);
    },
    async agregarPorCategoriaYTipo() {
      return caja.map((c) => ({
        categoria: c.categoria,
        tipo: c.tipo,
        suma: c.suma,
        total: c.suma,
      }));
    },
    async agregarPorCategoria() {
      return { gastoFijo: "0.00", gastoVariable: "0.00", sueldo: "0.00", indemnizacion: "0.00" };
    },
  };

  const { servicio } = armarServicio({ caja });
  // `{}` como entorno: sin `ANALITICA_CACHE_DISABLED`, la cache esta ENCENDIDA (R22). Se pasa
  // explicito para que la suite no dependa del `process.env` de quien la corra.
  const lector = decorarFinancieraConCache(servicio, cache, {});

  return {
    cajaRepo,
    cache,
    lector,
    async consultar(): Promise<string> {
      const r = await lector.consultar(consultaDe(METRICA));
      if (r.status !== "ok") throw new Error(`la consulta de ${METRICA} devolvio ${r.status}`);
      return totalBrutoDe(r.datos);
    },
    moverAlMargen(monto: string): void {
      filas.push({
        tipo: "egreso",
        categoria: "egreso_gasto_variable",
        monto,
        origenTipo: "gasto",
        origenId: null,
      });
      recalcular();
    },
    filas: () => filas,
  };
}
