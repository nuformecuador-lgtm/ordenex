import { describe, it, expect } from "vitest";

import { hrefSeguro, linkificar } from "@/lib/utils/linkificar";

// Feature 308 (R33/R34) — trocear un mensaje del cliente en texto + enlaces.
//
// Lo que se fija aqui: se enlaza SOLO el tramo de la URL (D6) y NINGUN esquema distinto de
// http/https produce enlace. El texto lo escribe un tercero, asi que esto es una barrera de
// seguridad, no una comodidad.

describe("linkificar (R33/R34)", () => {
  it("R33: enlaza solo el tramo de la URL y deja el resto como texto", () => {
    const segmentos = linkificar("mira https://x.co/a. gracias");

    expect(segmentos).toEqual([
      { tipo: "texto", valor: "mira " },
      { tipo: "enlace", valor: "https://x.co/a", href: "https://x.co/a" },
      { tipo: "texto", valor: ". gracias" },
    ]);
  });

  it("R33: un texto sin ninguna URL devuelve un unico segmento de texto", () => {
    expect(linkificar("hola, ya llegue")).toEqual([
      { tipo: "texto", valor: "hola, ya llegue" },
    ]);
  });

  it("R33: dos URL en el mismo mensaje producen dos enlaces separados", () => {
    const enlaces = linkificar("a http://uno.co b https://dos.co/x c")
      .filter((s) => s.tipo === "enlace")
      .map((s) => s.valor);

    expect(enlaces).toEqual(["http://uno.co", "https://dos.co/x"]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
  ])("R34: %s NO produce ningun segmento de enlace", (peligroso) => {
    const segmentos = linkificar(`ojo ${peligroso} fin`);

    expect(segmentos.some((s) => s.tipo === "enlace")).toBe(false);
    // Y el texto sigue completo: no se pierde nada por el camino.
    expect(segmentos.map((s) => s.valor).join("")).toBe(`ojo ${peligroso} fin`);
  });

  it("R34: un `javascript:` PEGADO a una URL valida no contamina el href del enlace", () => {
    const segmentos = linkificar("https://x.co/a javascript:alert(1)");
    const enlaces = segmentos.filter((s) => s.tipo === "enlace");

    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]).toMatchObject({ href: "https://x.co/a" });
    expect(segmentos.map((s) => s.valor).join("")).toBe(
      "https://x.co/a javascript:alert(1)",
    );
  });

  it("R33: la puntuacion final se queda fuera del enlace pero no se pierde", () => {
    for (const signo of [".", ",", ";", ":", "!", "?", ")", "]"]) {
      const segmentos = linkificar(`ver https://x.co/a${signo}`);
      const enlace = segmentos.find((s) => s.tipo === "enlace");

      expect(enlace).toMatchObject({ valor: "https://x.co/a" });
      expect(segmentos.map((s) => s.valor).join("")).toBe(`ver https://x.co/a${signo}`);
    }
  });

  it("no reordena ni duplica el mensaje: la concatenacion es el texto original", () => {
    const original = "https://a.co/1 en medio https://b.co/2 final";
    expect(linkificar(original).map((s) => s.valor).join("")).toBe(original);
  });

  it("un texto vacio no produce segmentos", () => {
    expect(linkificar("")).toEqual([]);
  });

  it("R33: un parentesis de cierre EMPAREJADO es parte de la URL y no se recorta", () => {
    // Medido: la Wikipedia esta llena de URL asi, y comerse el `)` deja el enlace roto.
    const url = "https://es.wikipedia.org/wiki/Costa_Rica_(desambiguacion)";
    const enlace = linkificar(url).find((s) => s.tipo === "enlace");

    expect(enlace).toMatchObject({ valor: url, href: url });
  });

  it("R33: un parentesis de cierre SIN pareja sigue quedando fuera del enlace", () => {
    const segmentos = linkificar("mira (https://x.co/a) y ya");
    const enlace = segmentos.find((s) => s.tipo === "enlace");

    expect(enlace).toMatchObject({ valor: "https://x.co/a" });
    expect(segmentos.map((s) => s.valor).join("")).toBe("mira (https://x.co/a) y ya");
  });

  it("R33: `www.` sin esquema se enlaza a https, y el texto visible NO gana el esquema", () => {
    // Decision humana: en WhatsApp ese mismo mensaje se ve como enlace, asi que aqui tambien.
    const segmentos = linkificar("entra a www.ordenex.co por favor");
    const enlace = segmentos.find((s) => s.tipo === "enlace");

    expect(enlace).toEqual({
      tipo: "enlace",
      valor: "www.ordenex.co",
      href: "https://www.ordenex.co",
    });
    expect(segmentos.map((s) => s.valor).join("")).toBe("entra a www.ordenex.co por favor");
  });

  it("R34: el href construido para `www.` pasa por la MISMA barrera de esquema", () => {
    for (const s of linkificar("www.ordenex.co/guia?x=1")) {
      if (s.tipo === "enlace") expect(s.href.startsWith("https://")).toBe(true);
    }
  });

  it("un dominio suelto sin esquema ni `www.` NO se enlaza (decision, no olvido)", () => {
    // Enlazar `algo.co` obliga a enlazar tambien `5.30pm`: el humano prefirio el falso
    // NEGATIVO raro al falso POSITIVO constante.
    expect(linkificar("ordenex.co/guia").some((s) => s.tipo === "enlace")).toBe(false);
  });

  it("una hora escrita con punto NO se convierte en enlace", () => {
    expect(linkificar("llego a las 5.30pm").some((s) => s.tipo === "enlace")).toBe(false);
  });

  it("dos URL con query string se enlazan enteras, con sus parametros", () => {
    const enlaces = linkificar("dos: https://a.co y https://b.co/x?q=1&z=2")
      .filter((s) => s.tipo === "enlace")
      .map((s) => s.href);

    expect(enlaces).toEqual(["https://a.co", "https://b.co/x?q=1&z=2"]);
  });
});

// --------------------------------------------------------------------------------------------
// La SEGUNDA barrera de R34, fijada aparte. `linkificar` no puede ejercitarla: `CANDIDATO_URL`
// —la primera barrera— ya impide que `javascript:` llegue a `hrefSeguro`, asi que borrar el
// chequeo de protocolo deja la suite entera VERDE (lo comprobo el reviewer de la 308). Estos
// tests invocan el helper DIRECTAMENTE para que la defensa en profundidad no se pueda retirar
// por «redundante»: si alguien amplia la regex de candidatos, la barrera tiene que seguir ahi.
// --------------------------------------------------------------------------------------------
describe("hrefSeguro — chequeo de protocolo (R34, segunda barrera)", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "blob:https://app.test/abcd",
  ])("%s NO produce href", (candidato) => {
    expect(hrefSeguro(candidato)).toBeNull();
  });

  it("lo que ni siquiera parsea como URL tampoco produce href", () => {
    expect(hrefSeguro("http://")).toBeNull();
    expect(hrefSeguro("no es una url")).toBeNull();
  });

  it("http y https si, y al `www.` se le antepone https antes del MISMO chequeo", () => {
    expect(hrefSeguro("https://ordenex.co/guia")).toBe("https://ordenex.co/guia");
    expect(hrefSeguro("http://ordenex.co")).toBe("http://ordenex.co");
    expect(hrefSeguro("www.ordenex.co")).toBe("https://www.ordenex.co");
    expect(hrefSeguro("WWW.ordenex.co")).toBe("https://WWW.ordenex.co");
  });
});
