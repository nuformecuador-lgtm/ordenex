"use server";

import { z } from "zod";

import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { crearTableroDiaCacheDeNext } from "@/lib/cache/next-tablero-dia-cache";
import { ordenesConfig } from "@/lib/config/ordenes";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { ITableroDiaService } from "@/lib/interfaces/services/ITableroDiaService";
import { TableroDiaRepository } from "@/lib/repositories/TableroDiaRepository";
import { TableroDiaService } from "@/lib/services/TableroDiaService";
import type { ResultadoDetalleDia, ResultadoTableroDia } from "@/lib/types/tablero-dia";

// Feature 192 (B4.1/B7.6, design.md §3.4 y §6) — EL BORDE DEL TABLERO DEL DIA.
//
// Server Actions y NO un route handler bajo `app/api/` (alternativa 6): el patron del repo
// para lectura con refresco es Server Action + SWR, y una ruta API añadiria una superficie
// publica nueva que hay que autenticar por su cuenta. Los route handlers se reservan para
// webhooks, crons y API para terceros.
//
// Una Server Action no puede responder 403, asi que estas dos devuelven un resultado
// DISCRIMINADO y nunca filas. El motivo es un literal de un dominio cerrado: jamas lleva ids
// ajenos, nombres ni PII.
//
// ⚠ Aqui vive el UNICO `new Date()` de la feature (R16): todo lo de abajo recibe el instante
// por parametro para que un test pueda fijar el reloj sin depender del reloj del proceso.

/** Inyeccion para los tests del borde (patron del repo: `AnaliticaOperativaDeps`). */
export interface TableroDiaDeps {
  readonly service?: ITableroDiaService;
  readonly getActor?: () => Promise<ActorAnalitica | null>;
  readonly now?: () => Date;
}

/**
 * R42 — el detalle SI tiene entrada externa, asi que se valida en el borde. El dia y la zona
 * los sigue poniendo el servidor: un `zonaId` de cliente seria una segunda puerta al recorte
 * multi-tenant.
 *
 * La pagina se acota por arriba con la misma cota que el listado de ordenes: una pagina
 * gigantesca es un `OFFSET` gigantesco, y eso es una consulta cara regalada a cualquiera.
 */
const entradaDetalleSchema = z.object({
  mensajeroId: z.string().uuid(),
  pagina: z.number().int().min(1).max(ordenesConfig.MAX_PAGE_SIZE).optional(),
});

export type EntradaDetalleMensajeroDia = z.infer<typeof entradaDetalleSchema>;

function construirServicio(): ITableroDiaService {
  return new TableroDiaService(
    new TableroDiaRepository(getPrismaClient()),
    crearTableroDiaCacheDeNext(),
  );
}

/**
 * R2 — SIN PARAMETROS, y es deliberado: el actor sale de la cookie de sesion y el dia del
 * reloj del servidor. No acepta ni un `zonaId` ni una fecha del cliente.
 *
 * Sin sesion valida -> `denegado("sin_sesion")`, sin filas y sin conteos. Nunca `ok` con
 * ceros: la pantalla tiene que poder distinguir "prohibido" de "no hay nada hoy" (R33).
 */
export async function leerTableroDia(deps: TableroDiaDeps = {}): Promise<ResultadoTableroDia> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  const now = (deps.now ?? (() => new Date()))();
  const service = deps.service ?? construirServicio();
  return service.obtener(actor, now);
}

/**
 * R42/R63 — LOS TRES CASOS MALOS SON INDISTINGUIBLES. Un mensajero que no existe, uno que
 * existe pero cae fuera del alcance del actor y uno que no tiene ordenes hoy devuelven la
 * MISMA respuesta: `estado: "ok"` con un detalle VACIO. Ni mensaje, ni codigo, ni una rama
 * que responda antes que las otras. Distinguirlos ("ese mensajero no es de tu zona")
 * confirmaria la existencia de un usuario ajeno, que es exactamente la fuga que R41-R42
 * persiguen.
 *
 * Un `mensajeroId` que ni siquiera es un uuid recibe el mismo detalle vacio, sin eco del
 * valor recibido: un identificador malformado tampoco puede servir para sondear nada.
 */
export async function leerDetalleMensajeroDia(
  entrada: unknown,
  deps: TableroDiaDeps = {},
): Promise<ResultadoDetalleDia> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  const now = (deps.now ?? (() => new Date()))();
  const service = deps.service ?? construirServicio();

  const parseada = entradaDetalleSchema.safeParse(entrada);
  if (!parseada.success) {
    // Se resuelve el alcance IGUAL (el actor no autorizado debe seguir viendo denegado, R69),
    // y para el resto un detalle vacio con la fecha del dia. El `mensajeroId` sale vacio: no
    // se le devuelve al cliente lo que mando.
    return service.detalle(actor, now, "", 1);
  }

  return service.detalle(actor, now, parseada.data.mensajeroId, parseada.data.pagina ?? 1);
}
