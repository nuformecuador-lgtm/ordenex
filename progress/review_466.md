# review_466 — «rechazo» pasa al nombre vigente

> Revisado: `origin/feature/466-rechazo-nombre-nuevo` @ `18078913` (merge-base con `dev` = `550803ed`).
> Contra `specs/466-rechazo-nombre-nuevo/{requirements,design,tasks}.md`, `specs/455-un-nombre-por-estado/`,
> `docs/` y `CHECKPOINTS.md`. Fecha: 2026-10-01. Reviewer.
>
> Restricción del leader: SIN `./init.sh` completo ni dev server (había otro gate corriendo). Verifiqué con
> vitest sobre archivos concretos y mutaciones propias, restaurando siempre por copia (árbol limpio al final).
> Búsqueda: el MCP `codebase-memory` estaba disponible, pero el barrido es de TEXTO plano (literales, docs),
> que la regla 7 deja a `grep`; no hizo falta localizar símbolos.

## Veredicto: **RECHAZADO**

El código está bien hecho y la tabla del spec se aplicó tal cual. Lo rechazan dos cosas pequeñas y concretas:
una línea de documentación de integradores que sigue nombrando el resultado como «rechazo» (R9) y la
Fase 3 sin cerrar (T3.2 «Ver la app» sin ejecutar y `tasks.md` sin ninguna `[x]`). Ver «Qué falta».

## Checklist

### Especificación y tareas
- [x] `requirements.md` con R1-R28 en EARS; `design.md` con 5 alternativas descartadas.
- [ ] **`tasks.md` con todas las tareas `[x]`: 0 de 17 marcadas.** (Los de la 455-462 sí se marcan.)
- [ ] **T3.2 «Ver la app» (Playwright, Excel abiertos): no hay rastro en `progress/impl_466.md`.**
- [x] T3.1 matriz R1-R28 → test en `progress/impl_466.md` (sección «Mapa R1–R28 → test (COMPLETO)»).

### Tabla antes → después (§0)
- [x] **C1-C38**: los 38 conceptos, comparados uno a uno con el diff de `lib/`, `app/`, `components/`. Coinciden
  literalmente, incluido el sufijo «cobrado a la tienda» (Pregunta 4), C23 «Fecha de la devolución a origen»,
  C31 por `nombreDeResultado` y C32 «… responsable del mensajero.».
- [x] **K1-K4**: `metrics.ts` (etiquetas; `descripcion` intactas salvo dos frases de §0.5 en `ingreso_flete`/
  `ingreso_iva`, solo texto), leyenda de `catalogo-paneles.ts` = etiqueta de la métrica, `% de devolución a
  origen`, `Devolución a origen (%)`.
- [x] **E1-E13**: E1-E3 con `estatusLabel(...)`, E4/E6/E12/E13 con `NOMBRE_ESTADO`, E5 «Entregado o Devolución a
  origen por rechazo», E7 «La orden quedó en Devolución a origen por rechazo.», E8-E11 literales del spec.
- [x] Nada de ids cambiado: claves `rechazo`/`retorno`/`rechazadas`, ids `rechazos`/`tasa_rechazo`, categorías,
  `origen_tipo`, `cobro_rechazo_tienda_*`, `rechazo_tienda_cobro`, nombres de archivo y componente.
- [x] OpenAPI (`openapi-spec.ts` + `.yaml`): el diff son SOLO cadenas `description` (4 bloques, espejo idéntico);
  ningún `properties`/`required`/`enum`/`type`. CHANGELOG con entrada «Sin ruptura» (R19).
- [x] Sin `db/`, `prisma/`, migraciones, `lib/auth/**` ni `middleware` en el diff (R26, R28).

### Tests (ejecutados por mí)
- [x] Núcleo: guardia 466, guardia 338, `estado-con-info`, `nombres-estado-retirados`, `fuente-unica-nombre-estado`,
  `rechazo-nombre-466-lib`, `rechazo-nombre-466-app`, `openapi-466-descripciones`, `changelog-455`:
  **9 archivos, 82 tests, verde**.
