import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type {
  IWebhookSuscripcionService,
  RegistrarWebhookInput,
  RegistrarWebhookResult,
  RotarSecretoResult,
  WebhookSuscripcionVistaDTO,
} from "@/lib/interfaces/services/IWebhookSuscripcionService";
import { generarWebhookSecret } from "@/lib/utils/webhook-secret-generator";

// Feature 99 (design §9) — servicio de registro de la suscripcion de webhook. DI por
// INTERFACES (docs/architecture.md §Service): no conoce Next.js ni Prisma. El cifrado del
// secreto (`cifrar`) y la generacion (`generarSecreto`) se inyectan para testear el
// contrato R7/R32 (persistir cifrado, retornar en claro una vez) sin claves reales.
//
// PRIVACIDAD (R29): este archivo NUNCA loguea el secreto (ni en claro ni cifrado) ni la URL.

/** R5: la URL de callback debe ser ABSOLUTA y con esquema `https`. */
function esUrlHttpsAbsoluta(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    // URL relativa o malformada -> `new URL` lanza -> no es absoluta.
    return false;
  }
}

export class WebhookSuscripcionService implements IWebhookSuscripcionService {
  constructor(
    private readonly repo: IWebhookSuscripcionRepository,
    /** R7/R32: cifra el secreto en claro ANTES de persistir. Puede lanzar si no hay clave. */
    private readonly cifrar: (secretoPlano: string) => string,
    private readonly generarSecreto: () => string = generarWebhookSecret,
  ) {}

  async registrar(input: RegistrarWebhookInput): Promise<RegistrarWebhookResult> {
    // R5: validacion de URL en el borde; si falla, NO se persiste nada.
    if (!esUrlHttpsAbsoluta(input.url)) {
      return {
        status: "validation_error",
        fieldErrors: { url: ["La URL de callback debe ser absoluta y con esquema https"] },
      };
    }

    // R33 (gate P4): editar la URL NO rota el secreto. Si el owner YA tiene suscripcion,
    // solo se actualiza la URL (se conserva el secreto) y NO se devuelve secreto alguno.
    // R9: keyed por ownerUsuarioId; nunca se toca la de otro owner.
    const existente = await this.repo.findByOwner(input.ownerUsuarioId);
    if (existente) {
      await this.repo.actualizarUrlByOwner(input.ownerUsuarioId, input.url);
      return { status: "actualizada" };
    }

    // ALTA (R7/R32): se genera el secreto en claro, se CIFRA y se persiste SOLO el ciphertext.
    const secretoPlano = this.generarSecreto();
    const secretoCifrado = this.cifrar(secretoPlano);

    // R6: upsert por owner (no crea una segunda fila). R9: keyed por ownerUsuarioId.
    await this.repo.upsertByOwner({
      ownerUsuarioId: input.ownerUsuarioId,
      url: input.url,
      secret: secretoCifrado,
    });

    // R7: el secreto en claro sale exactamente UNA vez, aqui. No hay lectura que lo devuelva.
    return { status: "creada", secret: secretoPlano };
  }

  /**
   * R34 (gate P4): rotación explícita del secreto. Requiere una suscripción existente;
   * genera+cifra un secreto NUEVO (invalida el anterior) y lo devuelve en claro una vez.
   * R9: keyed por owner. `not_found` si el owner no tiene suscripción.
   */
  async rotarSecreto(ownerUsuarioId: string): Promise<RotarSecretoResult> {
    const existente = await this.repo.findByOwner(ownerUsuarioId);
    if (!existente) return { status: "not_found" };

    // R7/R32: nuevo secreto en claro -> CIFRA -> persiste SOLO el ciphertext (conserva la URL).
    const secretoPlano = this.generarSecreto();
    const secretoCifrado = this.cifrar(secretoPlano);
    await this.repo.actualizarSecretoByOwner(ownerUsuarioId, secretoCifrado);

    // R7: el secreto en claro sale exactamente UNA vez, aqui.
    return { status: "ok", secret: secretoPlano };
  }

  /** R8: baja logica keyed por owner (no afecta a otros owners, R9). */
  async desactivar(ownerUsuarioId: string): Promise<void> {
    await this.repo.desactivarByOwner(ownerUsuarioId);
  }

  /** R7: consulta de display SIN secreto. */
  async obtener(ownerUsuarioId: string): Promise<WebhookSuscripcionVistaDTO | null> {
    return this.repo.findByOwner(ownerUsuarioId);
  }
}
