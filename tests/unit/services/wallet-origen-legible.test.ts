import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { IOrigenLegibleRepository } from "@/lib/interfaces/repositories/IOrigenLegibleRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  OrigenLegibleService,
  PARAM_FECHA_RANKING,
  RUTA_RANKING_HISTORICO,
} from "@/lib/services/OrigenLegibleService";
import { WALLET_ORIGEN_TIPO_SEED, type WalletOrigenTipo } from "@/lib/types/wallet";
import type { FilaConOrigenTecnico } from "@/lib/types/wallet-origen";

// Ficha 458-A (TA.2, design §3.3) — R5 (diccionario total, sin valor tecnico), R6 (la entidad
// concreta), R4 (sin entidad: texto legible, nunca un id) y el LOTE (una consulta por tipo presente).
// Los textos esperados se escriben A MANO: son el contrato de lo que lee la persona.

const UUID = "7f3c1e2a-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" } as Actor;
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" } as Actor;
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" } as Actor;
const MENSAJERO: Actor = { usuarioId: "u-mens", rol: "mensajero" } as Actor;

const FORMA_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function repoFalso(): IOrigenLegibleRepository & Record<string, ReturnType<typeof vi.fn>> {
  return {
    // 2026-09-13T04:30Z = 12 sep 22:30 en Costa Rica: el dia es el de CR, no el UTC.
    cierres: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({ id, solicitadoAt: "2026-09-13T04:30:00.000Z", mensajero: "Juan Pérez Mora" })),
    ),
    gestiones: vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, guia: "4321", remision: "R-9" }))),
    incidentes: vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, guia: null, remision: "REM-7" }))),
    pagos: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({ id, fechaPago: "2026-09-12", metodo: "SINPE" as const, beneficiario: "Tania Tienda" })),
    ),
    podios: vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, fecha: "2026-09-10" }))),
    pagosPorCuenta: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({ id, tienda: "Tania Tienda", beneficiario: "Facebook" })),
    ),
    abonos: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({ id, tienda: "Tania Tienda", fechaPago: "2026-09-11", metodo: "transferencia" as const })),
    ),
    movimientosTienda: vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, tienda: "Tania Tienda" }))),
  } as unknown as IOrigenLegibleRepository & Record<string, ReturnType<typeof vi.fn>>;
}

function fila(origenTipo: WalletOrigenTipo, over: Partial<FilaConOrigenTecnico> = {}): FilaConOrigenTecnico {
  return { origenTipo, origenId: UUID, categoria: "ingreso_ajuste", descripcion: null, ...over };
}

/** Un caso por origen del catalogo, con el texto que debe leer el maestro en el libro de la caja. */
const CASOS_CAJA: Record<WalletOrigenTipo, { fila: FilaConOrigenTecnico; texto: string }> = {
  cierre_dia: { fila: fila("cierre_dia"), texto: "Cierre del día · 2026-09-12 · Juan Pérez Mora" },
  gestion_orden: {
    fila: fila("gestion_orden", { categoria: "ingreso_flete_devolucion" }),
    texto: "Gestión de orden · cobro por rechazo · guía 4321",
  },
  manual: { fila: fila("manual", { origenId: null }), texto: "Registrado a mano" },
  pago_tienda: { fila: fila("pago_tienda"), texto: "Pago de Ordenex a una tienda · Tania Tienda · 2026-09-12 · SINPE" },
  pago_mensajero: {
    fila: fila("pago_mensajero"),
    texto: "Pago de Ordenex a un mensajero · Tania Tienda · 2026-09-12 · SINPE",
  },
  gasto: { fila: fila("gasto", { origenId: null, categoria: "egreso_sueldo" }), texto: "Sueldo" },
  orden_incidente: { fila: fila("orden_incidente"), texto: "Incidente de orden · remisión REM-7" },
  ranking_snapshot_fila: { fila: fila("ranking_snapshot_fila"), texto: "Premio del ranking · podio del 2026-09-10" },
  pago_por_cuenta_tienda: {
    fila: fila("pago_por_cuenta_tienda"),
    texto: "Pago de un gasto de una tienda · Tania Tienda · a Facebook",
  },
  aporte_capital: { fila: fila("aporte_capital"), texto: "Aporte de dinero a la caja" },
  cobro_manual_reclasificado: {
    fila: fila("cobro_manual_reclasificado"),
    texto: "Cobro reclasificado como pago de un gasto de la tienda · Tania Tienda",
  },
  cobro_tienda: { fila: fila("cobro_tienda"), texto: "Cobro de Ordenex a una tienda · Tania Tienda" },
  cobro_tienda_completado: {
    fila: fila("cobro_tienda_completado"),
    texto: "Cobro de Ordenex a una tienda (línea de caja completada al corregir) · Tania Tienda",
  },
  abono_tienda: {
    fila: fila("abono_tienda"),
    texto: "Pago de una tienda a Ordenex · Tania Tienda · 2026-09-11 · Transferencia",
  },
};

