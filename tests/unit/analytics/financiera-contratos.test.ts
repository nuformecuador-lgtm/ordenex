import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { AnaliticaFiltroInput } from "@/lib/analytics/filters";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { listarMetricas } from "@/lib/analytics/metrics";
import { UMBRAL_AVISO_DESCUADRE_CONCILIACION } from "@/lib/config/analitica-financiera";
import {
  IDS_FINANCIERAS_ACUMULADAS,
  IDS_FINANCIERAS_SERVIDAS,
  VISTA_COD_RECAUDADO_POR_METODO,
  VISTA_COD_RECAUDADO_POR_TIENDA,
  esMetricaAcumulada,
} from "@/lib/types/analitica-financiera";
import type {
  ResultadoFinanciero,
  ResultadoFinancieroConciliacion,
  ResultadoFinancieroVistas,
  RespuestaFinanciera,
} from "@/lib/types/analitica-financiera";
import type {
  AgregadoCategoriaCaja,
  IIngresosAnaliticaRepository,
} from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type { IRecaudoAnaliticaRepository } from "@/lib/interfaces/repositories/IRecaudoAnaliticaRepository";
import type { ICuentasPorPagarAnaliticaRepository } from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";
import type { IConciliacionCierresAnaliticaRepository } from "@/lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository";
import type { IAnaliticaFinancieraService } from "@/lib/interfaces/services/IAnaliticaFinancieraService";