- [x] Todos los tests tocados por la rama (salvo `tests/integration/db`, sin `.env` en el worktree) más los
  directorios enteros `tests/unit/{guards,api,analytics,asistente,descarga,historial-accion,notificaciones,types,utils}`:
  **703 archivos, 10 350 tests, verde, 0 skipped**.
- [ ] `./init.sh` completo: NO lo corrí (orden del leader). `progress/gate_466_frontend.log` (commiteado en
  `18078913`) dice `Tests 32406 passed | 26 skipped`, `INIT_EXIT=0`; los 26 skipped son `it.skip` de
  AnaliticaPage/AnaliticaShell, 0 en integración. Lo doy por bueno con esa reserva.
- [x] Sin secretos en los dos logs de gate commiteados (barrido de URL con credencial, `sk-ant`, `service_role`,
  `"password"`).

### Tests que muerden (literal a mano, no la fuente)
- [x] `rechazo-nombre-466-lib.test.ts` y `rechazo-nombre-466-app.test.ts`: todo `toBe("…")` con el literal
  escrito; ninguno compara contra `CATEGORIA_LABEL.x`/`NOMBRE_ESTADO.x` del lado esperado.
- [x] `CorregirResultadoCierre` (E1-E3), `GestionarOrdenPanelTope` (E5), `tope-intentos-pii` (E6, ahora
  `toBe` literal en vez de tres `toMatch`), `cierres-admin-corregir-resultado` (E4), `RechazosSlaModule` (E11,
  aria y toast), `novedades-sin-gestionar-aviso` (E12/E13 con la cifra): literales.
- [x] Diff de `tests/` sin cambios de importes ni de valores numéricos esperados (R25): solo cadenas.

### Mutaciones propias (ejecutadas, restauradas por copia)
| # | Mutación | Resultado |
|---|---|---|
| RA | `tarifas-labels.ts` `valorFleteDevuelto` vuelve a «Flete por rechazo» | **ROJO, 4 tests**: guardia 466 brazo 1 (`tarifas-labels.ts:46 Flete por rechazo`), brazo 2 (ídem), `rechazo-nombre-466-app` (C29), `TarifasClaridadMontos`. |
| RB1 | `GestionarOrdenPanel.tsx` E5 vuelve a «— entregada o rechazada.» | **ROJO, 2 tests** de `GestionarOrdenPanelTope`. La guardia 466 **NO** lo ve (el archivo no está en `DICCIONARIOS` y «entregada o rechazada» no es frase de §0.5): ver m1. |
| RB2 | `CorregirResultadoDialog.tsx` AVISO «La entrega pasa a ser rechazada.» | **ROJO, 2 tests**: guardia 466 brazo 1 (`CorregirResultadoDialog.tsx:63 …`) y `CorregirResultadoCierre` › «466: el aviso, el botón y la confirmación…». |

Árbol de trabajo limpio tras cada una.

### Excepciones declaradas en guardias
- [x] **466 `EXCEPCIONES`** (3 archivos): las 5 `descripcion` de `metrics.ts` (4 citan los ids de medida
  `entregas+devoluciones+rechazos+incidentes`, 1 el estado `rechazado` de un cierre). Comprobé que la
  `descripcion` de una métrica no se pinta en ninguna pantalla (fuera de alcance del spec, legítimo).
  `cierre-labels.ts` «Rechazado» (`CierreEstado`); `cierre-detalle-shared.tsx` «Un cierre rechazado…». Las
  tres son otra entidad o identificador. La de `GestionarDesdeAyudaModal` se **retiró** (decisión del leader).
  `PENDIENTES = {}`, con un test que lo fija. Una excepción con el texto cambiado da rojo (test R22 + M3 del implementer).
- [x] **338**: `NOMBRE_RETIRADO` intacto; `NOMBRE_VIGENTE` pasa a «flete por devolución a origen»; los casos
  nuevos prueban que el vigente no casa el retirado (R24).
- [x] **456 `estado-con-info` `USOS_PERMITIDOS`**: +2 archivos (`tarifas-labels.ts` C31, `GestionarDesdeAyudaModal.tsx`
  E7 + nota del tope) y motivos ampliados en `GestionarOrdenPanel.tsx` y `CorregirResultadoDialog.tsx`. Todos son
  frases o rótulos de resultado, no el estado de una orden concreta: justificados. Nota: la guardia permite por
  ARCHIVO, así que ampliar el motivo abre el archivo entero (es diseño previo de la 456, no de esta ficha).
