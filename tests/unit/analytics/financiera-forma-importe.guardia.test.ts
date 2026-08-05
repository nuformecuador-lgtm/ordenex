import { describe, it, expect } from "vitest";
import { listarMetricas } from "@/lib/analytics/metrics";
import { IDS_FINANCIERAS_SERVIDAS } from "@/lib/types/analitica-financiera";
import type { FilaFinanciera, VistaFinanciera } from "@/lib/types/analitica-financiera";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";

// Feature 183 / T10 — GUARDIA DE LA FORMA DEL IMPORTE: R14 y R18.
//
// Que vigila, y por que hace falta un guardia y no un caso suelto. ⟨D12⟩ (humano, 2026-08-04,
// `progress/decision_183.md`) retira el `neto` en TRES metricas y lo conserva en las demas. Los
// dos accidentes que eso abre no los ve ningun test de una metrica concreta:
//
//   1. GENERALIZAR LA RETIRADA «porque es mas limpio» (R14). El neto de `dinero_en_caja`, de
//      `ganancia_ordenex`, de las dos cuentas por pagar y de la vista B de recaudo significa
//      algo real: mezclan prefijos o tienen dos direcciones. Perderlo no rompe ninguna cifra,
//      solo la esconde — y por eso nadie se enteraria.
//   2. UNA VISTA QUE MEZCLA FORMAS (R18): el total con una y sus filas con otra. Compila, se
//      serializa, y obliga a cada consumidor a ramificar fila a fila. Es la red que la feature
//      180 necesita: multiplica por ~62 los sitios donde se emite un importe.
//
// EL ESPERADO SE ESCRIBE A MANO, como el de R43 en `financiera-contratos.test.ts`: derivarlo del
// mismo despacho que se juzga convertiria el caso en una tautologia y cambiar un selector
// seguiria pareciendo correcto.

/** Un libro con las dos direcciones y las tres clases de dinero: ninguna vista sale vacia. */
const DATOS = {
  caja: [
    { categoria: "ingreso_flete" as const, tipo: "ingreso" as const, suma: "1000.00" },
    { categoria: "egreso_gasto" as const, tipo: "egreso" as const, suma: "400.00" },
    { categoria: "ingreso_cod_recaudado" as const, tipo: "ingreso" as const, suma: "5000.00" },
    { categoria: "egreso_pago_tienda" as const, tipo: "egreso" as const, suma: "3000.00" },
  ],
  porMetodo: [
    { metodo: "efectivo" as const, suma: "300.00" },
    { metodo: "simpe" as const, suma: "100.00" },
  ],
  porTienda: [
    { tiendaId: "t-1", tipo: "credito" as const, suma: "300.00" },
    { tiendaId: "t-1", tipo: "debito" as const, suma: "40.00" },
    { tiendaId: "t-2", tipo: "credito" as const, suma: "100.00" },
  ],
  saldoTiendas: [
    { tiendaId: "t-1", tipo: "credito" as const, suma: "800.00" },
    { tiendaId: "t-1", tipo: "debito" as const, suma: "300.00" },
    { tiendaId: "t-2", tipo: "credito" as const, suma: "100.00" },
  ],
  cuentaMensajeros: [
    { tipo: "devengo" as const, suma: "5000.00" },
    { tipo: "pago" as const, suma: "2000.00" },
  ],
  snapshots: [{ cierreId: "c1", totalGeneral: "1.00" }],
  ledger: [
    {
      ledger: "wallet_tienda_movimiento" as const,
      cierreId: "c1",
      tipo: "credito" as const,
      suma: "1.00",
    },
  ],
};

/**
 * LA FORMA QUE CADA METRICA SERVIDA TIENE QUE PUBLICAR. Escrita, porque es el sujeto del
 * guardia. `conciliacion_cierres` no emite importes por cubo (conteos + cuadre), asi que no
 * tiene forma que declarar y se marca aparte en vez de inventarle una.
 */
const FORMA_ESPERADA: Readonly<Record<string, "solo_bruto" | "bruto_y_neto" | "sin_importes">> = {
  // Q1 ⟨D12⟩ — listas homogeneas de prefijo `ingreso_*`: con el CHECK de la 173 admiten un solo
  // `tipo`, luego `Σ egreso = 0` y el neto no informaria de nada.
  ingreso_flete: "solo_bruto",
  ingreso_comision_cod: "solo_bruto",
  ingreso_iva: "solo_bruto",
  // Q2 ⟨D12⟩ — gana `ingreso_ajuste`: su lista deja de ser homogenea y el neto pasa a significar
  // lo que de verdad salio de caja.
  egresos: "bruto_y_neto",
  // R14 — las siete que NO cambian. Su neto significa algo real y se conserva.
  cod_recaudado: "bruto_y_neto",
  dinero_en_caja: "bruto_y_neto",
  ganancia_ordenex: "bruto_y_neto",
  cuenta_por_pagar_tienda: "bruto_y_neto",
  cuenta_por_pagar_mensajero: "bruto_y_neto",
  conciliacion_cierres: "sin_importes",
};

