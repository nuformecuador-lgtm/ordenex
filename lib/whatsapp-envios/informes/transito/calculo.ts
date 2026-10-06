// Ficha 475 (design §5, R6/R7/R15-R17/R20/R24-R26) — CALCULO del informe de transito. PURO: sin
// base, sin reloj propio (`ahora` llega del contexto), sin `number` sobre dinero.
//
// Toda fecha y todo conteo de dias en el calendario de Costa Rica con los helpers de `fecha-cr`
// (R17): el cambio de dia es a las 00:00 CR (06:00 UTC).
import { diasNaturalesCRDesde, fechaCalendarioCR, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
import { formatMontoString } from "@/lib/config/moneda";
import { sumarMontos } from "@/lib/utils/kpis-financieros";
import { fechaCRLegible } from "@/lib/whatsapp-envios/informes/formato";
import {
  ESTADOS_OFRECIDOS,
  estadosIncluidos,
  plazoEfectivo,
  umbralDeAlerta,
  umbralDeParado,
  type Hito,
  type ParametrosTransito,
  type PlazoZona,
  type ZonaInforme,
} from "@/lib/whatsapp-envios/informes/transito/parametros";
import type { CorteZona, FilaTransito } from "@/lib/whatsapp-envios/informes/transito/tipos";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Design §4 — el corte de cada zona EXISTENTE: `inicio del dia CR siguiente a hoy − umbral dias`.
 * `hito < corte` ⇔ `diasNaturalesCRDesde(hito, ahora) >= umbral` (CR es UTC−6 fijo). Una entrada de
 * parametros cuya zona no existe no produce corte (R7): se recorre la lista de ZONAS, no la de
 * parametros.
 */
export function cortesPorZona(
  zonas: readonly ZonaInforme[],
  parametros: Pick<ParametrosTransito, "zonas">,
  ahora: Date,
): CorteZona[] {
  const finDeHoy = inicioDelDiaSiguienteCREnUtc(fechaCalendarioCR(ahora)).getTime();
  return zonas.map((z) => ({
    zonaId: z.id,
    corte: new Date(finDeHoy - umbralDeAlerta(plazoEfectivo(z, parametros)) * UN_DIA_MS),
  }));
}

export interface PaqueteTransito {
  ordenId: string;
  numRemision: string;
  numGuia: number | null;
  estado: string;
  zonaId: string;
  zonaNombre: string;
  zonaEsCentral: boolean;
  destinatario: string;
  canton: string;
  distrito: string | null;
  montoCobrar: string | null;
  /** Dias naturales CR desde el hito. */
  dias: number;
  plazoDias: number;
  /** Dias naturales CR desde la ultima transicion; `null` sin historial. */
  diasEnEstado: number | null;
  vencido: boolean;
  parado: boolean;
}

export interface ZonaConAlertas {
  zona: ZonaInforme;
  plazo: PlazoZona;
  /** Dia en que se entra en alerta (`plazo − aviso`). */
  umbral: number;
  paquetes: PaqueteTransito[];
  /** Suma exacta (`"91300.00"`). */
  porCobrar: string;
}

export interface GrupoParados {
  estado: string;
  umbral: number;
  paquetes: PaqueteTransito[];
}

export interface TotalesTransito {
  enAlerta: number;
  vencidos: number;
  porVencer: number;
  parados: number;
  /** Suma exacta (`"322900.00"`). */
  porCobrar: string;
  enAlertaGam: number;
  enAlertaFueraGam: number;
}

export interface ModeloInformeTransito {
  ahora: Date;
  hito: Hito;
  totales: TotalesTransito;
  /** La zona central si tiene paquetes en alerta. */
  central: ZonaConAlertas | null;
  /** Resto de zonas con alertas, en el orden de R25. */
  fuera: ZonaConAlertas[];
  /** Zonas sin paquetes en alerta, por nombre (R28). */
  sinAlertas: ZonaInforme[];
  /** Bloque ATENCION por estado en el orden del flujo (R24). */
  parados: GrupoParados[];
  /** Resumen de parametros usados (R29). */
  parametrosUsados: {
    zonas: { zona: ZonaInforme; plazo: PlazoZona; umbral: number }[];
    estados: { estado: string; umbralParado: number | null }[];
  };
  /** Ordenes en estados incluidos que no tienen el hito (R14). */
  sinHito: number;
}

function compararGuia(a: PaqueteTransito, b: PaqueteTransito): number {
  if (a.numGuia === b.numGuia) return a.numRemision.localeCompare(b.numRemision, "es");
  if (a.numGuia === null) return 1;
  if (b.numGuia === null) return -1;
  return a.numGuia - b.numGuia;
}

/** R26 — filas por dias descendente y, a igualdad, por guia ascendente. */
function ordenarFilas(paquetes: PaqueteTransito[]): PaqueteTransito[] {
  return [...paquetes].sort((a, b) => b.dias - a.dias || compararGuia(a, b));
}

function maxDias(z: ZonaConAlertas): number {
  return z.paquetes.reduce((m, p) => Math.max(m, p.dias), 0);
}

/** R25 — fuera de la GAM: nº de paquetes desc, mayor nº de dias desc, nombre. */
function ordenarZonasFuera(zonas: ZonaConAlertas[]): ZonaConAlertas[] {
  return [...zonas].sort(
    (a, b) =>
      b.paquetes.length - a.paquetes.length ||
      maxDias(b) - maxDias(a) ||
      a.zona.nombre.localeCompare(b.zona.nombre, "es"),
  );
}

function sumar(paquetes: readonly PaqueteTransito[]): string {
  return sumarMontos(paquetes.map((p) => p.montoCobrar ?? "0"));
}

/**
 * R15/R16/R20/R24-R26 — de las filas en alerta al modelo del informe.
 *
 * - vencido: `dias > plazo`; si no, por vencer (umbral ≤ dias ≤ plazo).
 * - parado: el estado tiene umbral y `diasEnEstado > umbral` (estricto); sin historial, no.
 *
 * Una fila de una zona que no esta en `zonas` es un error (no puede pasar: el repo solo devuelve
 * zonas con corte, y los cortes salen de `zonas`). Se lanza en vez de perderla en silencio.
 */
export function clasificar(
  filas: readonly FilaTransito[],
  zonas: readonly ZonaInforme[],
  parametros: ParametrosTransito,
  ahora: Date,
  sinHito: number,
): ModeloInformeTransito {
  const porId = new Map(zonas.map((z) => [z.id, z]));
  const paquetes: PaqueteTransito[] = filas.map((f) => {
    const zona = porId.get(f.zonaId);
    if (zona === undefined) throw new Error(`informe transito: fila de una zona desconocida (${f.zonaId})`);
    const plazo = plazoEfectivo(zona, parametros);
    const dias = diasNaturalesCRDesde(f.hitoAt, ahora);
    const diasEnEstado = f.ultimaTransicionAt === null ? null : diasNaturalesCRDesde(f.ultimaTransicionAt, ahora);
    const umbral = umbralDeParado(parametros, f.estado);
    return {
      ordenId: f.ordenId,
      numRemision: f.numRemision,
      numGuia: f.numGuia,
      estado: f.estado,
      zonaId: zona.id,
      zonaNombre: zona.nombre,
      zonaEsCentral: zona.esCentral,
      destinatario: f.destinatario,
      canton: f.canton,
      distrito: f.distrito,
      montoCobrar: f.montoCobrar,
      dias,
      plazoDias: plazo.plazoDias,
      diasEnEstado,
      vencido: dias > plazo.plazoDias,
      parado: umbral !== null && diasEnEstado !== null && diasEnEstado > umbral,
    };
  });

  const porZona = new Map<string, PaqueteTransito[]>();
  for (const p of paquetes) porZona.set(p.zonaId, [...(porZona.get(p.zonaId) ?? []), p]);

  const conAlertas: ZonaConAlertas[] = [];
  const sinAlertas: ZonaInforme[] = [];
  for (const zona of zonas) {
    const lista = porZona.get(zona.id);
    if (lista === undefined || lista.length === 0) {
      sinAlertas.push(zona);
      continue;
    }
    const plazo = plazoEfectivo(zona, parametros);
    conAlertas.push({ zona, plazo, umbral: umbralDeAlerta(plazo), paquetes: ordenarFilas(lista), porCobrar: sumar(lista) });
  }

  const parados: GrupoParados[] = [];
  for (const estado of ESTADOS_OFRECIDOS) {
    const lista = paquetes.filter((p) => p.parado && p.estado === estado);
    if (lista.length === 0) continue;
    parados.push({
      estado,
      umbral: umbralDeParado(parametros, estado) ?? 0,
      paquetes: [...lista].sort(
        (a, b) => (b.diasEnEstado ?? 0) - (a.diasEnEstado ?? 0) || b.dias - a.dias || compararGuia(a, b),
      ),
    });
  }
  // Un estado fuera de ESTADOS_OFRECIDOS no tiene umbral en los parametros (zod), asi que nunca es
  // parado: el recorrido por el catalogo ofrecido no pierde ninguno.

  const vencidos = paquetes.filter((p) => p.vencido).length;
  const enAlertaGam = paquetes.filter((p) => p.zonaEsCentral).length;

  return {
    ahora,
    hito: parametros.hito,
    totales: {
      enAlerta: paquetes.length,
      vencidos,
      porVencer: paquetes.length - vencidos,
      parados: paquetes.filter((p) => p.parado).length,
      porCobrar: sumar(paquetes),
      enAlertaGam,
      enAlertaFueraGam: paquetes.length - enAlertaGam,
    },
    central: conAlertas.find((z) => z.zona.esCentral) ?? null,
    fuera: ordenarZonasFuera(conAlertas.filter((z) => !z.zona.esCentral)),
    sinAlertas: [...sinAlertas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    parados,
    parametrosUsados: {
      zonas: [...zonas]
        .sort((a, b) => (b.esCentral ? 1 : 0) - (a.esCentral ? 1 : 0) || a.nombre.localeCompare(b.nombre, "es"))
        .map((zona) => {
          const plazo = plazoEfectivo(zona, parametros);
          return { zona, plazo, umbral: umbralDeAlerta(plazo) };
        }),
      estados: estadosIncluidos(parametros).map((estado) => ({ estado, umbralParado: umbralDeParado(parametros, estado) })),
    },
    sinHito,
  };
}

/** Claves de las variables del informe (R2), en el orden en que se declaran. */
export const CLAVES_VARIABLES_TRANSITO = [
  "total_en_alerta",
  "vencidos",
  "por_vencer",
  "parados",
  "por_cobrar",
  "en_alerta_gam",
  "en_alerta_fuera_gam",
  "fecha",
] as const;

/** R20 — una entrada por variable. `por_cobrar` con el formato de moneda configurado. */
export function variables(modelo: ModeloInformeTransito): Record<(typeof CLAVES_VARIABLES_TRANSITO)[number], string> {
  const t = modelo.totales;
  return {
    total_en_alerta: String(t.enAlerta),
    vencidos: String(t.vencidos),
    por_vencer: String(t.porVencer),
    parados: String(t.parados),
    por_cobrar: formatMontoString(t.porCobrar),
    en_alerta_gam: String(t.enAlertaGam),
    en_alerta_fuera_gam: String(t.enAlertaFueraGam),
    fecha: fechaCRLegible(modelo.ahora),
  };
}