- [x] Guardias 455 (G2, G3, catálogo, openapi) y 461: sus archivos no cambian (R27) y están verdes.

### Decisión del leader (`GESTION_AYUDA_TOPE_NOTA`)
- [x] Aplicada: «… Lo que sí podés registrar desde acá es la devolución a origen por rechazo, y …», con
  `NOMBRE_ESTADO.devolucion_a_origen_por_rechazo` y un test literal. Pero va en **minúsculas** (`.toLowerCase()`): ver m2.

### Calidad y seguridad
- [x] Sin tablas, webhooks, secretos ni hardcode de país o moneda. Capas intactas: los servicios solo cambian una
  constante de mensaje, sin HTTP. Ningún permiso cambia.

## Barrido propio de «rechaz»

Dos pasadas con `grep -P` (no con `[oó]`: la clase de caracteres con tilde fue la que le falló al frontend). La
primera sobre `app components lib hooks` (`.ts`/`.tsx`, sin comentarios y quitando el nombre vigente); la segunda
sobre `docs/ayuda` y `docs/api` (sin el CHANGELOG). Salen ~190 líneas en literales. Clasificación:

**(a) Legítimas (§0.6 / fuera de alcance)** — todo el resto:
- identificadores y claves: `rechazadas`/`rechazos` de contadores, SQL, DTOs, `tasaRechazo`, ids de métrica,
  rutas de acciones, `rechazos-sla`, `AMBITO_DESCARGA_*_RECHAZADAS`, logs técnicos `rechazo-tienda-cobro: …`;
- otra entidad: cierres de día y de bodega («Cierre rechazado…», «Motivo de rechazo», `ESTADO_LABEL.rechazado`),
  incidentes, cobros de gasto fijo, postulaciones, plantillas de Meta («Rechazado»), credenciales y proveedores,
  evidencias rechazadas, y `PushWebService` «entrega rechazada» (la entrega del push);
- acto del destinatario o de la tienda: «Rechazados por la tienda», «Fecha del rechazo», «Foto de evidencia del
  rechazo», «La tienda rechazó estas devoluciones…», `TEXTO_ORDEN_RECHAZADA` («…: el destinatario rechazó una
  orden.»), `docs/ayuda/tienda/novedades.md:54` «Rechazar», `reparto.md:132`;
- `openapi-spec.ts:1514,1657` y su espejo `.yaml:1373,1536` («evidencia de entrega, rechazo o incidente», «un
  rechazo manual de la tienda»), `manual-metricas-por-mensajero.md:157`, `guia-integracion.html:671,700,889`:
  son actos, y el design §2.3 los inventaría como «Se conserva»;
- `push-elegibles.ts:182` «cuarenta rechazos…»: `porQue` interno que no se pinta en ninguna parte;
- `app/_landing/LandingPoliticas.tsx:31`: fuera de alcance (Pregunta 9);
- `docs/ayuda/mensajero/cierre-del-dia.md:40-42` «una entrega que en realidad fue un rechazo»: el design §2.3 la
  da por «Se conserva», así que no es un olvido; pero ver m5.

**(b) Olvido** — uno:
- **`docs/api/guia-integracion/guia-integracion.html:617`**: «Si la orden termina **con rechazo**, lo que se
  factura es el escenario `devuelto` de la cotización, no estos importes.» Es el equivalente en HTML de la frase
  del `costoReal` que la 466 sí cambió en el OpenAPI, el `.yaml` y el manual («Si la orden terminó RECHAZADA…»).
  Nombra el **resultado** como «rechazo». El design §2.3 inventarió las líneas 671, 700 y 758 de esta guía, pero
  no la 617. Ninguna guardia la ve: no es frase de §0.5 y el brazo 1 no lee `docs/`.

## Hallazgos

