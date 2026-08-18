"use server";

// EL BORDE del dinero POR DIA.
//
// Server Action y no ruta bajo `app/api/`, por el mismo motivo que el resto de lecturas de la
// analitica: es una lectura INTERNA de esta aplicacion, y `docs/architecture.md` reserva los
// route handlers para webhooks y API publica.
//
// ⚠ EL GATE ES `esAccesoTotal`, EL MISMO QUE EL DE LA CAJA. No se reusa
// `prepararConteoEntregas` —que es el resolutor de alcance de las lecturas de ORDENES— porque
// aqui no hay recorte por inquilino que valga: la caja central es UNA, y quien no es maestro o
// admin no ve parte de ella, no ve nada. Un adminTienda con «su parte» de la caja seria una
// cifra que nadie ha definido.
//
// TAMPOCO RECIBE FILTRO: no hay `raw`, no hay zod y no hay nada que validar. La ventana la pone
// el servicio con su reloj (ultimos 30 dias CR). Es la firma mas corta posible a proposito:
// una accion sin entrada no puede recibir una entrada maliciosa.

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { FinanzasDiarioRepository } from "@/lib/repositories/FinanzasDiarioRepository";
import { FinanzasDiarioService } from "@/lib/services/FinanzasDiarioService";
import type { ResultadoFinanzasDiario } from "@/lib/types/finanzas-diario";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

export interface FinanzasDiarioDeps {
  readonly service?: Pick<FinanzasDiarioService, "consultar">;
  readonly getActor?: () => Promise<Actor | null>;
  /** Reloj inyectable: misma entrada y mismo `now` => misma ventana y mismo resultado. */
  readonly now?: () => Date;
}

/**
 * La UNICA lectura del dinero por dia.
 *
 * El ORDEN es el contrato: sesion -> rol -> servicio. Sin sesion NO se pregunta por el rol y sin
 * rol suficiente NO se toca la base, de modo que ni un `SELECT` de dinero llegue a salir por una
 * peticion que no tenia derecho a hacerlo.
 */
/**
 * @sin-superficie la seccion de finanzas de `/analitica` se comento entera el 2026-08-18 por
 * decision humana, y con ella se fue el unico sitio que montaba esto. El codigo se conserva
 * —esta hecho y probado— y volver a encenderlo es descomentar el bloque de `page.tsx` y sus
 * imports. La anotacion CADUCA: en cuanto la seccion vuelva hay que retirarla, y la guardia lo
 * exige.
 */
export async function consultarFinanzasDiario(
  deps: FinanzasDiarioDeps = {},
): Promise<ResultadoFinanzasDiario> {
  const actor = await (deps.getActor ?? resolveActorFromSession)();

  // «No sabemos quien eres» y «no puedes» piden cosas distintas del usuario —una se arregla
  // volviendo a entrar y la otra no—, asi que no comparten respuesta.
  if (actor === null) return { status: "unauthenticated" };
  if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };

  const now = deps.now ?? (() => new Date());
  const service =
    deps.service ?? new FinanzasDiarioService(new FinanzasDiarioRepository(getPrismaClient()), { now });

  return { status: "ok", datos: await service.consultar() };
}
