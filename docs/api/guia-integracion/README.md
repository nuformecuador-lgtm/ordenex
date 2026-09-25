# Guía de integración — API de Ordenex (fuente editable)

Aquí vive la **fuente** del manual de integración del canal por API key que se entrega a los
integradores como PDF. Hasta septiembre de 2026 el manual existía solo como PDF y cada versión
había que reconstruirla desde el anterior; desde esta carpeta se edita el HTML y se regenera.

| Archivo | Qué es |
|---|---|
| `guia-integracion.html` | La guía completa: texto, tablas, ejemplos y la hoja de estilo (inline). Es lo único que se edita. |
| `generar-pdf.py` | Valida los ejemplos JSON del HTML e imprime el PDF con Chrome/Edge en modo headless. |

## Regenerar el PDF

```bash
python docs/api/guia-integracion/generar-pdf.py "C:/Users/<usuario>/Desktop/Guia-Integracion-API-Ordenex (mes año).pdf"
```

Sin argumento escribe `guia-integracion.pdf` al lado del HTML (ese PDF **no se commitea**: el
entregable se genera cuando hace falta). Los pies de página («Guía de integración — API de
Ordenex · n / N») salen de las reglas `@page` del HTML; la portada no lleva pie.

## Qué actualizar en cada versión

1. **La portada**: «Versión del documento: <mes año>».
2. **La sección «Cambios respecto de la versión de <anterior>»**: qué se rompe, desde cuándo, qué
   tiene que cambiar el integrador y la tabla de lo ya vigente. La fuente es
   `docs/api/CHANGELOG.md`: cada entrada del changelog posterior a la versión anterior tiene que
   estar reflejada.
3. **Las secciones afectadas**, contrastadas con el código y no con el spec:
   - rutas y validación: `app/api/ordenes/api-key/**`;
   - forma de las respuestas: `lib/api/openapi-spec.ts` (el `.yaml` es un espejo generado) y los
     DTO de `lib/types/api-orden.ts`, `lib/types/cotizacion.ts`, `lib/api/analitica-api-key-dto.ts`;
   - catálogo de estados y nombres visibles: `lib/types/order-status.ts` (`ORDER_STATUS_SEED`,
     `NOMBRE_ESTADO`, `DESCRIPCION_ESTADO`, `CODIGO_VIGENTE_DE_ANTERIOR`);
   - webhooks: `lib/types/webhook-eventos.ts` (`EVENTOS_PUBLICOS`), `lib/types/orden-evento.ts`,
     `lib/services/WebhookEstadoService.ts`, `lib/services/WebhookEventoOrdenService.ts`,
     `lib/crypto/webhook-firma.ts`, `lib/config/webhook.ts` y `lib/services/JobQueueService.ts`
     (reintentos);
   - eliminación, cancelación y habilitación: `lib/types/order-status-eliminables.ts`,
     `lib/repositories/OrdenRepository.ts` (`ESTADOS_CANCELABLES_API`),
     `lib/services/ApiHabilitacionService.ts`.
4. **El índice** («Contenido») si cambian las secciones.

## Reglas del documento

- Los **códigos anteriores** al cambio de nombres de estados (los siete de la tabla A.1 y los
  cuatro resultados de A.2) solo pueden aparecer en la sección de cambios. En el resto de la
  guía se usan los vigentes.
- Todos los bloques `<pre>` con JSON tienen que ser JSON válido; `generar-pdf.py` aborta si no.
  Los `curl` y los fragmentos con placeholders angulares (`<ordenId>`, `<host-de-storage>`) se
  admiten.
- Los importes, guías, UUID y claves son ilustrativos; nunca datos reales.
- Tono: «usted», frases cortas, un aviso `⚠` por cada comportamiento que suele sorprender.
