# Feature 256 — Tasks

Checklist de pasos discretos y verificables. `[P]` = paralelizable con la task inmediatamente
anterior del mismo bloque. Cada task lleva su criterio de «hecho».

> **Puerta humana RESUELTA el 2026-08-21.** Decisiones firmadas y ya aplicadas aquí: el campo se
> llama **`motivo`**, plano en `data`, value **crudo** del enum, **siempre presente**; alcance
> **solo `devuelta`**; la causa es la **vigente al entregar** (payload del job intacto); el
> evento **se publica** en el OpenAPI (T10, ya no es condicional); el **aviso a integradores no
> es tarea de esta feature**. Nada de esto se reabre durante la implementación: si algo no
> encaja, se para y se pregunta, no se decide sobre la marcha.

---

## Bloque 0 — Preparación

### T0. Baseline medido, no supuesto
- Rama `feature/256-webhook-motivo-devolucion` desde el `dev` (o `ux`) vigente.
- Correr y ANOTAR el resultado de: `tests/unit/services/webhook-estado-service.test.ts`,
  `tests/unit/types/webhook-eventos.test.ts`, `tests/unit/api/openapi-contrato-en-reparto.test.ts`,
  `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts`.
- **Hecho:** el número de verdes/rojos ANTES del cambio está escrito en
  `progress/impl_256.md`. Un rojo preexistente aquí no se atribuye a esta feature (ni se
  esconde).

---

## Bloque 1 — Código (secuencial: cada uno depende del anterior)

### T1. `DatosEntregaOrden` gana `causaDevolucion` (dep: T0)
- `lib/interfaces/repositories/IWebhookOrdenReader.ts`: campo **requerido**
  `causaDevolucion: CausaDevolucion | null`, tipo importado de `lib/types/causa-devolucion.ts`,
  con el comentario que explica los dos orígenes del `null` (design §2.1).
- ⚠️ El DTO interno se llama `causaDevolucion` A PROPÓSITO; `motivo` es solo el nombre de cable
  (design §2.3). No renombrar el DTO «por coherencia».
- **Hecho:** `pnpm typecheck` falla ÚNICAMENTE en los fakes de
  `tests/unit/services/webhook-estado-service.test.ts` (`:27-33` y sus derivados). Ese rojo es
  la señal esperada, no un accidente.

### T2. `WebhookOrdenReader` proyecta la causa (dep: T1)
- Relación anidada `gestiones` con `where { resultado: 'devuelta', anuladaAt: null }`,
  `orderBy createdAt desc`, `take: 1`, `select { causaDevolucion }`, DENTRO del
  `orden.findUnique` que ya existe (design §2.2). Constante local tipada para el literal
  `'devuelta'`, molde de `OrdenRepository.ts:318`.
- **Hecho:** el `Pick<PrismaClient, "orden" | "orderStatus">` de `:10` sigue igual (no se añade
  el delegate `gestionOrden`) y el método sigue haciendo exactamente 2 llamadas a Prisma.

### T3. El service publica `data.motivo` (dep: T2)
- `lib/services/WebhookEstadoService.ts:89-93`: `motivo` como CUARTA clave de `data`, detrás de
  `estado`, con la ramificación por estado destino EN EL SERVICE
  (`motivo: datos.estado === "devuelta" ? datos.causaDevolucion : null`, design §2.3).
- Comentario obligatorio en esa línea: `data.motivo` (enum de devolución) **no es**
  `gestion_orden.motivo` (texto libre, que nunca se emite — R22), con la referencia a
  `db/schema.prisma:814` y `:823`.
- **Hecho:** el diff del service es de una línea (más comentario) y no toca firma, cabeceras ni
  desenlaces.

---

## Bloque 2 — Tests (T4–T9; T4 y T5 pueden ir en paralelo tras T3)

### T4. Test de repositorio: qué gestión manda (dep: T2) — **R8, R9, R10, R11, R12**
- Archivo NUEVO `tests/unit/repositories/webhook-orden-reader.test.ts` (hoy no existe ninguno,
  design §5.1.3), con un Prisma fake que registra los argumentos.
- Casos, uno por requisito:
  - R8: con dos gestiones `devuelta` vigentes, devuelve la causa de la de `createdAt` mayor.
  - R9: una gestión `devuelta` con `anuladaAt != null` NO se considera (el `where` la excluye).
  - R10: una gestión `entregada`/`incidente` posterior no desplaza a la `devuelta` vigente y su
    causa de incidente NUNCA aparece en el campo.
  - R11: el `where` de la relación cuelga de la orden pedida; no hay consulta libre a
    `gestionOrden`.
  - R12: el reader hace 2 llamadas a Prisma, las mismas que antes.
- **Hecho:** los 5 casos verdes y cada uno nombrado con su `R<n>`.

### T5. [P] Test de service: el campo, sus valores y su forma (dep: T3) — **R1, R2, R3, R6, R7, R19, R22**
- Se AMPLÍA `tests/unit/services/webhook-estado-service.test.ts` (no se sustituye):
  - R1/R2: evento `devuelta` con causa → `data.motivo === "not_found"` (y las otras dos), value
    crudo, sin traducir.
  - R3: ningún valor fuera de los tres del `CAUSA_DEVOLUCION_SEED` puede salir en `data.motivo`
    (recorrido del SEED como fuente de verdad); una causa de incidente nunca aparece ahí.
  - R6: evento `en_reparto` → el campo EXISTE y vale `null`.
  - R7: `Object.keys(body.data)` es exactamente
    `["numGuia","numRemision","estado","motivo"]` — reemplaza al `toEqual` de `:94`, que se
    actualiza aquí (design §5.1.1).
  - R19: `numGuia`, `numRemision`, `estado` intactos; `body.orden` sigue `undefined`.
  - R22: **el test de los dos `motivo`** — con una gestión que tiene causa tipificada Y texto
    libre, el cuerpo lleva el enum y NO contiene el texto libre por ningún lado.