/** Todas las formas que una vista emite: la de su total y la de cada fila. */
function formasDe(vista: VistaFinanciera): string[] {
  return [vista.total.forma, ...vista.filas.map((f: FilaFinanciera) => f.importe.forma)];
}

async function vistasServidasDe(metricaId: string): Promise<readonly VistaFinanciera[] | null> {
  const { servicio } = armarServicio(DATOS);
  const r = await servicio.consultar(consultaDe(metricaId));
  if (r.status !== "ok") throw new Error(`${metricaId} no devolvio ok: ${r.status}`);
  return r.datos.tipo === "vistas" ? r.datos.vistas : null;
}

describe("R14/R18 · cada metrica servida publica SU forma de importe, y una sola por vista", () => {
  it("el censo mira las DIEZ servidas y el esperado las cubre todas, sin sobrar ninguna", () => {
    // Sin esto, borrar una entrada del mapa esperado dejaria una metrica sin vigilar y el
    // bucle de abajo pasaria por no haberla mirado.
    expect([...IDS_FINANCIERAS_SERVIDAS].sort()).toEqual(Object.keys(FORMA_ESPERADA).sort());
    expect(IDS_FINANCIERAS_SERVIDAS).toHaveLength(10);
    // Y contra el catalogo, que es la otra fuente independiente.
    expect(listarMetricas({ dominio: "financiera" }).map((m) => m.id).sort()).toEqual(
      Object.keys(FORMA_ESPERADA).sort(),
    );
  });

  it("R14 · la forma de las diez es EXACTAMENTE la declarada", async () => {
    const obtenido: Record<string, string> = {};
    for (const id of IDS_FINANCIERAS_SERVIDAS) {
      const vistas = await vistasServidasDe(id);
      if (vistas === null) {
        obtenido[id] = "sin_importes";
        continue;
      }
      const formas = new Set(vistas.flatMap(formasDe));
      // Una metrica que emitiera dos formas a la vez se ve aqui como tal, no se colapsa.
      obtenido[id] = formas.size === 1 ? [...formas][0] : `mezcla:${[...formas].sort().join("+")}`;
    }

    // Cambiar el selector de UNA sola metrica en el despacho —generalizar la retirada, o
    // devolverle el neto a una de Q1— mueve exactamente una entrada de este objeto.
    expect(obtenido).toEqual(FORMA_ESPERADA);
  });

  it("R18 · dentro de una vista, el total y TODAS sus filas comparten forma", async () => {
    let vistasVistas = 0;
    let filasVistas = 0;

    for (const id of IDS_FINANCIERAS_SERVIDAS) {
      const vistas = await vistasServidasDe(id);
      if (vistas === null) continue;
      for (const vista of vistas) {
        vistasVistas += 1;
        filasVistas += vista.filas.length;
        const formas = new Set(formasDe(vista));
        expect(
          [...formas],
          `${id} / ${vista.id}: la vista mezcla formas entre su total y sus filas`,
        ).toHaveLength(1);
      }
    }

    // SANIDAD: el fixture produce vistas Y filas de verdad. Sin filas, el caso de arriba se
    // reduciria a «el total tiene una forma», que es trivialmente cierto.
    expect(vistasVistas, "el censo no llego a ninguna vista").toBeGreaterThanOrEqual(10);
    expect(filasVistas, "ninguna vista trajo filas: R18 pasaria por vacio").toBeGreaterThan(3);
  });

  it("autocomprobacion: una vista que mezclara formas se detecta", () => {
    // El detector, ejercido contra una vista sintetica. Si dejara de discriminar, los dos casos
    // de arriba serian decorativos.
    const mezclada = {
      id: "sintetica",
      grano: "tienda",
      fuente: "wallet_tienda_movimiento",
      sumableCon: [],
      filas: [
        { cubo: "t-1", importe: { forma: "solo_bruto", bruto: "1.00", moneda: "X" } },
        {
          cubo: "t-2",
          importe: { forma: "bruto_y_neto", bruto: "1.00", neto: "1.00", moneda: "X" },
        },
      ],
      total: { forma: "bruto_y_neto", bruto: "2.00", neto: "2.00", moneda: "X" },
    } as unknown as VistaFinanciera;

    expect(new Set(formasDe(mezclada)).size).toBe(2);
    expect(formasDe(mezclada)).toEqual(["bruto_y_neto", "solo_bruto", "bruto_y_neto"]);
  });
});