// Feature 127 / TANDA A — LOS CONTRATOS, ANTES DE QUE EXISTA LA LOGICA.
//
// Cubre R7 (la puerta obligatoria en las cinco firmas publicas), R27 (ningun importe es
// `number`), R37 (bruto + neto), R38 (dos vistas con ids distintos y no sumables), R39
// (coordenada temporal por fila), R43 (`esAcumulado` exacto) y las dos mitades de R40 (el
// umbral vive en un solo sitio y se declara provisional).
//
// Lo que este archivo NO puede probar todavia: que la implementacion respete los contratos.
// Eso son las tandas C-F. Aqui se juzga la FORMA, que es lo unico que ya existe — y se juzga
// con ejemplos escritos a mano, no con lo que produzca el codigo, para que el test no acabe
// describiendo la implementacion en vez de exigirsela.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-08-02T15:00:00.000Z");

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}: ${r.status}`);
  return r.consulta;
}

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/* -------------------------------------------------------------------------- */
/* Ejemplos escritos a mano del contrato                                       */
/* -------------------------------------------------------------------------- */

const COD_RECAUDADO_EJEMPLO: ResultadoFinancieroVistas = {
  tipo: "vistas",
  metricaId: "cod_recaudado",
  etiqueta: "COD recaudado",
  unidad: "moneda",
  rango: { desdeFecha: "2026-08-02", hastaFecha: "2026-08-02" },
  esAcumulado: false,
  vistas: [
    {
      id: VISTA_COD_RECAUDADO_POR_METODO,
      grano: "metodo_pago",
      fuente: "cierre_dia",
      sumableCon: [],
      filas: [{ cubo: "efectivo", importe: { bruto: "1000.00", neto: "1000.00", moneda: "CRC" } }],
      total: { bruto: "1000.00", neto: "1000.00", moneda: "CRC" },
    },
    {
      id: VISTA_COD_RECAUDADO_POR_TIENDA,
      grano: "tienda",
      fuente: "wallet_tienda_movimiento",
      sumableCon: [],
      filas: [{ cubo: "t-1", importe: { bruto: "600.00", neto: "600.00", moneda: "CRC" } }],
      total: { bruto: "600.00", neto: "600.00", moneda: "CRC" },
    },
  ],
};

const CONCILIACION_EJEMPLO: ResultadoFinancieroConciliacion = {
  tipo: "conciliacion",
  metricaId: "conciliacion_cierres",
  etiqueta: "Conciliacion de cierres",
  unidad: "conteo",
  rango: { desdeFecha: "2026-08-02", hastaFecha: "2026-08-02" },
  esAcumulado: false,
  conciliacion: {
    porEstado: [
      {
        nivel: "cierre_dia",
        estado: "aprobado",
        cantidad: 2,
        totales: { efectivo: "800.00", simpe: "200.00", transferencia: "0.00", general: "1000.00" },
        fechadoPor: "resuelto_at",
      },
      {
        nivel: "cierre_dia",
        estado: "solicitado",
        cantidad: 1,
        totales: { efectivo: "50.00", simpe: "0.00", transferencia: "0.00", general: "50.00" },
        fechadoPor: "solicitado_at",
      },
    ],
    cuadre: {
      cuadra: false,
      totalSnapshot: "1000.00",
      totalLedger: "999.00",
      diferencia: "1.00",
      cierresDescuadrados: ["c-1"],
    },
  },
};

/** Todos los caminos con valor numerico de un objeto serializable. */
function caminosNumericos(valor: unknown, prefijo = ""): string[] {
  if (typeof valor === "number") return [prefijo || "(raiz)"];
  if (Array.isArray(valor)) return valor.flatMap((v, i) => caminosNumericos(v, `${prefijo}[${i}]`));
  if (valor !== null && typeof valor === "object") {
    return Object.entries(valor).flatMap(([k, v]) =>
      caminosNumericos(v, prefijo ? `${prefijo}.${k}` : k),
    );
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* R27 / R37 — el dinero es STRING escala 2, y llega dos veces                 */
/* -------------------------------------------------------------------------- */

describe("R27 · ningun importe del contrato financiero es un number", () => {
  it("el unico valor numerico de un resultado de vistas seria un bug: no hay ninguno", () => {
    expect(caminosNumericos(COD_RECAUDADO_EJEMPLO)).toEqual([]);
  });

  it("en la conciliacion los unicos numeros son conteos de cierres, nunca dinero", () => {
    const numericos = caminosNumericos(CONCILIACION_EJEMPLO);
    expect(numericos.length).toBeGreaterThan(0);
    for (const camino of numericos) {
      expect(camino, `${camino} es un number y no es un conteo`).toMatch(/\.cantidad$/);
    }
  });

  it("la deteccion discrimina: un importe puesto como number se detecta", () => {
    type Mutable = { vistas: { total: { bruto: unknown } }[] };
    const mutado = JSON.parse(JSON.stringify(COD_RECAUDADO_EJEMPLO)) as Mutable;
    mutado.vistas[0].total.bruto = 1000;
    expect(caminosNumericos(mutado)).toEqual(["vistas[0].total.bruto"]);
  });
});

describe("R37 · cada importe llega con bruto y neto, y son campos distintos", () => {
  it("el contrato exige los dos campos, no uno copiado del otro", () => {
    // Un caso con anulacion: dos movimientos nominales que el `neto` cancela por signo.
    const conAnulacion = { bruto: "2000.00", neto: "0.00", moneda: "CRC" };
    expect(conAnulacion.bruto).not.toBe(conAnulacion.neto);
    // Y el tipo no admite servir solo uno: quitar `neto` no compila.
    // @ts-expect-error — falta `neto`: el ⟨D1⟩ obliga a los DOS importes.
    const soloBruto: (typeof conAnulacion) & { bruto: string } = { bruto: "2000.00", moneda: "CRC" };
    expect(soloBruto.bruto).toBe("2000.00");
  });

  it("el neto puede ser negativo y sigue siendo STRING escala 2", () => {
    const saldoNegativo = { bruto: "500.00", neto: "-123.45", moneda: "CRC" };
    expect(typeof saldoNegativo.neto).toBe("string");
    expect(saldoNegativo.neto).toMatch(/^-?\d+\.\d{2}$/);
  });
});

/* -------------------------------------------------------------------------- */
/* R38 — dos vistas, dos ids, cero sumabilidad                                 */
/* -------------------------------------------------------------------------- */

describe("R38 · las dos vistas de cod_recaudado no suman entre si", () => {
  it("los dos ids son distintos y ninguno es el id de la metrica", () => {
    expect(VISTA_COD_RECAUDADO_POR_METODO).not.toBe(VISTA_COD_RECAUDADO_POR_TIENDA);
    expect([VISTA_COD_RECAUDADO_POR_METODO, VISTA_COD_RECAUDADO_POR_TIENDA]).not.toContain(
      "cod_recaudado",
    );
  });

  it("ninguna de las dos se declara sumable con la otra", () => {
    for (const vista of COD_RECAUDADO_EJEMPLO.vistas) {
      expect(vista.sumableCon, vista.id).toEqual([]);
    }
  });

  it("cada vista declara de que tabla salio, y son tablas distintas", () => {
    const fuentes = COD_RECAUDADO_EJEMPLO.vistas.map((v) => v.fuente);
    expect(fuentes).toEqual(["cierre_dia", "wallet_tienda_movimiento"]);
  });
});

/* -------------------------------------------------------------------------- */
/* R39 — la coordenada temporal es un dato de la fila                          */
/* -------------------------------------------------------------------------- */

describe("R39 · cada fila de conciliacion declara con que fecha entro", () => {
  it("la fila aprobada se fecha por resuelto_at y la solicitada por solicitado_at", () => {
    const porEstado = CONCILIACION_EJEMPLO.conciliacion.porEstado;
    const aprobada = porEstado.find((f) => f.estado === "aprobado");
    const solicitada = porEstado.find((f) => f.estado === "solicitado");
    expect(aprobada?.fechadoPor).toBe("resuelto_at");
    expect(solicitada?.fechadoPor).toBe("solicitado_at");
  });

  it("el campo es obligatorio: una fila sin coordenada temporal no compila", () => {
    const fila = CONCILIACION_EJEMPLO.conciliacion.porEstado[0];
    const sinCoordenada: Omit<typeof fila, "fechadoPor"> = {
      nivel: fila.nivel,
      estado: fila.estado,
      cantidad: fila.cantidad,
      totales: fila.totales,
    };
    // @ts-expect-error — R39: sin `fechadoPor` la doble convencion volveria a ser implicita.
    const invalida: typeof fila = sinCoordenada;
    expect(invalida.estado).toBe("aprobado");
  });
});

/* -------------------------------------------------------------------------- */
/* R43 — esAcumulado exacto en las dos cuentas por pagar                       */
/* -------------------------------------------------------------------------- */

describe("R43 · el saldo al corte esta marcado y el flujo del periodo no", () => {
  it("el mapa de las diez financieras es exactamente el esperado", () => {
    // El esperado se escribe A MANO: si se derivara del mismo registro que se juzga, el test
    // seria una tautologia y renombrar una cuenta por pagar seguiria pareciendo correcto.
    const esperado: Record<string, boolean> = {
      cod_recaudado: false,
      ingreso_flete: false,
      ingreso_comision_cod: false,
      ingreso_iva: false,
      egresos: false,
      // Feature 173 (P4): las dos son FLUJO del periodo, no saldo al corte. `dinero_en_caja`
      // suena a saldo y no lo es: agrega la ventana [desde, hasta) como las demas.
      dinero_en_caja: false,
      ganancia_ordenex: false,
      cuenta_por_pagar_tienda: true,
      cuenta_por_pagar_mensajero: true,
      conciliacion_cierres: false,
    };

    const financieras = listarMetricas({ dominio: "financiera" });
    expect(financieras.length).toBe(10);
    const obtenido = Object.fromEntries(financieras.map((m) => [m.id, esMetricaAcumulada(m.id)]));
    expect(obtenido).toEqual(esperado);
  });

  it("el registro de acumuladas tiene exactamente dos entradas", () => {
    expect([...IDS_FINANCIERAS_ACUMULADAS]).toEqual([
      "cuenta_por_pagar_tienda",
      "cuenta_por_pagar_mensajero",
    ]);
  });

  it("un id que no es del catalogo no se marca como acumulado por defecto", () => {
    expect(esMetricaAcumulada("entregas")).toBe(false);
    expect(esMetricaAcumulada("")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R7 — la puerta obligatoria en las cinco firmas publicas                     */
/* -------------------------------------------------------------------------- */

describe("R7 · toda firma publica de la 127 recibe ConsultaAnalitica y nada mas", () => {
  const ingresos: IIngresosAnaliticaRepository = {
    async sumarPorCategoria(consulta) {
      const fila: AgregadoCategoriaCaja = {
        categoria: "ingreso_flete",
        tipo: "ingreso",
        suma: consulta.metrica.id === "ingreso_flete" ? "10.00" : "0.00",
      };
      return [fila];
    },
  };

  it("el repositorio de ingresos acepta la consulta preparada", async () => {
    await expect(ingresos.sumarPorCategoria(consultaDe("ingreso_flete"))).resolves.toHaveLength(1);
  });

  it("y NO acepta el filtro parseado suelto: no compila, y en runtime tampoco funciona", async () => {
    const filtroSuelto = { rango: "dia" } as AnaliticaFiltroInput;
    // @ts-expect-error — R7: un filtro sin recorte no tiene de donde sacar el alcance.
    await expect(ingresos.sumarPorCategoria(filtroSuelto)).rejects.toThrow();
  });

  it("tampoco acepta un rango suelto, ni un rol, ni un usuarioId", async () => {
    // @ts-expect-error — R7: un rango suelto se salta la resolucion de alcance entera.
    await expect(ingresos.sumarPorCategoria({ desde: AHORA, hasta: AHORA })).rejects.toThrow();
    // @ts-expect-error — R7: el rol no es un parametro de consulta; el alcance ya viene resuelto.
    await expect(ingresos.sumarPorCategoria("maestro")).rejects.toThrow();
  });

  it("las cuatro interfaces de repositorio declaran la consulta como primer parametro", () => {
    // Comprobacion de TIPOS: si alguna firma cambiara a un filtro suelto, estas asignaciones
    // dejarian de compilar y el guardia estructural no llegaria a tener que enterarse.
    type PrimerParametro<T> = T extends (primero: infer P, ...resto: never[]) => unknown ? P : never;
    const _recaudo: PrimerParametro<IRecaudoAnaliticaRepository["porMetodoDeCierresResueltos"]> =
      consultaDe("cod_recaudado");
    const _cxp: PrimerParametro<ICuentasPorPagarAnaliticaRepository["saldoPorTiendaAlCorte"]> =
      consultaDe("cuenta_por_pagar_tienda");
    const _conc: PrimerParametro<
      IConciliacionCierresAnaliticaRepository["contarCierresPorEstado"]
    > = consultaDe("conciliacion_cierres");
    const _svc: PrimerParametro<IAnaliticaFinancieraService["consultar"]> = consultaDe("egresos");
    expect([_recaudo, _cxp, _conc, _svc].map((c) => c.metrica.dominio)).toEqual([
      "financiera",
      "financiera",
      "financiera",
      "financiera",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* R30 — el contrato del servicio no sabe que existen Prisma ni HTTP           */
/* -------------------------------------------------------------------------- */

describe("R30 · el contrato del servicio no menciona Prisma, Request ni cookies", () => {
  const CONTRATO = "lib/interfaces/services/IAnaliticaFinancieraService.ts";

  it("no importa el cliente de Prisma ni nada de next", () => {
    const codigo = leer(CONTRATO);
    expect(codigo).not.toMatch(/from ["']@prisma\/client["']/);
    expect(codigo).not.toMatch(/from ["']next\//);
    expect(codigo).not.toMatch(/\bPrismaClient\b/);
  });

  it("el archivo existe y tiene contenido (el censo no pasa por vacio)", () => {
    expect(leer(CONTRATO).length).toBeGreaterThan(200);
  });
});

/* -------------------------------------------------------------------------- */
/* R40 — el umbral vive en un solo sitio y se declara provisional              */
/* -------------------------------------------------------------------------- */

describe("R40 · el umbral de descuadre es una sola constante, y esta marcada", () => {
  it("es un STRING escala 2, porque se compara con Prisma.Decimal", () => {
    expect(typeof UMBRAL_AVISO_DESCUADRE_CONCILIACION).toBe("string");
    expect(UMBRAL_AVISO_DESCUADRE_CONCILIACION).toMatch(/^\d+\.\d{2}$/);
  });

  it("su archivo lo declara provisional y no medido", () => {
    const config = leer("lib/config/analitica-financiera.ts").toUpperCase();
    expect(config).toContain("PROVISIONAL");
    expect(config).toContain("NO MEDIDA");
  });

  it("el numero no aparece como literal en ningun servicio ni repositorio de la feature", () => {
    const literal = `"${UMBRAL_AVISO_DESCUADRE_CONCILIACION}"`;
    const candidatos = [
      "lib/services/AnaliticaFinancieraService.ts",
      "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
      "lib/repositories/IngresosAnaliticaRepository.ts",
      "lib/repositories/RecaudoAnaliticaRepository.ts",
      "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
      "lib/actions/analitica-financiera.ts",
    ];
    for (const rel of candidatos) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      expect(fs.readFileSync(abs, "utf8"), `${rel} clava el umbral en vez de importarlo`).not.toContain(
        literal,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* ⟨D8⟩ — la respuesta del borde no tiene estado "no_producida"                */
/* -------------------------------------------------------------------------- */

describe("D8 · no existe un estado para una financiera declarada sin productor", () => {
  it("los cuatro estados de la respuesta son ok, validation_error, forbidden y error", () => {
    const estados: RespuestaFinanciera["status"][] = ["ok", "validation_error", "forbidden", "error"];
    expect(estados).toHaveLength(4);
    // @ts-expect-error — ⟨D8(b)⟩: un estado "no_producida" seria codigo muerto que invita a
    // rellenarlo; si vuelve a hacer falta, se añade con la decision que lo cree.
    const invalido: RespuestaFinanciera = { status: "no_producida" };
    expect(invalido.status).toBe("no_producida");
  });

  it("el registro de ids servidos cubre las diez financieras del catalogo", () => {
    const delCatalogo = listarMetricas({ dominio: "financiera" }).map((m) => m.id).sort();
    expect([...IDS_FINANCIERAS_SERVIDAS].sort()).toEqual(delCatalogo);
  });

  it("un resultado financiero es o de vistas o de conciliacion, nunca ambiguo", () => {
    const resultados: ResultadoFinanciero[] = [COD_RECAUDADO_EJEMPLO, CONCILIACION_EJEMPLO];
    expect(resultados.map((r) => r.tipo)).toEqual(["vistas", "conciliacion"]);
  });
});