- **Hecho:** el rojo esperado de `:94` queda resuelto por actualización consciente, no borrando
  la aserción, y R22 tiene un test que se lee como advertencia.

### T6. Los dos caminos del `null` (dep: T5) — **R4, R5**
- R4: gestión `devuelta` vigente con `causa_devolucion` NULL (histórico previo a la 73) →
  `motivo: null`, entrega normal, sin error.
- R5: orden sin ninguna gestión `devuelta` vigente → `motivo: null`, entrega normal.
- El caso R4 se cubre en los DOS niveles: fake del reader (service) y fila sin causa (T4).
- **Hecho:** ambos casos verdes y el test dice en su nombre por qué el `null` es legítimo.

### T7. Idempotencia (dep: T5) — **R13, R14, R16**
- R13: se AMPLÍA el test de `:146-154` para que compare los cuerpos byte a byte con el campo
  nuevo informado (no `null`).
- R14: dos ejecuciones con `now` distinto producen `data` idéntico.
- R16: `X-Ordenex-Signature` verifica contra `${ts}.${cuerpo}` con el cuerpo YA ampliado
  (extensión del assert de `:99-101`).
- **Hecho:** los tres verdes; ninguno relaja una aserción existente.

### T8. La ventana declarada (dep: T7) — **R15**
- Reader que responde `not_found` en la 1.ª llamada y `null` en la 2.ª (anulación entre
  intentos): el segundo cuerpo lleva `null`, el `eventoId` es el MISMO, no se lanza error y no
  se emite un evento adicional.
- **Hecho:** el test existe y su nombre afirma la promesa en positivo: «el `motivo` es el
  VIGENTE AL ENTREGAR». Sin este test, la feature no está hecha (design §4).

### T9. [P] No-regresión del contrato (dep: T3) — **R17, R18, R20, R21, R23**
- R17: `tests/unit/types/webhook-eventos.test.ts` sigue verde **sin editarlo**; se añade un
  assert de que `EVENTOS_PUBLICOS` y `ORIGENES_SIN_EVENTO_PUBLICO` no cambian de tamaño.
- R18: payload y `dedupeKey` del job idénticos
  (`tests/unit/services/webhook-estado-encolado.test.ts` verde sin editarlo).
- R20: los cinco desenlaces (`:104-107`, `:123-143`, `:110-121`, `:190-200`) siguen verdes con
  el campo nuevo en los fakes.
- R21: el aislamiento por owner (`:157-172`) sigue verde.
- R23: el test de logs (`:174-188`) sigue verde y se le añade que la causa no viaja al logger.
- **Hecho:** ninguno de esos tests se debilita; los que se tocan es solo para completar los
  fakes.

---

## Bloque 3 — Documentación pública

### T10. Publicar el evento en el OpenAPI (dep: T3) — **R24**
- Sección `webhooks:` de NIVEL SUPERIOR en `lib/api/openapi-spec.ts` con el evento
  `orden.estado_actualizado` completo, y su espejo textual en `docs/api/api-key-openapi.yaml`,
  en el MISMO commit.
- Contenido mínimo: las cuatro claves de `data`; los tres valores de `motivo`; que `motivo` es
  `null` fuera de `devuelta` y también en una `devuelta` sin causa; que el `motivo` es el
  vigente AL ENTREGAR (R15); y las cabeceras de firma.
- ⚠️ El campo `estado` se documenta como `type: string` con prosa, **sin `enum` literal de
  estados**: un 5.º bloque de catálogo pone roja
  `tests/unit/api/openapi-contrato-en-reparto.test.ts` en `:74`, `:96` y `:124` (design §5.2).
  El `enum` de los tres valores de `motivo` sí se escribe.
- **Hecho:** `openapi-contrato-en-reparto` y `openapi-177-paths-pdf-y-carga-id` siguen VERDES
  sin editarlas, y el `.yaml` es espejo exacto del TS.

---

## Bloque 4 — Cierre

### T11. Trazabilidad y gate (dep: T4–T10)
- `progress/impl_256.md` con la tabla `R1..R24 → archivo::nombre del test`, sin huecos (el
  reviewer rechaza si falta alguno) y con el baseline de T0 comparado contra el final.
- `./init.sh --rapido` en verde.
- **Hecho:** delta de rojos = 0 respecto al baseline de T0, y las 24 filas de trazabilidad
  apuntan a un test que existe y corre.

> **Nota, no task:** el aviso a integradores lo maneja el humano (decisión (g), 2026-08-21). El
> cambio es aditivo y no bloquea el despliegue. No hay tarea de release en esta feature.

---

## Mapa requisito → test (resumen)

| R | Task | Dónde |
| --- | --- | --- |
| R1, R2, R3 | T5 | `tests/unit/services/webhook-estado-service.test.ts` |
| R4, R5 | T6 | service + `tests/unit/repositories/webhook-orden-reader.test.ts` |
| R6, R7 | T5 | service |
| R8, R9, R10, R11, R12 | T4 | `tests/unit/repositories/webhook-orden-reader.test.ts` |
| R13, R14, R16 | T7 | service (idempotencia) |
| R15 | T8 | service (vigente al entregar) |
| R17, R18, R20, R21, R23 | T9 | webhook-eventos / webhook-estado-encolado / service |
| R19, R22 | T5 | service (R22 = los dos `motivo`) |
| R24 | T10 | `openapi-spec.ts` + `docs/api/api-key-openapi.yaml` |
