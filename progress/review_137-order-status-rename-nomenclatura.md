# review 135 - Rename de nomenclatura de order_status

Reviewer (verifica, no edita). Insumos: requirements/design/tasks R1-R13, impl_135,
commits e044e05 (backend) + 36d12bd (frontend). Verificacion propia con vitest DIRIGIDO
(Prisma client NO generado en el worktree; se corrieron suites estaticas/parser y de
logica que no dependen del client en runtime) + censo case-sensitive independiente + diffs.

## VEREDICTO: APROBADO-CON-NOTAS
Sin BLOQUEANTES de codigo ni de trazabilidad. Feature code-complete y correcta: trazabilidad
R1-R13 completa y verificada, mapeo del gate correcto, R9 breaking en todas las capas, R6/R8
correctos, censo R13 limpio. Quedan 3 items de CHECKPOINTS (bookkeeping + T4) que el
leader/implementer DEBE cerrar antes de pasar a done; no son defectos de codigo.

## Checklist CHECKPOINTS
- [x] requirements.md (EARS R1-R13) / design.md (alternativa descartada, sec 4) / tasks.md existen.
- [~] tasks.md todas [x] -> NO: 0/21 marcadas (todas [ ]). Nota-1.
- [x] Cada R<n> mapea a >=1 test concreto y real (no vacio). Verificado 1:1.
- [x] impl_<feature>.md contiene el mapa R->test (backend + frontend).
- [x] typecheck/lint/test VERDE segun leader (init.sh verde, 484 files / 4815 tests). Re-corri
      dirigido guard, migracion, tipos, labels, webhook, logica R7, api-key R9: todas verdes.
- [x] E2E: 7 specs e2e actualizados a nuevos values.
- [x] RLS N/A (no tablas/policies). Secrets N/A. Webhook: no hay nuevo; solo lista de eventos (R9).
- [x] Capas separadas intactas (solo literales).
- [x] Multi-pais/hardcode N/A.
- [~] ./init.sh: leader lo establecio VERDE; en worktree corta por gate max-2-in_progress (leader).
- [~] history.md con entrada 135 -> NO existe. Nota-2.
- [x] review_<feature>.md existe (este archivo).

## Trazabilidad R1-R13 (COMPLETA)
- R1  order-status.test.ts: set==15 nuevos, sin los 6 viejos. VERDE.
- R2  rename-nomenclatura-migration.test.ts: 6 UPDATE antiguo->nuevo, sin ALTER TYPE/CREATE/DROP/id. VERDE.
- R3  idem: 6 UPDATE inversos + round-trip UP-DOWN exacto. VERDE.
- R4  idem: SQL aplicado a catalogo+FK en memoria; id preservado, orden/historial sin reescritura,
      conteos estables. En-memoria, NO DB real (T4, Nota-3).
- R5  OrderStatusValue = (typeof ORDER_STATUS_SEED)[number]; posicionales [8]=por_recoger,
      [10]=en_ruta, [13]=devuelta_a_tienda con indice conservado. VERDE.
- R6  EstatusBadge: claves LABELS/VARIANT/CLASS renombradas; diff confirma variante/clase 1:1
      (secondary/info/danger/success mapean antiguo->nuevo).
- R7  guia-asignacion / cierre-dia / orden-repository.cancelar-api VERDES; value->id con nuevos.
- R8  EstatusLabel.test.ts mapa hardcodeado (no tautologico) = value legible; abreviaturas viejas
      eliminadas (En B. Central / Enviando a B. Central / Por recibir en satelite / En satelite / En tienda). VERDE.
- R9  openapi-spec.ts + api-key-openapi.yaml + webhook-eventos.ts con nuevos values, 0 viejo en yaml;
      ordenes-api-key-listado.route.test.ts VERDE. Sin capa de traduccion.
- R10 order-status-enum-migration.test.ts afirma 8 literales HISTORICOS, DESACOPLADO del seed. VERDE.
- R11 WHERE igualdad exacta (no LIKE, no toca *_satelite); en_bodega exacto; defaults
      en_preparacion/en_fulfillment intactos (lib/config/ordenes.ts).
- R12 Posicionales conservan indice; test NUEVO de migracion rename; suites de datos verdes.
- R13 censo-order-status-rename.test.ts VERDE; censo INDEPENDIENTE confirma que los 6 viejos solo
      aparecen en archivos de la allowlist (guard + migraciones historicas R10 + traza UP/DOWN).

Mapeo del gate correcto (6to = devuelta_a_tienda, NO en_tienda): confirmado; grep en_tienda
(word-boundary) en lib/app/components/hooks/scripts = 0 (la stale en_tienda solo vive en la
description de feature_list.json, fuera de alcance).

## Hallazgos

### Notas obligatorias pre-done (cerrar antes de done; NO son defectos de codigo)
- Nota-1 (CHECKPOINT tasks): specs/135-.../tasks.md tiene las 21 tasks en [ ] (0 en [x]).
  CHECKPOINTS exige todas [x] para done. Metadato: el trabajo esta hecho y verificado.
- Nota-2 (CHECKPOINT history): progress/history.md sin entrada 135. Falta anadirla (cierre del leader).
- Nota-3 (T4 diferido): db:migrate/db:rollback NO se ejecuto (sin .env/DB local). R2/R3/R4 trazados
  por test estatico + round-trip en-memoria. ACEPTABLE como deuda post-merge (precedente repo:
  metodo_pago / embalaje_en_fulfillment; 6 UPDATE triviales con UNIQUE). ACCION: post-merge
  prisma migrate deploy + verificar down.sql con db:rollback en entorno con DB.

### menor
- Titulos de seccion estaticos "En bodega" (OrdenesRevisionMaestro.tsx:210 y region-name en
  OrdenesRevisionMaestro.test.tsx / reintentos-escalado.spec.ts:193): sin cambiar. COHERENTE:
  R8 gobierna ORDER_STATUS_LABELS (badge), no los headings, que ya divergian por diseno
  (por_recoger -> "En espera de aceptacion del mensajero", devolviendo_a_tienda -> "Devueltas a
  origen"). Sin fuga de literal viejo (texto humano "En bodega", no en_bodega). Deuda UI opcional.
- OrdenesPage.test.tsx:112 fixture estatusValue "En bodega" es texto de display, no value literal. OK.
- T18 scripts/seed-ordenes-qa.ts no existe (no-op); seed-catalogos.ts itera la tupla. OK.
- Allowlist del guard incluye cierre-detail/zonas-migration que hoy no contienen los 6 viejos;
  sobre-amplia pero inocua (referencian nombres de carpeta historica).

## Resumen
Rename correcto y completo. Trazabilidad R1-R13 verificada 1:1 con tests reales. Sin BLOQUEANTES.
Cerrar Notas 1/2/3 (marcar tasks.md, entrada en history.md, aplicar+revertir migracion post-merge)
antes de pasar 135 a done.