describe("458-A R5/R6 — el origen de cada movimiento dice su entidad concreta", () => {
  it("un caso por cada origen del catalogo (el diccionario de casos es total por tipo)", async () => {
    expect(Object.keys(CASOS_CAJA).sort()).toEqual([...WALLET_ORIGEN_TIPO_SEED].sort());
    const svc = new OrigenLegibleService(repoFalso());
    const tipos = Object.keys(CASOS_CAJA) as WalletOrigenTipo[];
    const origenes = await svc.resolver("caja", tipos.map((t) => CASOS_CAJA[t].fila), MAESTRO);
    tipos.forEach((t, i) => expect({ t, texto: origenes[i].texto }).toEqual({ t, texto: CASOS_CAJA[t].texto }));
  });

  it("el gasto se nombra por su concepto: sueldo, gasto de Ordenex y gasto fijo con su periodo", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const r = await svc.resolver(
      "caja",
      [
        fila("gasto", { origenId: null, categoria: "egreso_gasto_variable" }),
        fila("gasto", { origenId: "plantilla:2026-09", categoria: "egreso_gasto_fijo", descripcion: "Alquiler — sep 2026" }),
        fila("gasto", { categoria: "ingreso_ajuste", descripcion: "Reverso de: Luz" }),
      ],
      MAESTRO,
    );
    expect(r.map((o) => o.texto)).toEqual([
      "Gasto de Ordenex",
      "Gasto fijo de Ordenex · Alquiler — sep 2026",
      "Gasto o sueldo registrado a mano",
    ]);
  });

  it("`gestion_orden` en el libro de la TIENDA: el flete por rechazo dice la guía (459/461 §7.3)", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const [o] = await svc.resolver("tienda", [fila("gestion_orden", { categoria: "flete_devolucion" })], TIENDA);
    expect(o.texto).toBe("Gestión de orden · cobro por rechazo · guía 4321");
  });

  it("el libro del mensajero rotula con su diccionario, que ya no dice «Liquidación» ni «Manual»", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const r = await svc.resolver(
      "mensajero",
      [fila("pago_mensajero"), fila("manual", { origenId: null })],
      MAESTRO,
    );
    expect(r.map((o) => o.texto)).toEqual([
      "Pago de Ordenex a un mensajero · Tania Tienda · 2026-09-12 · SINPE",
      "Registrado a mano",
    ]);
  });

  it("la tienda no ve qué mensajero movió su dinero (D2): su cierre dice solo el día", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const [o] = await svc.resolver("tienda", [fila("cierre_dia")], TIENDA);
    expect(o.texto).toBe("Cierre del día · 2026-09-12");
    expect(o.enlace).toBeNull();
  });

  it("R4: si la entidad no aparece (fila huérfana) el texto es el rótulo, nunca el id", async () => {
    const repo = repoFalso();
    for (const k of Object.keys(repo)) repo[k].mockResolvedValue([]);
    const svc = new OrigenLegibleService(repo);
    const tipos = Object.keys(CASOS_CAJA) as WalletOrigenTipo[];
    const r = await svc.resolver("caja", tipos.map((t) => CASOS_CAJA[t].fila), MAESTRO);
    for (const o of r) {
      expect(o.texto).not.toMatch(FORMA_UUID);
      expect(o.texto.trim()).not.toBe("");
      expect(WALLET_ORIGEN_TIPO_SEED as readonly string[]).not.toContain(o.texto);
    }
  });

  it("R1: ningún texto ni nombre accesible lleva un uuid; el id vive solo en `href` (D1)", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const tipos = Object.keys(CASOS_CAJA) as WalletOrigenTipo[];
    const r = await svc.resolver("caja", tipos.map((t) => CASOS_CAJA[t].fila), MAESTRO);
    for (const o of r) {
      expect(o.texto).not.toMatch(FORMA_UUID);
      if (o.enlace) expect(o.enlace.etiqueta).not.toMatch(FORMA_UUID);
    }
    expect(r.some((o) => o.enlace?.href.includes(UUID))).toBe(true);
  });
});

