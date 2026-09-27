// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import AyudaDocumentoPage from "@/app/(app)/ayuda/[...slug]/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// ⭑ FICHA 433 · R16 — EL ACOTAMIENTO POR ROL DE LA **URL**, que es la defensa de verdad.
//
// POR QUÉ ESTE ARCHIVO EXISTE, y qué NO cubría la suite antes de él. Que el índice no pinte el
// enlace es PRESENTACIÓN: la URL de un documento es adivinable (`/ayuda/oficina/wallet-caja`) y
// lo único que se interpone es el `notFound()` del servidor. La revisión de la ficha midió que
// quitar `!documentoVisiblePara(...)` de esa línea dejaba la suite ENTERA en verde —las 230
// guardias incluidas—: un mensajero, una tienda o una bodega satélite (gente ajena a la empresa)
// podían leer cómo funciona la caja de Ordenex sin romper ni un test.
//
// Lo que se afirma aquí son las DOS mitades, porque una sola no vale nada:
//   · la NEGATIVA — rol ajeno, sin sesión, cuenta de máquina y slug inexistente dan 404;
//   · la POSITIVA — quien SÍ puede, lee el documento. Sin ella, una página que lanzara siempre
//     dejaría la mitad negativa verde: es la forma de test vacío que ya mordió en este repo.
//
// El patrón (mockear `next/navigation` para que `notFound()` lance, mockear la sesión y afirmar
// sobre la promesa de la página) es el de `RankingHistoricoPage.test.tsx` y `CierresAdminPage`.
//
// ⚠️ LOS DOCUMENTOS SON LOS REALES: se leen de `docs/ayuda/**` con el catálogo de verdad. Aquí no
// hay fixture que pueda declarar otros `roles:` que los que la aplicación sirve.

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  usePathname: () => "/ayuda/oficina/wallet-caja",
}));

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);

/** Props de la página: Next 16 entrega `params` como PROMESA. */
function props(slug: string[]) {
  return { params: Promise.resolve({ slug }) };
}

