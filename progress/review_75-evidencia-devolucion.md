# Review — Feature 75: evidencia (foto) obligatoria en `devuelta`

Reviewer. Worktree `ordenex-f73`, rama `feature/75-evidencia-devolucion` (trabajo sin commitear).
Contrato: espejo exacto de la rama `rechazada`; feature 47 (escalado) y 73 (causa) NO cambian.

## Checklist

- [x] Schema: `gestionarSchema` rama `devuelta` suma `evidencia: evidenciaSchema` (obligatoria, mismo R24).
- [x] Tipo: `GestionarInput` rama `devuelta` gana `evidencia: EvidenciaArchivo` (obligado por el tipo).
- [x] Action: `toGestionarInput` case `devuelta` hace `leerEvidencia(...)`, espejo de rechazada.
- [x] Service subida pre-tx: el `if` incluye `"devuelta"`; sube al bucket antes de la tx.
- [x] Service persistencia: `buildGestionData` case `devuelta` emite `evidenciaStoragePath`/`evidenciaContentType`.
- [x] Repo persiste los campos genéricamente (`GestionOrdenRepository.ts:224-225`) — sin cambios, ya soportado.
- [x] `catch`/`storage.remove` cubre `devuelta` (mismo bloque pre-tx que rechazada); test lo cubre.
- [x] UI: rama `devuelta` suma `<input type=file accept=ACCEPT_MIME>` + error, espejo de rechazada; `buildRaw`/`buildFormData` incluyen evidencia.
- [x] Feature 47 intacta: `resolverSeguimientoDevuelta`/`contarIntentos`/escalado NO aparecen en el diff de producción (0 ocurrencias); los 3 tests de reintento/escalado solo AÑADEN `evidencia` al input, sin remover aserciones de transición.
- [x] Feature 73 intacta: tests de causa/motivo conservan sus aserciones; helpers añaden evidencia por defecto para aislar el fallo a SU campo.
- [x] Coherencia UI↔schema: UI envía `evidencia`, schema la exige.
- [x] Tests son AMPLIACIÓN, no aflojamiento: única aserción modificada es `fd.get("evidencia") toBeNull() -> toBeInstanceOf(File)`, cambio de contrato correcto. Se suman casos "sin evidencia -> validation_error en `evidencia`" y "no-imagen -> inválido" en schema, action y service.
- [x] typecheck 0 errores.
- [x] lint 0 errores (139 warnings preexistentes, ninguno en archivos tocados).
- [x] 7 archivos afectados: 155/155 tests pasan.

## Hallazgos

- menor: No hay `specs/75/{requirements,design,tasks}.md` ni `progress/impl_75.md`. Acordado como "sin spec formal / espejo exacto de rechazada", por lo que CHECKPOINTS §Especificación/Trazabilidad no aplican en su forma estándar; se deja constancia.

## Medido por el reviewer

- typecheck: 0 errores.
- lint: 0 errores, 139 warnings (preexistentes).
- tests (7 afectados): 155 passed / 155.

## Veredicto: APROBADO (OK)

0 bloqueantes. El cambio es un espejo fiel de la rama `rechazada`: evidencia obligatoria,
subida pre-tx con limpieza en fallo, persistida en el INSERT. Feature 47 y 73 sin regresión.
