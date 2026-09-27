import { describe, it, expect } from "vitest";

import { loadRastreoPublicoConfig } from "@/lib/config/rastreo-publico";
import type {
  IRastreoPublicoRepository,
  OrdenRastreoFila,
  TransicionRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import {
  CODIGO_VIGENTE_DE_ANTERIOR,
  NOMBRE_ESTADO,
  ORDER_STATUS_SEED,
} from "@/lib/types/order-status";
import type { RastreoPublicoDTO } from "@/lib/types/rastreo-publico";

// Feature 229 — GUARDIA DE NO-FUGA DE ESTATUS INTERNOS (T4.3, cubre R15).
//
// Se proyecta un historial que ATRAVIESA LOS 20 values de `ORDER_STATUS_SEED` y se comprueba
// que ninguno cruza al resultado publico.
//
// ⏳ REESCRITA EL 2026-09-24 (FICHA 455, T1.9; design §4; R31/R32). Hasta la 455 el resultado
// publicaba ids de HITO (`en_reparto`, `entregado`…) que se escribian igual que tres codigos
// internos, y esta guardia tenia que esquivar esa HOMONIMIA con una excepcion estructural (la
// cadena entera igual a un id de hito publico). La 455 retira los hitos: cada entrada lleva el
// NOMBRE VISIBLE del estado («En reparto»), que no es ningun codigo. La homonimia desaparece y la
// regla queda entera y sin excepciones:
//   1. cada `nombre` (y el vigente) es un nombre visible del catalogo (`NOMBRE_ESTADO`), y
//   2. ninguna cadena del resultado —claves incluidas— contiene un codigo vigente ni un codigo
//      ANTERIOR de la 455 (`CODIGO_VIGENTE_DE_ANTERIOR`).
// Y como una guardia que no puede fallar no vale nada, el detector se ejecuta contra resultados
// MUTADOS que publican codigos: tiene que cazarlos (la contraprueba conserva sus casos).

const NUM_GUIA = 555_001;
const TELEFONO = "8712-3456";
const FACTOR = "3456";

/** Un historial que pasa por LOS VEINTE values del catalogo, uno por dia. */
const TRANSICIONES: readonly TransicionRastreoFila[] = ORDER_STATUS_SEED.map(
  (estatusValue, indice) => ({
    createdAt: new Date(Date.UTC(2026, 0, 1 + indice, 15, 0, 0)),
    estatusValue,
  }),
);

class RepositorioDeLosVeinte implements IRastreoPublicoRepository {
  constructor(private readonly transiciones: readonly TransicionRastreoFila[] = TRANSICIONES) {}

  async buscarPorGuia(numGuia: number): Promise<OrdenRastreoFila | null> {
    return numGuia === NUM_GUIA
      ? { id: "orden-de-prueba", numGuia: NUM_GUIA, telefonoDest: TELEFONO, deletedAt: null }
      : null;
  }

  async listarTransiciones(): Promise<readonly TransicionRastreoFila[]> {
    return this.transiciones;
  }
  // FICHA 454 (T1.19): este escenario no tiene gestion pendiente de confirmar.
  async buscarGestionPendiente(): Promise<null> {
    return null;
  }
}

async function proyectar(
  transiciones: readonly TransicionRastreoFila[] = TRANSICIONES,
): Promise<RastreoPublicoDTO> {
  const service = new RastreoPublicoService(
    new RepositorioDeLosVeinte(transiciones),
    loadRastreoPublicoConfig(),
  );
  const resultado = await service.consultar(NUM_GUIA, FACTOR);
  expect(resultado.estado, "el escenario base tiene que identificar el envio").toBe("ok");
  if (resultado.estado !== "ok") throw new Error("escenario base roto");
  return resultado.envio;
}

/* -------------------------------------------------------------------------- */
/* El detector, escrito como funcion pura para poder probarlo con una fuga      */
/* -------------------------------------------------------------------------- */

const NOMBRES_PUBLICABLES = new Set<string>(Object.values(NOMBRE_ESTADO));

/** Los codigos que NUNCA pueden cruzar: los 20 vigentes y los 7 anteriores de la 455. */
const CODIGOS: readonly string[] = [...ORDER_STATUS_SEED, ...Object.keys(CODIGO_VIGENTE_DE_ANTERIOR)];

/** Todas las cadenas de un objeto y de sus descendientes, claves incluidas. */
function cadenasProfundas(valor: unknown, acumulado: string[] = []): string[] {
  if (typeof valor === "string") {
    acumulado.push(valor);
    return acumulado;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) cadenasProfundas(item, acumulado);
    return acumulado;
  }
  if (typeof valor === "object" && valor !== null) {
    for (const [clave, hijo] of Object.entries(valor)) {
      acumulado.push(clave);
      cadenasProfundas(hijo, acumulado);
    }
  }
  return acumulado;
}

/**
 * Los codigos de estado que se han colado en el resultado: cualquier cadena que CONTENGA uno. Sin
 * excepciones: desde la 455 el resultado no lleva ids de hito, asi que no hay homonimia que salvar.
 */
function valuesInternosFiltrados(valor: unknown): string[] {
  const delatoras: string[] = [];
  for (const cadena of cadenasProfundas(valor)) {
    for (const value of CODIGOS) {
      if (cadena.includes(value)) delatoras.push(`${cadena} :: contiene el value interno ${value}`);
    }
  }
  return delatoras;
}

/* -------------------------------------------------------------------------- */