describe("458-A — la lectura va EN LOTE: una consulta por tipo presente, ninguna por fila", () => {
  it("20 filas de 2 tipos → 2 consultas (y ninguna de los tipos ausentes)", async () => {
    const repo = repoFalso();
    const svc = new OrigenLegibleService(repo);
    const filas = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? fila("cierre_dia", { origenId: `c${i}` }) : fila("pago_tienda", { origenId: `p${i}` }),
    );
    await svc.resolver("caja", filas, MAESTRO);
    expect(repo.cierres).toHaveBeenCalledTimes(1);
    expect(repo.pagos).toHaveBeenCalledTimes(1);
    expect((vi.mocked(repo.cierres).mock.calls[0][0] as string[]).length).toBe(10);
    for (const k of ["gestiones", "incidentes", "podios", "pagosPorCuenta", "abonos", "movimientosTienda"]) {
      expect(repo[k]).not.toHaveBeenCalled();
    }
  });

  it("ids repetidos se piden una sola vez; una página sin entidades no consulta nada", async () => {
    const repo = repoFalso();
    const svc = new OrigenLegibleService(repo);
    await svc.resolver("caja", [fila("cierre_dia"), fila("cierre_dia")], MAESTRO);
    expect(vi.mocked(repo.cierres).mock.calls[0][0]).toEqual([UUID]);
    const vacio = repoFalso();
    await new OrigenLegibleService(vacio).resolver(
      "caja",
      [fila("manual", { origenId: null }), fila("aporte_capital")],
      MAESTRO,
    );
    for (const k of Object.keys(vacio)) expect(vacio[k]).not.toHaveBeenCalled();
  });

  it("`adjuntar` conserva la fila y el orden y le añade `origen`", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const filas = [
      { ...fila("manual", { origenId: null }), id: "a" },
      { ...fila("cierre_dia"), id: "b" },
    ];
    const r = await svc.adjuntar("caja", filas, MAESTRO);
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r[0].origen.texto).toBe("Registrado a mano");
  });
});

describe("458-A R7/R8 — el enlace a la entidad, solo si el rol accede a su pantalla", () => {
  it("maestro y admin: cierre → /cierres-admin, orden → /ordenes por guía, podio → ranking del día", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const svc = new OrigenLegibleService(repoFalso());
      const [cierre, orden, podio] = await svc.resolver(
        "caja",
        [fila("cierre_dia"), fila("gestion_orden", { categoria: "ingreso_flete_devolucion" }), fila("ranking_snapshot_fila")],
        actor,
      );
      expect(cierre.enlace).toEqual({
        etiqueta: "Ver el cierre del 2026-09-12 de Juan Pérez Mora",
        href: `/cierres-admin?cierre=${UUID}`,
      });
      expect(orden.enlace).toEqual({ etiqueta: "Ver en órdenes la guía 4321", href: "/ordenes?q=4321" });
      expect(podio.enlace).toEqual({ etiqueta: "Ver el ranking del 2026-09-10", href: "/ranking/historico?fecha=2026-09-10" });
    }
  });

  it("adminTienda: sin enlace al cierre (no ve `/cierres-admin`), con enlace a SU orden", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const [cierre, orden] = await svc.resolver(
      "tienda",
      [fila("cierre_dia"), fila("gestion_orden", { categoria: "flete_devolucion" })],
      TIENDA,
    );
    expect(cierre.enlace).toBeNull();
    expect(orden.enlace?.href).toBe("/ordenes?q=4321");
  });

  it("un rol sin acceso a ninguna pantalla (mensajero) recibe el nombre sin enlace", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const r = await svc.resolver(
      "caja",
      [fila("cierre_dia"), fila("gestion_orden"), fila("ranking_snapshot_fila")],
      MENSAJERO,
    );
    expect(r.map((o) => o.enlace)).toEqual([null, null, null]);
    expect(r[0].texto).toBe("Cierre del día · 2026-09-12");
  });

  it("los orígenes sin pantalla propia (estado de cuenta: 458-D) no inventan un enlace", async () => {
    const svc = new OrigenLegibleService(repoFalso());
    const r = await svc.resolver(
      "caja",
      [fila("pago_tienda"), fila("pago_por_cuenta_tienda"), fila("abono_tienda"), fila("cobro_tienda")],
      MAESTRO,
    );
    expect(r.map((o) => o.enlace)).toEqual([null, null, null, null]);
  });

  it("el parámetro del ranking histórico sigue llamándose como lo lee su página", () => {
    const pagina = readFileSync(
      path.resolve(__dirname, "../../../app/(app)/ranking/historico/page.tsx"),
      "utf8",
    );
    expect(RUTA_RANKING_HISTORICO).toBe("/ranking/historico");
    expect(pagina).toContain(`const PARAM_FECHA = "${PARAM_FECHA_RANKING}";`);
  });
});
