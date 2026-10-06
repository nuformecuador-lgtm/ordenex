// Ficha 475 (design §3, R3-R6) — PARAMETROS del informe de transito.
//
// Modulo PURO y apto para el cliente: lo importan el informe (servidor), la vista previa (server
// action) y el panel `ParamsTransito` (navegador). Sin Prisma, sin `fs`, sin `server-only`: solo
// zod y el catalogo de estados. Una sola definicion de la partida y de `plazoEfectivo` para el
// calculo y para el panel: lo que se pinta y lo que se filtra no pueden divergir.
import { z } from "zod";
import type { OrderStatusValue } from "@/lib/types/order-status";

/** R3 — desde cuando se cuentan los dias. */
export const HITOS = ["entrada_bodega_central", "creacion", "generacion_guia"] as const;
export type Hito = (typeof HITOS)[number];

/** El hito en palabras, tal como lo leen el PDF y el panel («Dias contados desde …»). */
export const HITO_EN_PALABRAS: Record<Hito, string> = {
  entrada_bodega_central: "la entrada a la bodega central",
  creacion: "la creación de la orden",
  generacion_guia: "la generación de la guía",
};

/** R5/R10 — cierre logistico: nunca entran y no se ofrecen. */
export const CIERRE_LOGISTICO = ["entregado", "devuelta_a_tienda"] as const satisfies readonly OrderStatusValue[];

/**
 * Los 18 estados ofrecidos, en el orden del panel y del bloque ATENCION (design §3, maqueta
 * `ParamsTransito`): el flujo de transito y despues los tres que por defecto no entran.
 * `satisfies` + test de igualdad de conjuntos contra `ORDER_STATUS_SEED − CIERRE_LOGISTICO`: un
 * estado nuevo en el catalogo rompe un test, no se queda fuera del informe en silencio.
 */
export const ESTADOS_OFRECIDOS = [
  "en_ruta_bodega_central",
  "en_bodega_central",
  "mensajero_recogiendo_en_bodega",
  "en_ruta_bodega_satelite",
  "en_bodega_satelite",
  "en_reparto",
  "reprogramado",
  "novedad",
  "novedad_interna",
  "incidente",
  "devolucion_a_origen_por_rechazo",
  "por_devolver_a_bodega_central",
  "devolviendo_a_bodega_central",
  "por_devolver_a_tienda",
  "devolviendo_a_tienda",
  "en_preparacion",
  "por_recolectar_en_tienda",
  "recolectando",
] as const satisfies readonly OrderStatusValue[];
export type EstadoOfrecido = (typeof ESTADOS_OFRECIDOS)[number];

/** R6 — partida de plazo/aviso por TIPO de zona (central = GAM). */
export const PARTIDA_PLAZO = {
  central: { plazoDias: 10, avisoDias: 2 },
  fuera: { plazoDias: 20, avisoDias: 5 },
} as const;

export const PLAZO_MIN = 1;
export const PLAZO_MAX = 365;
export const PARADO_MIN = 0;
export const PARADO_MAX = 90;
/** Tope defensivo de entradas de zona (hoy hay una decena). */
export const ZONAS_MAX = 200;

/** R5 — estados que NO entran por defecto. */
const NO_INCLUIDOS_POR_DEFECTO: ReadonlySet<EstadoOfrecido> = new Set([
  "en_preparacion",
  "por_recolectar_en_tienda",
  "recolectando",
]);

/** R5 — umbral de «parado» de partida (dias); el resto, sin umbral. */
const PARADO_POR_DEFECTO: Partial<Record<EstadoOfrecido, number>> = {
  en_bodega_central: 2,
  en_ruta_bodega_satelite: 2,
  en_bodega_satelite: 2,
  reprogramado: 3,
  novedad: 1,
  novedad_interna: 1,
  incidente: 1,
};

function mensajeCampoNoDeclarado(iss: { code?: string; keys?: string[] }): string | undefined {
  if (iss.code === "unrecognized_keys" && iss.keys !== undefined) {
    return `Campo no declarado: ${iss.keys.join(", ")}.`;
  }
  return undefined;
}

const zonaSchema = z.strictObject(
  {
    zonaId: z.string({ error: "zonaId: indica la zona." }).min(1, { error: "zonaId: indica la zona." }).max(64),
    plazoDias: z
      .number({ error: "plazoDias: debe ser un número entero." })
      .int({ error: "plazoDias: debe ser un número entero." })
      .min(PLAZO_MIN, { error: `plazoDias: debe estar entre ${PLAZO_MIN} y ${PLAZO_MAX}.` })
      .max(PLAZO_MAX, { error: `plazoDias: debe estar entre ${PLAZO_MIN} y ${PLAZO_MAX}.` }),
    avisoDias: z
      .number({ error: "avisoDias: debe ser un número entero." })
      .int({ error: "avisoDias: debe ser un número entero." })
      .min(0, { error: "avisoDias: no puede ser negativo." }),
  },
  { error: mensajeCampoNoDeclarado },
);

const estadoSchema = z.strictObject(
  {
    estado: z.enum(ESTADOS_OFRECIDOS, {
      error: "estado: no es un estado que se pueda incluir (los de cierre logístico nunca entran).",
    }),
    incluido: z.boolean({ error: "incluido: debe ser sí o no." }),
    paradoSiMasDeDias: z
      .number({ error: "paradoSiMasDeDias: debe ser un número entero o vacío." })
      .int({ error: "paradoSiMasDeDias: debe ser un número entero." })
      .min(PARADO_MIN, { error: `paradoSiMasDeDias: debe estar entre ${PARADO_MIN} y ${PARADO_MAX}.` })
      .max(PARADO_MAX, { error: `paradoSiMasDeDias: debe estar entre ${PARADO_MIN} y ${PARADO_MAX}.` })
      .nullable(),
  },
  { error: mensajeCampoNoDeclarado },
);