describe("R15 — un historial que atraviesa los 20 estatus no publica ningún value interno", () => {
  it("CONTROL DE NO-VACUIDAD: el escenario recorre de verdad los 20 values del catalogo", () => {
    // 2026-08-19 (235): 22; 2026-09-23 (ficha 454): 20, salen `devolucion_por_confirmar` y
    // `ayuda_tienda`. Sus filas historicas las cubre el caso «454/R40» de abajo.
    expect(ORDER_STATUS_SEED).toHaveLength(20);
    expect(TRANSICIONES).toHaveLength(20);
    expect(new Set(TRANSICIONES.map((t) => t.estatusValue)).size).toBe(20);
  });

  it("454/R40 · 455/R34: las filas HISTÓRICAS de los retirados tampoco publican su value crudo", async () => {
    const RETIRADOS = ["devolucion_por_confirmar", "ayuda_tienda"];
    const historicas: TransicionRastreoFila[] = RETIRADOS.map((estatusValue, i) => ({
      createdAt: new Date(Date.UTC(2026, 1, 1 + i, 15, 0, 0)),
      estatusValue,
    }));
    const envio = await proyectar([...TRANSICIONES, ...historicas]);
    const cadenas = JSON.stringify(envio);
    for (const retirado of RETIRADOS) expect(cadenas).not.toContain(retirado);
    for (const entrada of envio.linea) expect(NOMBRES_PUBLICABLES.has(entrada.nombre)).toBe(true);
  });

  it("ningún código de estado (vigente ni anterior) cruza al resultado público", async () => {
    const envio = await proyectar();
    expect(valuesInternosFiltrados(envio)).toEqual([]);
  });

  it("cada `nombre` publicado es un nombre visible del catálogo, y el vigente también", async () => {
    const envio = await proyectar();

    expect(envio.linea.length).toBeGreaterThan(0);
    for (const entrada of envio.linea) {
      expect(NOMBRES_PUBLICABLES.has(entrada.nombre), `fuera del catálogo: ${entrada.nombre}`).toBe(true);
    }
    expect(NOMBRES_PUBLICABLES.has(envio.nombreVigente)).toBe(true);
  });

  it("los veinte estados se publican con SUS veinte nombres, sin sobrar ni faltar", async () => {
    // La cara positiva de R15: no basta con que no salga el código, tiene que salir su nombre. Con
    // un estado por día y ninguno repetido, no hay rachas que fundir: 20 entradas, 20 nombres.
    const envio = await proyectar();
    expect(envio.linea.map((e) => e.nombre).sort()).toEqual([...NOMBRES_PUBLICABLES].sort());
  });

  it("una fila HUERFANA (el caso real de la feature 155) tampoco publica su value crudo", async () => {
    // El historial es append-only: una fila puede apuntar a un estatus fuera del catalogo vigente.
    // El value concreto que la 155 retiro no se escribe aqui; el caso no depende de cual sea.
    const huerfano = "un_estatus_retirado_del_catalogo";
    expect(new Set<string>(ORDER_STATUS_SEED).has(huerfano)).toBe(false);

    const envio = await proyectar([
      { createdAt: new Date(Date.UTC(2026, 0, 1, 15, 0, 0)), estatusValue: huerfano },
      { createdAt: new Date(Date.UTC(2026, 0, 2, 15, 0, 0)), estatusValue: "entregado" },
    ]);

    expect(JSON.stringify(envio)).not.toContain(huerfano);
    expect(envio.linea.map((e) => e.nombre)).toEqual(["Estado no reconocido", "Entregado"]);
  });
});

describe("R15 — CONTRAPRUEBA: el detector caza los values que de verdad serian una fuga", () => {
  it("caza `en_bodega_satelite` publicado como nombre", async () => {
    const envio = await proyectar();
    const fugado = {
      ...envio,
      linea: [...envio.linea, { nombre: "en_bodega_satelite", fecha: "2026-01-21T09:00-06:00" }],
    };

    const delatoras = valuesInternosFiltrados(fugado);
    expect(delatoras.some((d) => d.includes("contiene el value interno en_bodega_satelite"))).toBe(true);
  });

  it("caza `novedad_interna` como vigente", async () => {
    const envio = await proyectar();
    const fugado = { ...envio, nombreVigente: "novedad_interna" };

    const delatoras = valuesInternosFiltrados(fugado);
    // `novedad_interna` CONTIENE otro codigo vigente (`novedad`), asi que la misma cadena se delata
    // dos veces. Lo que importa: se caza, y por el value que es.
    expect(delatoras.some((d) => d.includes("contiene el value interno novedad_interna"))).toBe(true);
  });

  it("caza un value interno escondido dentro de un texto, no solo como valor exacto", async () => {
    const envio = await proyectar();
    const fugado = {
      ...envio,
      linea: [
        ...envio.linea,
        { nombre: "En reparto", fecha: "estado interno: por_recolectar_en_tienda" },
      ],
    };

    expect(valuesInternosFiltrados(fugado).length).toBeGreaterThan(0);
  });

  it("caza los VEINTE codigos vigentes y los SIETE anteriores: ya no hay homonimos que salvar", () => {
    for (const value of CODIGOS) {
      const delatoras = valuesInternosFiltrados({ nombre: value, fecha: "2026-01-01T09:00-06:00" });
      expect(delatoras, `el detector deja pasar ${value}`).not.toEqual([]);
    }
    // Y ningun NOMBRE visible contiene un codigo (la homonimia de los hitos no se reproduce).
    for (const nombre of NOMBRES_PUBLICABLES) {
      expect(valuesInternosFiltrados({ nombre }), nombre).toEqual([]);
    }
  });
});
