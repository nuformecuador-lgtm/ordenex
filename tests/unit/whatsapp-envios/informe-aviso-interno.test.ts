import { describe, it, expect } from "vitest";
import { crearInformeAvisoInterno } from "@/lib/whatsapp-envios/informes/aviso-interno";
import type { DatosAviso } from "@/lib/whatsapp-envios/informes/tipos";
import { TEXTO_CIERRE_POR_APROBAR, textoGeocodificacionCaida } from "@/lib/notificaciones/emitir";
import { accionDeAviso } from "@/lib/notificaciones/catalogo-avisos";

// Ficha 474 (T3.3, R51/R52) — «Aviso de la app».

const BASE = "https://ordenex.co";
const informe = crearInformeAvisoInterno({ baseUrl: () => BASE });
const AHORA = new Date("2026-10-05T18:00:00.000Z");

function datos(texto: string, creadoAt = "2026-10-05T11:00:00.000Z"): DatosAviso {
  return { texto, rolFila: "maestro", creadoAt };
}

describe("474/R51 — valores desde el aviso", () => {
  it("titulo = nombre del catalogo; texto = el del aviso; fecha/hora CR del aviso", async () => {
    const r = await informe.generar({
      parametros: {},
      ahora: AHORA,
      conDocumento: false,
      evento: { clave: "cierre_dia_por_aprobar", referencia: "c1", datos: datos(TEXTO_CIERRE_POR_APROBAR) },
    });
    if (r.tipo !== "contenido") throw new Error("vacio");
    expect(r.valores.titulo).toBe("Cierre del día por aprobar");
    expect(r.valores.texto).toBe(TEXTO_CIERRE_POR_APROBAR);
    expect(r.valores.fecha).toBe("05/10/2026");
    expect(r.valores.hora).toBe("05:00");
  });

  it("enlace con atajo: base + href del catalogo de avisos para el rol de la fila", async () => {
    const accion = accionDeAviso("cierre_dia_por_aprobar", "maestro");
    if (accion.clase !== "accionable" || accion.atajo === null) throw new Error("se esperaba atajo");
    const r = await informe.generar({
      parametros: {},
      ahora: AHORA,
      conDocumento: false,
      evento: { clave: "cierre_dia_por_aprobar", referencia: "c1", datos: datos("x") },
    });
    expect(r.tipo === "contenido" && r.valores.enlace).toBe(`${BASE}${accion.atajo.href}`);
    expect(accion.atajo.href.startsWith("/")).toBe(true);
  });

  it("enlace sin atajo (geocodificacion_caida): la de inicio", async () => {
    const r = await informe.generar({
      parametros: {},
      ahora: AHORA,
      conDocumento: false,
      evento: { clave: "geocodificacion_caida", referencia: "2026-10-05", datos: datos(textoGeocodificacionCaida(2)) },
    });
    expect(r.tipo === "contenido" && r.valores.enlace).toBe(`${BASE}/`);
  });

  it("sin base URL: enlace vacio (el motor lo convierte en error nombrando `enlace`)", async () => {
    const sinBase = crearInformeAvisoInterno({ baseUrl: () => null });
    const r = await sinBase.generar({
      parametros: {},
      ahora: AHORA,
      conDocumento: false,
      evento: { clave: "geocodificacion_caida", referencia: "d", datos: datos("x") },
    });
    expect(r.tipo === "contenido" && r.valores.enlace).toBe("");
  });

  it("DatosAviso no tiene anexo: el tipo lo prohibe", () => {
    const d: DatosAviso = {
      texto: "t",
      rolFila: "maestro",
      creadoAt: "2026-10-05T11:00:00.000Z",
      // @ts-expect-error — R51: el anexo (nombre de persona) NO cabe en la foto del aviso
      anexo: "Juan Pérez",
    };
    expect(d.texto).toBe("t");
  });

  it("no es apto para adminTienda y no genera documento", () => {
    expect(informe.aptoParaAdminTienda).toBe(false);
    expect(informe.generaDocumento).toBe(false);
  });
});

describe("474/R52 — Probar ahora de un envio por evento", () => {
  it("titulo y texto del EJEMPLO del catalogo; fecha y hora del momento", async () => {
    const r = await informe.generar({
      parametros: {},
      ahora: AHORA, // 12:00 CR
      conDocumento: false,
      eventoDePrueba: "geocodificacion_caida",
    });
    if (r.tipo !== "contenido") throw new Error("vacio");
    expect(r.valores.titulo).toBe("El servicio de mapas rechaza las peticiones");
    expect(r.valores.texto).toBe(textoGeocodificacionCaida(3));
    expect(r.valores.fecha).toBe("05/10/2026");
    expect(r.valores.hora).toBe("12:00");
  });
});

describe("474 — cinturon: hora fija sin evento", () => {
  it("sin evento ni eventoDePrueba -> vacio", async () => {
    const r = await informe.generar({ parametros: {}, ahora: AHORA, conDocumento: false });
    expect(r).toEqual({ tipo: "vacio", motivo: "Este informe solo funciona por evento." });
  });
});
