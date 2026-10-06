import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// Ficha 474 (T5.3) — el composition root de plantillas PASA las tres dependencias nuevas, no solo
// las importa (memoria «el composition root que no inyecta»: 2 de 7 notificadores muertos con la
// suite verde). Las dependencias son opcionales en el constructor para no romper suites antiguas,
// asi que un olvido aqui no lo detectaria el typecheck:
//   - `envios` (R10): sin el, se desactiva una plantilla que usa un envio encendido;
//   - `resolutorAppId` (R9): sin el, toda plantilla con documento diria «falta configurar»;
//   - el proveedor del documento de ejemplo en el puerto (R5): sin el, la propagacion y el
//     reintento lanzan para toda plantilla con documento.

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const leer = (rel: string) => quitarComentarios(fs.readFileSync(path.join(RAIZ, rel), "utf8"));

function cuerpoDe(codigo: string, firma: string): string {
  const i = codigo.indexOf(firma);
  if (i === -1) throw new Error(`no se encontro ${firma}`);
  const abre = codigo.indexOf("{", codigo.indexOf(")", i));
  let nivel = 0;
  for (let j = abre; j < codigo.length; j++) {
    if (codigo[j] === "{") nivel += 1;
    if (codigo[j] === "}") {
      nivel -= 1;
      if (nivel === 0) return codigo.slice(abre, j + 1);
    }
  }
  throw new Error(`no se cerro ${firma}`);
}

describe("474/T5.3 — buildPlantillaService inyecta envios y resolutor", () => {
  const acciones = leer("lib/actions/plantillas.ts");

  it("autocomprobacion: el fuente se leyo", () => {
    expect(acciones.length).toBeGreaterThan(2000);
  });

  it("⭑ el `new PlantillaMensajeService(` recibe envios: new WhatsappEnvioRepository y resolutorAppId: new ResolutorAppIdMeta", () => {
    const cuerpo = cuerpoDe(acciones, "function buildPlantillaService()");
    const llamada = cuerpo.slice(cuerpo.indexOf("new PlantillaMensajeService("));
    expect(llamada).toMatch(/envios:\s*new WhatsappEnvioRepository\(/);
    expect(llamada).toMatch(/resolutorAppId:\s*new ResolutorAppIdMeta\(/);
  });

  it("⭑ MUTACION: sin el tercer argumento el detector sale rojo", () => {
    const mutado = "{ return new PlantillaMensajeService(repo, buildWhatsappPropagator(prisma, repo)); }";
    expect(/envios:\s*new WhatsappEnvioRepository\(/.test(mutado)).toBe(false);
  });

  it("la propagacion usa la fabrica compartida del puerto", () => {
    const cuerpo = cuerpoDe(acciones, "function buildWhatsappPropagator(");
    expect(cuerpo).toContain("construirWhatsappTemplatePort(config)");
  });
});

describe("474/T5.3 — la fabrica del puerto pasa el proveedor del documento", () => {
  it("⭑ construirWhatsappTemplatePort construye el puerto CON ProveedorHandleDocumentoEjemplo", () => {
    const fab = leer("lib/services/whatsapp/construir-template-port.ts");
    const cuerpo = cuerpoDe(fab, "export function construirWhatsappTemplatePort(");
    expect(cuerpo).toMatch(/new WhatsappTemplatePort\([\s\S]*new ProveedorHandleDocumentoEjemplo\(/);
    expect(cuerpo).toContain("new ResolutorAppIdMeta(");
    expect(cuerpo).toContain("new WhatsappSubidaReanudableClient(");
  });

  it("⭑ el job de reintento de plantillas usa la MISMA fabrica", () => {
    const handler = leer("lib/services/jobs/whatsapp-template-sync-handler.ts");
    expect(handler).toContain("construirWhatsappTemplatePort(config)");
    expect(handler).not.toContain("new WhatsappTemplatePort(");
  });
});