### BLOQUEANTE
- **B1 — R9 (y coherencia con R16): `guia-integracion.html:617` sigue diciendo «termina con rechazo».** El
  glosario mete `docs/api/**` (salvo el CHANGELOG) en la superficie visible, y R9 prohíbe «rechazo» como nombre del
  resultado. **Falta:** reescribirla con el patrón ya aprobado para el `costoReal` («Si la orden termina en
  Devolución a origen por rechazo (`devolucion_a_origen_por_rechazo`), lo que se factura…») y fijarla con un test
  literal sobre la guía, por ejemplo en `openapi-466-descripciones.test.ts`. Opcional: añadir la guía a la tabla
  de la entrada del CHANGELOG.
- **B2 — La Fase 3 no está cerrada (CHECKPOINTS «todas las tasks `[x]`» + `tasks.md` T3.2).** `tasks.md` tiene 0 de
  17 tareas marcadas, y T3.2 («Ver la app» con Playwright, con los Excel de `/wallet`, `/wallet/tiendas` y
  `/mi-wallet` abiertos y leídos) no se ejecutó: `impl_466.md` no tiene capturas ni volcado de texto. Es justo el
  riesgo que el design §6 confía a T3.2 («un rótulo puede salir de un sitio no inventariado»), y B1 demuestra que
  ese riesgo es real. **Falta:** ejecutar T3.2 (o que el leader o el humano la declaren inaplicable por escrito, con
  su sustituto, como pide la memoria de E2E) y marcar `[x]` las tareas hechas. T4.1 se marca al aceptar esta revisión.

### menor
- **m1 — La guardia 466 no cubre los textos de estado que viven fuera de los diccionarios.** RB1 (devolver E5 a
  «entregada o rechazada» en `GestionarOrdenPanel.tsx`) no la pone roja; solo lo para el test literal del
  componente. Lo mismo pasaría con `RechazarNovedadModal.tsx`, `emitir.ts` y `CierresAdminService.ts`. Es como lo
  diseñó el spec (lista cerrada, design §3.1 y §5 A3), así que no bloquea, pero conviene añadir esos archivos a
  `DICCIONARIOS`: hoy no tienen ningún hallazgo que haya que exceptuar.
- **m2 — `GESTION_AYUDA_TOPE_NOTA` pone el nombre en minúsculas** (`NOMBRE_ESTADO…toLowerCase()` da «la devolución
  a origen por rechazo»). §0.1.2 pide el nombre visible **exacto** del estado o resultado, y E7, en el mismo modal,
  lo escribe con mayúscula. Sugerencia: «… es la Devolución a origen por rechazo, …» sin `toLowerCase()`.
- **m3 — El test de R19 vuelve a exigir que la entrada sea «la primera» del CHANGELOG**
  (`openapi-466-descripciones.test.ts`, `expect(i).toBe(CHANGELOG.indexOf("\n## ") + 1)`). Es el mismo aserto que
  esta rama tuvo que reescribir en `changelog-455.test.ts`, y se romperá con la próxima entrada. Conviene usar el
  criterio cronológico que ya se aplicó a la 455.
- **m4 — Título de test desactualizado:** `TarifasClaridadMontos.test.tsx:333` sigue diciendo «el flete se llama
  «por rechazo», que es el único resultado que lo cobra», aunque el aserto ya pide el nombre nuevo.
- **m5 — `docs/ayuda/mensajero/cierre-del-dia.md:40-42`** («una entrega que en realidad fue un rechazo») dice lo
  mismo que `oficina/cierres.md:73`, que la rama sí reescribió («…el destinatario rechazó pasa a **Devolución a
  origen por rechazo**»). El spec la deja como está; alinearla es una línea.
- **m6 — El reviewer no volvió a correr el gate completo** (orden del leader). Antes de mergear hay que pasar al
  menos `./init.sh --rapido` sobre el SHA final, con B1 y B2 resueltos; el completo toca de todos modos (D8:
  `lib/types/`).

## Qué falta para OK
1. B1: una línea de `guia-integracion.html` y su test literal.
2. B2: T3.2 ejecutada (o declarada inaplicable por el humano o el leader, con su sustituto) y `tasks.md` marcado.
3. Recomendado en la misma pasada: m2, m3 y m4 (triviales).