/**
 * R3/R4 — esquema de los parametros. Los errores llevan la RUTA del campo (`zonas.3.avisoDias`),
 * que el servicio de la 474 convierte en `parametros.zonas.3.avisoDias`.
 */
export const parametrosTransitoSchema = z
  .strictObject(
    {
      hito: z.enum(HITOS, { error: "hito: elige desde cuándo se cuentan los días." }),
      zonas: z.array(zonaSchema, { error: "zonas: lista inválida." }).max(ZONAS_MAX),
      estados: z.array(estadoSchema, { error: "estados: lista inválida." }).max(ESTADOS_OFRECIDOS.length),
      enviarSiVacio: z.boolean({ error: "enviarSiVacio: debe ser sí o no." }),
    },
    { error: mensajeCampoNoDeclarado },
  )
  .superRefine((p, ctx) => {
    const zonasVistas = new Set<string>();
    p.zonas.forEach((z, i) => {
      if (z.avisoDias > z.plazoDias - 1) {
        ctx.addIssue({
          code: "custom",
          path: ["zonas", i, "avisoDias"],
          message: `avisoDias: debe estar entre 0 y ${z.plazoDias - 1} (menor que el plazo).`,
        });
      }
      if (zonasVistas.has(z.zonaId)) {
        ctx.addIssue({ code: "custom", path: ["zonas", i, "zonaId"], message: "zonaId: la zona está repetida." });
      }
      zonasVistas.add(z.zonaId);
    });
    const estadosVistos = new Set<string>();
    p.estados.forEach((e, i) => {
      if (estadosVistos.has(e.estado)) {
        ctx.addIssue({ code: "custom", path: ["estados", i, "estado"], message: "estado: el estado está repetido." });
      }
      estadosVistos.add(e.estado);
    });
    if (!p.estados.some((e) => e.incluido)) {
      ctx.addIssue({ code: "custom", path: ["estados"], message: "estados: incluye al menos un estado." });
    }
  });

export type ParametrosTransito = z.infer<typeof parametrosTransitoSchema>;
export type ZonaParametro = ParametrosTransito["zonas"][number];
export type EstadoParametro = ParametrosTransito["estados"][number];

/** R5 — la entrada de partida de un estado ofrecido. */
export function estadoPorDefecto(estado: EstadoOfrecido): EstadoParametro {
  return {
    estado,
    incluido: !NO_INCLUIDOS_POR_DEFECTO.has(estado),
    paradoSiMasDeDias: PARADO_POR_DEFECTO[estado] ?? null,
  };
}

/** R5 — valores de partida (ninguna zona con plazo propio: cada una usa la partida de su tipo). */
export const PARAMETROS_POR_DEFECTO: ParametrosTransito = {
  hito: "entrada_bodega_central",
  zonas: [],
  estados: ESTADOS_OFRECIDOS.map(estadoPorDefecto),
  enviarSiVacio: false,
};

/** La zona tal como la necesitan el calculo y el panel. */
export interface ZonaInforme {
  id: string;
  nombre: string;
  esCentral: boolean;
}

export interface PlazoZona {
  plazoDias: number;
  avisoDias: number;
}

/**
 * R6 — plazo y aviso de una zona: los declarados para su `zonaId`; si no hay entrada, la partida
 * de su tipo (central 10/2, resto 20/5). La usan el calculo y el panel: una sola definicion.
 */
export function plazoEfectivo(zona: Pick<ZonaInforme, "id" | "esCentral">, parametros: Pick<ParametrosTransito, "zonas">): PlazoZona {
  const propia = parametros.zonas.find((z) => z.zonaId === zona.id);
  if (propia !== undefined) return { plazoDias: propia.plazoDias, avisoDias: propia.avisoDias };
  const partida = zona.esCentral ? PARTIDA_PLAZO.central : PARTIDA_PLAZO.fuera;
  return { plazoDias: partida.plazoDias, avisoDias: partida.avisoDias };
}

/** «Entra en alerta el dia N»: el umbral de alerta de la zona (`plazo − aviso`). */
export function umbralDeAlerta(plazo: PlazoZona): number {
  return plazo.plazoDias - plazo.avisoDias;
}

/** Los estados INCLUIDOS, en el orden del flujo. Un ofrecido ausente de la lista = no incluido. */
export function estadosIncluidos(parametros: Pick<ParametrosTransito, "estados">): EstadoOfrecido[] {
  const incluidos = new Set(parametros.estados.filter((e) => e.incluido).map((e) => e.estado));
  return ESTADOS_OFRECIDOS.filter((e) => incluidos.has(e));
}

/** Umbral de «parado» del estado (dias), o `null` si no tiene o no esta en los parametros. */
export function umbralDeParado(parametros: Pick<ParametrosTransito, "estados">, estado: string): number | null {
  return parametros.estados.find((e) => e.estado === estado)?.paradoSiMasDeDias ?? null;
}

/**
 * Errores de validacion por campo con la convencion de la 474 (`parametros.<ruta>`). Un campo no
 * declarado se reporta bajo SU nombre (zod lo deja en la ruta del objeto que lo contiene).
 */
export function erroresDeParametrosTransito(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const push = (clave: string, mensaje: string) => {
    (out[clave] ??= []).push(mensaje);
  };
  for (const issue of error.issues) {
    const base = ["parametros", ...issue.path.map(String)].join(".");
    if (issue.code === "unrecognized_keys") {
      for (const k of issue.keys) push(`${base}.${k}`, issue.message);
      continue;
    }
    push(base, issue.message);
  }
  return out;
}