function entra(rol: RolValue) {
  resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol, zonaId: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("R16 — la URL de un documento no se abre por escribirla: el rol manda", () => {
  // ⭑ FICHA 435 — ESTE BLOQUE NO SE TOCA, Y ÉSA ES LA MITAD QUE IMPORTA. La lectura se
  // ensanchó SÓLO para maestro y admin (`ROLES_LECTURA_TOTAL_AYUDA`): el mensajero, la tienda
  // y el satélite —gente ajena a la empresa— siguen recibiendo 404 en cada uno de los casos
  // de abajo. Si alguien mete un cuarto rol en esa lista, esto se pone rojo.
  it("⭑ los tres roles NO-oficina no pueden leer la ayuda de la caja de la empresa", async () => {
    // `oficina/wallet-caja` declara `roles: [maestro, admin]`. Los otros tres son cuentas de
    // persona con acceso al módulo (ven `/ayuda`), así que el gate del layout NO los para: lo
    // único que los para es esta línea.
    for (const rol of ["mensajero", "adminTienda", "adminSatelite"] as const) {
      entra(rol);
      await expect(
        AyudaDocumentoPage(props(["oficina", "wallet-caja"])),
        rol,
      ).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("tampoco la cuenta de máquina (`apiKey`), que no está en ROLES_AYUDA", async () => {
    entra("apiKey");
    await expect(AyudaDocumentoPage(props(["oficina", "wallet-caja"]))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("ni nadie SIN sesión", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(AyudaDocumentoPage(props(["oficina", "wallet-caja"]))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("y al revés: la ayuda del mensajero tampoco se le sirve a una tienda", async () => {
    // La dirección contraria del mismo acotamiento. Sin este caso, un gate que sólo protegiera
    // la carpeta `oficina/` pasaría por bueno.
    entra("adminTienda");
    await expect(AyudaDocumentoPage(props(["mensajero", "reparto"]))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("un slug que no existe da 404 — y EL MISMO que uno prohibido", async () => {
    // Que las dos respuestas sean indistinguibles es deliberado: si se diferenciaran, la
    // diferencia diría qué documentos existen a quien no debería saberlo.
    entra("maestro");
    const inexistente = await AyudaDocumentoPage(props(["oficina", "no-existe"])).catch(
      (e: Error) => e.message,
    );
    entra("mensajero");
    const prohibido = await AyudaDocumentoPage(props(["oficina", "wallet-caja"])).catch(
      (e: Error) => e.message,
    );
    expect(inexistente).toBe("NEXT_NOT_FOUND");
    expect(prohibido).toBe(inexistente);
  });

  it("un slug con forma de travesía de rutas no llega a ningún archivo", async () => {
    // El slug pedido NUNCA se le pasa a `fs`: se busca con un `find` sobre el catálogo ya
    // leído. Este caso lo deja escrito y ejecutable.
    entra("maestro");
    for (const slug of [
      ["..", "..", ".env"],
      ["..", "..", "db", "schema.prisma"],
      ["README"],
    ]) {
      await expect(AyudaDocumentoPage(props(slug)), slug.join("/")).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
    }
  });
});

describe("R16 (mitad positiva) — quien SÍ puede, lee el documento entero", () => {
  it("⭑ el maestro abre la ayuda de la caja y el texto del `.md` se pinta", async () => {
    entra("maestro");
    render(await AyudaDocumentoPage(props(["oficina", "wallet-caja"])));

    // El `#` del Markdown baja a `<h2>`: el `<h1>` de la página es «Ayuda», del `PageHeader`.
    expect(
      screen.getByRole("heading", { level: 2, name: "Wallet · Caja" }),
    ).toBeInTheDocument();
    // Y el cuerpo, no sólo el título: un render vacío pasaría la aserción de arriba si el
    // documento se quedara en su encabezado.
    expect(screen.getByText(/todo lo que entra y todo lo que sale/i)).toBeInTheDocument();
  });

  it("el `admin` también (el documento declara los dos roles)", async () => {
    entra("admin");
    render(await AyudaDocumentoPage(props(["oficina", "wallet-caja"])));
    expect(screen.getByRole("heading", { level: 2, name: "Wallet · Caja" })).toBeInTheDocument();
  });

  it("⭑ y el mensajero abre LA SUYA: el gate no es «todo el mundo menos la oficina»", async () => {
    entra("mensajero");
    render(await AyudaDocumentoPage(props(["mensajero", "reparto"])));
    expect(screen.getByRole("heading", { level: 2, name: "Reparto" })).toBeInTheDocument();
  });

  // ⭑ FICHA 435 · R21 — LA OFICINA ABRE LA AYUDA DE LOS OTROS PORTALES.
  //
  // Hasta hoy `/ayuda/mensajero/reparto` le daba 404 al maestro, y el acotamiento simétrico era
  // deliberado. La decisión del humano del 2026-09-16 lo cambia por una razón medida: la
  // oficina es quien atiende por teléfono las dudas de los 18 mensajeros y de las tiendas, y
  // quien contesta no tenía delante la misma pantalla que quien pregunta.
  //
  // ⚠️ ESTE ES EL CASO QUE MUERE si alguien devuelve `puedeLeerDocumento` al predicado
  // estricto: es el único sitio donde la mitad POSITIVA del ensanche se afirma sobre la página
  // real. Las negativas de arriba —mensajero, tienda y satélite contra la caja— siguen
  // intactas: lo que se ensanchó es la lectura de la OFICINA, no el gate.
  it("⭑ el maestro abre `/ayuda/mensajero/reparto`, que antes le daba 404", async () => {
    entra("maestro");
    render(await AyudaDocumentoPage(props(["mensajero", "reparto"])));
    expect(screen.getByRole("heading", { level: 2, name: "Reparto" })).toBeInTheDocument();
    // Y el cuerpo, no sólo el título: un `notFound()` mal doblado pasaría la línea de arriba
    // si la página se quedara en su encabezado.
    expect(screen.getByText(/esos viven en/i)).toBeInTheDocument();
  });

  it("y el admin también, y los dos leen la de la tienda y la del satélite", async () => {
    // Los tres portales ajenos, uno por uno: si el ensanche cubriera sólo `mensajero/`, este
    // caso lo dice. Son documentos cuyo `roles:` NO nombra ni a maestro ni a admin.
    for (const rol of ["maestro", "admin"] as const) {
      for (const slug of [
        ["tienda", "ordenes"],
        ["tienda", "mi-wallet"],
        ["satelite", "en-bodega"],
        ["mensajero", "cierre-del-dia"],
      ]) {
        entra(rol);
        await expect(
          AyudaDocumentoPage(props(slug)),
          `${rol} · ${slug.join("/")}`,
        ).resolves.toBeTruthy();
      }
    }
  });

  it("un documento `publico:` se le sirve a cualquiera de los cinco roles", async () => {
    // `publico/rastreo-de-paquete.md` explica una superficie que se usa SIN sesión, así que
    // esconderlo no protegería nada. Es el control de que el acotamiento no es «lista blanca
    // por carpeta» sino el `roles:` de cada documento.
    for (const rol of ["maestro", "admin", "mensajero", "adminTienda", "adminSatelite"] as const) {
      entra(rol);
      await expect(
        AyudaDocumentoPage(props(["publico", "rastreo-de-paquete"])),
        rol,
      ).resolves.toBeTruthy();
    }
  });

  it("el pie nunca ofrece un «Siguiente» que esa persona no pueda abrir", async () => {
    entra("mensajero");
    // Sólo el último documento del índice se queda sin «Siguiente», así que el recorrido
    // lleva su propio CONTADOR: sin él, un pie que dejara de pintar el enlace en todas
    // partes pasaría por bueno (la comprobación sería sobre cero enlaces).
    let conSiguiente = 0;
    for (const slug of [
      ["mensajero", "reparto"],
      ["mensajero", "recoleccion"],
      ["mensajero", "cierre-del-dia"],
      ["publico", "rastreo-de-paquete"],
    ]) {
      const { unmount } = render(await AyudaDocumentoPage(props(slug)));

      const siguiente = screen.queryByRole("link", { name: /^Siguiente:/ });
      if (siguiente !== null) {
        conSiguiente += 1;
        const href = siguiente.getAttribute("href") ?? "";
        expect(href.startsWith("/ayuda/"), href).toBe(true);
        // Lo que no puede pasar: ofrecerle un documento que su propio rol no puede leer.
        for (const ajeno of ["/ayuda/oficina/", "/ayuda/tienda/", "/ayuda/satelite/"]) {
          expect(href, `${slug.join("/")} ofrece ${href}`).not.toContain(ajeno);
        }
      }
      // El pie existe siempre: la vuelta al índice es del teléfono, donde el índice se esconde.
      expect(screen.getByRole("link", { name: "Volver al índice" })).toHaveAttribute(
        "href",
        "/ayuda",
      );
      unmount();
    }
    expect(conSiguiente).toBeGreaterThan(0);
  });
});
