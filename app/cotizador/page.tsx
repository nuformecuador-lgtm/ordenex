import Link from "next/link";

import { Logo } from "@/components/shared/Logo";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { CoberturaDistritoRepository } from "@/lib/repositories/CoberturaDistritoRepository";

import { CotizadorForm } from "./CotizadorForm";

// Feature 248 (T4.1, design §1/D13) — la superficie PUBLICA `/cotizador`.
//
// Server Component sin sesion: la ruta esta en `PUBLIC_ROUTES` (`middleware.ts`, R1) y aqui no
// se llama a `resolveActorFromSession` ni se lee `cookies()`. Un visitante anonimo la abre.
//
// D13 — EL ARBOL GEOGRAFICO SE LEE AQUI Y VIAJA POR PROPS. La cascada provincia -> canton ->
// distrito (R9) no hace un solo round-trip: el catalogo llega entero en el HTML. Por eso NO hay
// endpoint publico de catalogo nuevo (una ruta menos en la lista firmada del middleware) y por
// eso NO se usa SWR: el arbol es estatico dentro de un render.
//
// ⛔ `listarArbolGeografico` (`lib/actions/geografia.ts`) NO SIRVE PARA ESTO, y no es cuestion de
// gusto: es `maestro`-only y su proyeccion expone LA ZONA de cada distrito, que R7 prohibe en
// publico. La proyeccion que se usa aqui —`listarArbolGeograficoPublico`— no nombra `zonas` ni
// `esCentral` en ningun `select`.
//
// ⛔ INVARIANTE R6/R10, MEDIDA POR UNA GUARDIA ESTATICA: el grafo de imports de `app/cotizador/**`
// NO alcanza `lib/utils/ingreso-ordenex.ts`, `TarifaVigentePorTiendaRepository` ni `prisma.tarifa`,
// ni directa ni transitivamente. Esta superficie no puede devolver un importe porque no tiene
// como llegar a uno — tampoco por diferencia.

// Opt-out del prerender estatico, por el mismo motivo que `app/postulacion/page.tsx`: esta pagina
// consulta el catalogo geografico en request time y no lee `cookies()`/`headers()`, asi que Next
// intentaria prerenderizarla en build y sin base eso rompe el build (Prisma P2021).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cotizador de cobertura · Ordenex",
  description:
    "Consultá si Ordenex entrega en un distrito de Costa Rica y en qué zona de cobertura queda.",
};

export default async function CotizadorPage() {
  const repositorio = new CoberturaDistritoRepository(getPrismaClient());
  const arbol = await repositorio.listarArbolGeograficoPublico();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border px-6 py-5">
        <Link
          href="/"
          className="inline-flex items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo className="text-foreground" />
        </Link>
      </header>

      <main className="flex flex-1 justify-center px-6 py-10">
        <div className="w-full max-w-xl">
          <CotizadorForm arbol={arbol} />
        </div>
      </main>
    </div>
  );
}
