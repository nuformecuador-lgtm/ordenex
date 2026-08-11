import { obtenerConteosPublicos } from "@/lib/actions/conteos-publicos";

// Feature 198 — las tres cifras en la landing publica.
//
// Es el CONSUMIDOR de `obtenerConteosPublicos`, y con el la accion deja de estar sin
// superficie. Aqui encaja de verdad: la landing es la unica pantalla del producto que se sirve
// SIN sesion, asi que una lectura publica y sin filtros es exactamente lo que necesita —y el
// motivo de que la accion no valide rol deja de ser una excepcion rara y pasa a ser coherente
// con quien la llama.
//
// ⛔ NO BLOQUEANTE, y son DOS cosas distintas, no una (pedido humano del 2026-08-10):
//
//   1. No bloquea el RENDER. El padre lo envuelve en `<Suspense>`, asi que la landing se
//      pinta entera y estas cifras llegan despues por streaming. Sin eso, una consulta lenta
//      retrasaria el hero —lo primero que ve alguien que no nos conoce—.
//   2. No bloquea ante un FALLO. Si la lectura revienta —base caida, migracion a medias— se
//      devuelve `null` y la landing sigue como si el bloque no existiera. Una pagina de marca
//      NO puede caerse por un contador: es adorno, no contenido.
//
// El `catch` es deliberadamente mudo: no hay nada accionable que decirle a un visitante sobre
// el estado de nuestra base, y menos en la unica pantalla que ve alguien de fuera.

/** Formato local: separador de miles, sin decimales. Los tres son enteros. */
function comoNumero(valor: number): string {
  return new Intl.NumberFormat("es-CR").format(valor);
}

export async function LandingConteos() {
  let conteos;
  try {
    conteos = await obtenerConteosPublicos();
  } catch {
    return null;
  }

  const cifras = [
    { valor: conteos.cantonesConCobertura, etiqueta: "cantones con cobertura" },
    { valor: conteos.ordenesGestionadas, etiqueta: "entregas gestionadas" },
    { valor: conteos.ordenesSinGestionar, etiqueta: "en camino ahora" },
  ];

  return (
    <section
      aria-label="Ordenex en números"
      className="border-y border-asfalto-2 bg-white/60 py-10"
    >
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 sm:grid-cols-3">
        {cifras.map((cifra) => (
          <div key={cifra.etiqueta} className="text-center">
            <p className="text-4xl font-black tabular-nums text-navy-deep">
              {comoNumero(cifra.valor)}
            </p>
            <p className="mt-1 text-sm font-medium uppercase tracking-wide text-asfalto-6">
              {cifra.etiqueta}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
