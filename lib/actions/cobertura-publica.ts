"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import { CoberturaDistritoRepository } from "@/lib/repositories/CoberturaDistritoRepository";
import { CoberturaService } from "@/lib/services/CoberturaService";
import {
  aCoberturaPublica,
  consultaCoberturaSchema,
  type ResultadoCoberturaPublica,
} from "@/lib/types/cotizador";

// Feature 248 (design §4.1) — Server Action PUBLICA de la consulta de cobertura por distrito.
//
// ⛔ NO RESUELVE ACTOR NI COMPRUEBA ROL, Y ES DELIBERADO (R1, decision (a) de la ficha): la
// pagina `/cotizador` es publica y se sirve SIN cookie de sesion. La ausencia de
// `resolveActorFromSession` NO es un olvido; es el mismo patron que
// `lib/actions/rastreo-publico.ts:17-22` y `lib/actions/conteos-publicos.ts`.
//
// ⛔ NO APLICA LIMITE DE INTENTOS, Y TAMBIEN ES DELIBERADO (R40, D14, firma 6 del gate humano
// del 2026-08-20). Se escribe aqui, y no se calla, precisamente porque el precedente de la
// feature 229 haria leer su ausencia como un descuido. Las tres razones por las que aquella lo
// necesitaba NO SE DAN AQUI:
//
//   1. **No hay PII.** La 229 devolvia datos de un envio concreto; esto responde
//      "cubierto / sin cobertura / no determinado" y, como mucho, el NOMBRE de una zona.
//   2. **No hay enumeracion util.** Alli la clave era `num_guia`, incremental y contigua
//      (`db/schema.prisma:483`): un bucle de enteros barria la base de envios. Aqui la entrada
//      es un trio de nombres de un catalogo geografico QUE YA ES PUBLICO — las provincias,
//      cantones y distritos del pais no son un secreto, y la propia pagina los sirve enteros
//      en el HTML para poblar la cascada (D13).
//   3. **No hay secreto que adivinar.** No existe un segundo factor ni un recurso ajeno al que
//      llegar probando: la respuesta es la misma para cualquiera que teclee el mismo destino.
//
// Un limitador aqui solo añadiria estado en memoria del proceso (con el riesgo ya documentado
// en la 229: en serverless cada instancia tiene su contador) a cambio de nada.
//
// NUNCA LANZA: toda salida es un resultado discriminado.

export interface CoberturaPublicaDeps {
  service?: ICoberturaService;
}

/**
 * Consulta publica de cobertura. Sin sesion, sin actor y sin limite de intentos.
 *
 * Orden de operaciones: zod -> service -> proyeccion publica. La proyeccion (`aCoberturaPublica`)
 * es la que garantiza R6/R7: el resultado de dominio lleva `zonaId` y `esCentral` porque el
 * canal por API key los necesita, y NINGUNO de los dos cruza hacia el navegador. El campo
 * peligroso no se borra en el borde: no existe en el DTO.
 *
 * R8 — el schema declara TRES claves; un `tiendaId` (o cualquier otro identificador de tienda)
 * en la entrada se descarta al parsear y no amplia la respuesta.
 *
 * Su superficie es `app/cotizador/CotizadorForm.tsx` (T4.1). La anotacion de excepcion que esta
 * accion llevaba mientras esa pagina no existia se RETIRO al montarla: la guardia de superficie
 * de uso se pone roja si una excepcion sobrevive a su motivo (mismo camino que
 * `consultarRastreoPublico` al montar su modal).
 */
export async function consultarCoberturaPublica(
  entrada: unknown,
  deps: CoberturaPublicaDeps = {},
): Promise<ResultadoCoberturaPublica> {
  const parsed = consultaCoberturaSchema.safeParse(entrada);
  if (!parsed.success) {
    const campos: Record<string, string> = {};
    for (const [campo, errores] of Object.entries(parsed.error.flatten().fieldErrors)) {
      const primero = errores?.[0];
      if (primero !== undefined) campos[campo] = primero;
    }
    return { estado: "validation_error", campos };
  }

  const service =
    deps.service ?? new CoberturaService(new CoberturaDistritoRepository(getPrismaClient()));

  return aCoberturaPublica(await service.consultar(parsed.data));
}
