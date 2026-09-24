import { z } from "zod";

// Feature 229 (design §3) — CONTRATO COMPARTIDO del rastreo publico del envio.
//
// Modulo de TIPOS puros. NO importa `repositories/`, `services/`, `@/lib/db` ni `next/headers`:
// el Client Component del modal importa de aqui sus tipos, y cualquiera de esos imports lo
// convertiria en codigo de servidor (mismo criterio que `lib/types/tablero-dia.ts:1-8`).

/* -------------------------------------------------------------------------- */
/* 1-2. El vocabulario publico: los NOMBRES de estado (FICHA 455, design §4)    */
/* -------------------------------------------------------------------------- */

// FICHA 455 (2026-09-24, design DF/§4; R31-R34). Hasta la 455 el rastreo tenia su propio
// vocabulario: nueve HITOS («Envío registrado», «En nuestras instalaciones», «En tránsito»…) y un
// mapa estado -> hito (`HITO_POR_ESTATUS`, con sus retirados y un hito neutral «En proceso»). El
// humano pidio transparencia total: el destinatario ve los MISMOS nombres que la app interna. Asi
// que los hitos desaparecen y cada entrada de la linea es el NOMBRE VISIBLE de un estado, leido de
// la fuente unica con `nombrePublicoDeEstado` (`lib/types/order-status.ts`): un estado retirado se
// pliega a su vigente equivalente (R34) y un codigo desconocido se lee «Estado no reconocido»
// (R10). Ningun codigo cruza la frontera (R32).

/* -------------------------------------------------------------------------- */
/* 3. Entrada del borde publico (design §3.1)                                   */
/* -------------------------------------------------------------------------- */

// R12 — textos FIJOS, sin interpolar nunca la guia ni el segundo factor.
const MENSAJE_GUIA = "Número de guía no válido.";
const MENSAJE_FACTOR = "Dato requerido.";

/**
 * R13 — EXACTAMENTE DOS CAMPOS. Ni uno mas: ni zona, ni tienda, ni mensajero, ni fecha, ni
 * paginacion. Un borde sin sesion con filtros es un oraculo del negocio (precedente
 * documentado en `lib/actions/conteos-publicos.ts:19-24`). Una guardia lee estas claves.
 */
export const consultaRastreoSchema = z.object({
  // La guia llega TECLEADA (cadena) o ya numerica, y por eso se coerce. Pero la union
  // previa no es decorativa: `z.coerce.number()` a secas acepta `[4321]` y `true` —
  // `Number([4321])` es 4321— y un borde publico no tiene por que admitir esas formas.
  numGuia: z
    .union([z.number(), z.string()], { error: MENSAJE_GUIA })
    .transform((valor) => Number(valor))
    .pipe(z.number({ error: MENSAJE_GUIA }).int(MENSAJE_GUIA).positive(MENSAJE_GUIA)),
  factor: z.string({ error: MENSAJE_FACTOR }).trim().min(1, MENSAJE_FACTOR),
});

export type ConsultaRastreo = z.infer<typeof consultaRastreoSchema>;

/* -------------------------------------------------------------------------- */
/* 4. Salida: lista blanca CERRADA de cuatro campos (R22, G11/G13)              */
/* -------------------------------------------------------------------------- */

export interface EntradaLineaPublica {
  /**
   * El NOMBRE VISIBLE del estado de ese tramo (FICHA 455, R31), nunca su codigo (R32). En la entrada
   * `pendiente`, el nombre del RESULTADO pendiente (`nombreDeResultado`), que la pagina pinta como
   * «<Resultado> · pendiente de confirmación» (R33).
   */
  readonly nombre: string;
  /** Dia Y hora (G12) en la zona horaria del negocio, resuelta por configuracion (R19). */
  readonly fecha: string;
  /**
   * FICHA 454 (R31) / 455 (R33) — SOLO en la ULTIMA entrada, y solo cuando la orden tiene una
   * gestion pendiente de confirmar. AUSENTE (no `false`) en las entradas confirmadas, para que su
   * forma siga siendo exactamente `{ nombre, fecha }`.
   */
  readonly pendiente?: true;
}

/**
 * R22 — CUATRO campos y ninguno mas. Cualquier campo no declarado es una fuga, no una
 * mejora: la lista blanca es el mecanismo (R23/G14), no la buena intencion.
 *
 * FICHA 455 (R31/R32): `hitoVigente` pasa a `nombreVigente` (el nombre del ultimo tramo) y la linea
 * lleva nombres de estado en vez de hitos.
 */
export interface RastreoPublicoDTO {
  readonly numGuia: number;
  readonly nombreVigente: string;
  readonly actualizadoEn: string;
  readonly linea: readonly EntradaLineaPublica[];
}

/**
 * R7 — `no_encontrado` NO lleva payload: no hay donde meter una diferencia entre "la guia
 * no existe", "el segundo factor no coincide", "la orden esta borrada" y "el telefono del
 * destinatario tiene menos de 4 digitos". Ese vacio es el mecanismo, no un descuido.
 */
export type ResultadoRastreoPublico =
  | { readonly estado: "ok"; readonly envio: RastreoPublicoDTO }
  | { readonly estado: "no_encontrado" }
  | { readonly estado: "demasiados_intentos" }
  | { readonly estado: "validation_error"; readonly campos: Record<string, string> };
