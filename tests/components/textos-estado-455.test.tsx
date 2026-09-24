// @vitest-environment jsdom
// FICHA 455 (Fase 2: T2.2-T2.7; design §2.1; R4, R5, R6, R7, R12) — cada superficie que rotula UN
// estado o UN resultado usa su nombre visible EXACTO; cada GRUPO, acción o estado de la interfaz usa
// un texto propio que no es nombre de ningún estado (vigente ni retirado).
//
// Un bloque por superficie. Los literales esperados van escritos A MANO: compararlos con
// `nombreDeEstado` sería comparar la fuente consigo misma (memoria «Aserción contra su propia fuente»).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { chipDeEstado } from "@/app/(app)/mis-asignaciones/_components/chat/chat-format";
import { KpisMensajero } from "@/app/(app)/mis-asignaciones/_components/KpisMensajero";
import {
  ETIQUETA_BUCKET,
  ETIQUETA_RESULTADO,
  etiquetaContador,
} from "@/app/(app)/monitoreo/_components/contadores";
import {
  RESULTADO_FILA_LABEL,
  RESULTADO_LABEL,
  RESULTADO_VACIO,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
import { COLUMNAS_DESCARGA_GESTIONES_FUNDIDA } from "@/app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas";
import { SUBTITULO_NOVEDADES, TEXTOS_POR_GRUPO } from "@/app/(app)/novedades/_components/novedad-grupo-textos";
import { textoDesenlacesDeFila, ETIQUETA_EN_PROCESO } from "@/app/(app)/analitica/_components/entregas/desenlaces-de-fila";
import { etiquetaDeDesenlace } from "@/app/(app)/analitica/_components/entregas/etiqueta-desenlace";
import { COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS } from "@/app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas";
import { COLUMNAS_DESCARGA_RANKING } from "@/app/(app)/ranking/_components/ranking-descarga-columnas";
import { RANKING_HISTORICO_COLUMNAS } from "@/app/(app)/ranking/historico/_components/ranking-historico-labels";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";
import { NOMBRES_RETIRADOS } from "../fixtures/nombres-retirados-455";

afterEach(() => {
  cleanup();
});

/** Nombres que un GRUPO / acción / estado de la interfaz no puede llevar (R6). */
const PROHIBIDOS_PARA_GRUPOS = new Set<string>([...Object.values(NOMBRE_ESTADO), ...NOMBRES_RETIRADOS]);

describe("chat del mensajero (T2.2; R7, R12)", () => {
  it("R7: el chip dice el nombre del estado de la orden", () => {
    expect(chipDeEstado("mensajero_recogiendo_en_bodega").label).toBe("Mensajero recogiendo en la bodega");
    expect(chipDeEstado("entregado").label).toBe("Entregado");
    expect(chipDeEstado("novedad").label).toBe("Novedad");
    expect(chipDeEstado("recolectando").label).toBe("Recolectando");
    expect(chipDeEstado("codigo_inventado").label).toBe("Estado no reconocido");
  });

  it("R12: el color va por código; lo que no tiene familia cae al neutro (antes, el cajón «Asignada»)", () => {
    expect(chipDeEstado("en_reparto").className).toBe("bg-info-soft text-info-strong");
    expect(chipDeEstado("entregado").className).toBe("bg-success-soft text-success-strong");
    expect(chipDeEstado("novedad").className).toBe("bg-danger-soft text-danger-strong");
    expect(chipDeEstado("recolectando").className).toBe("bg-muted text-muted-foreground");
    expect(chipDeEstado("codigo_inventado").className).toBe("bg-muted text-muted-foreground");
  });
});

describe("KPIs del mensajero (T2.2; R5)", () => {
  it("el KPI que cuenta un resultado lleva su nombre exacto: «Entregado»", () => {
    render(<KpisMensajero kpis={{ pendientes: 3, entregadas: 7, porCobrar: 0, totalACobrar: 0 } as never} />);
    expect(screen.getByText("Entregado")).toBeInTheDocument();
    expect(screen.queryByText("Entregadas")).toBeNull();
  });
});

describe("monitoreo — contadores del tablero del día (T2.3; R5, R6)", () => {
  it("R5: los cinco resultados con su nombre exacto", () => {
    expect(ETIQUETA_RESULTADO).toEqual({
      entregadas: "Entregado",
      reprogramadas: "Reprogramado",
      devueltas: "Novedad",
      rechazadas: "Devolución a origen por rechazo",
      incidentes: "Incidente",
    });
  });

  it("R6: los grupos llevan texto propio; el de un solo estado, su nombre exacto", () => {
    expect(ETIQUETA_BUCKET).toEqual({
      sinRecoger: "Todavía no sale a reparto",
      enReparto: "En reparto",
      otros: "Otros estados",
    });
    expect(PROHIBIDOS_PARA_GRUPOS.has(ETIQUETA_BUCKET.sinRecoger)).toBe(false);
    expect(PROHIBIDOS_PARA_GRUPOS.has(ETIQUETA_BUCKET.otros)).toBe(false);
    expect(etiquetaContador("rechazadas")).toBe("Devolución a origen por rechazo");
  });
});

describe("cierres — pestañas, secciones y descarga (T2.4; R4, R5)", () => {
  it("R4/R5: un solo mapa, con el nombre del estado homónimo", () => {
    expect(RESULTADO_LABEL).toEqual({
      entregado: "Entregado",
      reprogramado: "Reprogramado",
      novedad: "Novedad",
      devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo",
      incidente: "Incidente",
    });
  });

  it("la pestaña y la columna de la descarga dicen LO MISMO", () => {
    expect(RESULTADO_FILA_LABEL).toBe(RESULTADO_LABEL);
    const fila = COLUMNAS_DESCARGA_GESTIONES_FUNDIDA.find((c) => c.clave === "resultado");
    expect(fila).toBeDefined();
  });

  it("el vacío de cada sección nombra el resultado exacto", () => {
    expect(RESULTADO_VACIO.novedad).toBe("No hay gestiones con resultado «Novedad».");
    expect(RESULTADO_VACIO.incidente).toBe("No hay gestiones con resultado «Incidente».");
  });
});

describe("novedades de la tienda (T2.5; R5, R6)", () => {
  it("R5: la pestaña que lista UN estado lleva su nombre exacto: «Novedad»", () => {
    expect(TEXTOS_POR_GRUPO.devolucion.pestana).toBe("Novedad");
    expect(TEXTOS_POR_GRUPO.devolucion.listaAriaLabel).toBe("Órdenes en novedad");
  });

  it("R6: la pestaña de ayuda es un GRUPO (454) y conserva «Ayuda solicitada»", () => {
    expect(TEXTOS_POR_GRUPO.ayuda.pestana).toBe("Ayuda solicitada");
    expect(PROHIBIDOS_PARA_GRUPOS.has(TEXTOS_POR_GRUPO.ayuda.pestana)).toBe(false);
  });

  it("el subtítulo nombra los estados por su nombre exacto", () => {
    expect(SUBTITULO_NOVEDADES).toContain("Novedad");
    expect(SUBTITULO_NOVEDADES).toContain("Devolución a origen por rechazo");
    expect(SUBTITULO_NOVEDADES).not.toMatch(/en devolución|llegaron a rechazo/);
  });
});

describe("analítica y ranking (T2.6; R3, R5, R6)", () => {
  it("R3: cada desenlace por su nombre exacto; nunca el código pluralizado ni humanizado", () => {
    expect(etiquetaDeDesenlace("entregado")).toBe("Entregado");
    expect(etiquetaDeDesenlace("novedad")).toBe("Novedad");
    expect(etiquetaDeDesenlace("devolucion_a_origen_por_rechazo")).toBe("Devolución a origen por rechazo");
    expect(etiquetaDeDesenlace("otros")).toBe("Otros");
  });

  it("R5: la frase de «En qué terminaron» usa los nombres exactos, con la cantidad al lado", () => {
    const texto = textoDesenlacesDeFila([
      { status: "entregado", conteo: 3 },
      { status: "devolucion_a_origen_por_rechazo", conteo: 1 },
      { status: "novedad", conteo: 2 },
      { status: "en_reparto", conteo: 4 },
    ]);
    expect(texto).toBe(
      "Entregado: 3 · Devolución a origen por rechazo: 1 · Novedad: 2 · Sin desenlace todavía: 4",
    );
  });

  it("R6: el grupo de las órdenes sin desenlace no se llama como ningún estado", () => {
    expect(ETIQUETA_EN_PROCESO).toBe("Sin desenlace todavía");
    expect(PROHIBIDOS_PARA_GRUPOS.has(ETIQUETA_EN_PROCESO)).toBe(false);
  });

  it("R5: las columnas de las descargas que cuentan un desenlace llevan su nombre exacto", () => {
    const productos = Object.fromEntries(COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS.map((c) => [c.clave, c.encabezado]));
    expect(productos.entregadas).toBe("Entregado");
    expect(productos.rechazadas).toBe("Devolución a origen por rechazo");
    expect(productos.en_proceso).toBe("Sin desenlace todavía");
    const ranking = Object.fromEntries(COLUMNAS_DESCARGA_RANKING.map((c) => [c.clave, c.encabezado]));
    expect(ranking.entregadas).toBe("Entregado");
    expect(RANKING_HISTORICO_COLUMNAS.entregadas).toBe("Entregado");
  });
});
