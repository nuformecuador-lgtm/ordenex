# impl_466 — Fase 0 + Fase 1 (backend_dev)

> Rama `feature/466-rechazo-nombre-nuevo`, nacida de `550803ed` (`git merge-base --is-ancestor 550803ed HEAD` OK).
> Sin esquema, sin migraciones, sin `prisma generate`. Búsqueda: el MCP `codebase-memory` NO estaba en mi
> conjunto de herramientas en esta sesión; el inventario se hizo con `grep` (texto plano) y con el mismo
> extractor AST de la guardia nueva sobre todo `lib/` (ver T0.1).

## Commits

| SHA | Qué |
|---|---|
| `6ca03aec` | feat(466): conceptos, KPIs, historial y mensajes de servidor (T1.2, T1.3, T1.6) |
| `87565168` | docs(466): contrato API, manual, CHANGELOG (T1.5) |
| `e39c74cf` | test(466): guardia de tres brazos (T1.1) |
| (este) | docs(466): esta bitácora + `progress/gate_466_backend.log` |

## T0.1 — Inventario sobre el árbol de hoy

Barrido de `lib/` con el extractor de la guardia (todo literal/plantilla/JSX con «rechazo(s)/rechazado(s)/rechazada(s)»,
comentarios fuera): **51 textos**. Contra `design.md` §2.1:

| Archivo:línea | Clase | Resultado |
|---|---|---|
| `lib/constants/wallet-rotulos.ts:31,34,40,41` | Cambia | sin diferencias → C1-C4 |
| `lib/constants/origen-legible-rotulos.ts:21` | Cambia | sin diferencias → C15 |
| `lib/types/historial-accion.ts:511,512,535,587` | Cambia | sin diferencias → C25-C28 |
| `lib/analytics/metrics.ts:258,393` | Cambia | sin diferencias → K1, K2 |
| `lib/analytics/metrics.ts:561,602` (`descripcion` de `ingreso_*`: «la ANULACION de un cobro por rechazo») | **Diferencia** | No estaba en §2.1. Es una frase de §0.5 y el brazo 2 no admite excepciones (design §3.2) → se cambió a «cobro por devolución a origen» (solo texto de `descripcion`, ningún id). Ningún test ni doc la cita. |
| `lib/analytics/metrics.ts:197,355,375,395` (`descripcion`, «entregas+devoluciones+rechazos+incidentes») | **Diferencia** → Se conserva | citan los IDS de medida (contrato, «Fuera de alcance»). Declaradas como excepción del brazo 1 con texto exacto. |
| `lib/analytics/metrics.ts:860` («solicitado, aprobado, rechazado, vencido») | **Diferencia** → Se conserva | estado de un CIERRE (§0.6). Excepción del brazo 1. |
| `lib/services/mensajes-bloqueo.ts:106-108` | Cambia | sin diferencias → E6. Ninguna excepción de cierre hizo falta en este archivo (design §3.1 la daba por posible). |
| `lib/services/CierresAdminService.ts:115` | Cambia | sin diferencias → E4 |
| `lib/notificaciones/emitir.ts:1104,1107` | Cambia | sin diferencias → E12, E13 (verbos «se rechaza»/«la rechaza»: ningún brazo los caza, cubiertos por test literal) |
| `lib/api/openapi-spec.ts:1424,2062,2068,2073` | Cambia | sin diferencias → R16 |
| resto de `lib/` (clientes Google/Anthropic/WhatsApp, motivos de cierre/incidente, `PushWebService` «entrega rechazada», logs `rechazo-tienda-cobro:`) | Se conserva | otra entidad / log técnico, ninguno nombra el estado |
| `docs/api/api-key-openapi.yaml` 1284, 2008, 2018, 2021 | Cambia | sin diferencias (espejo) |
| `docs/api/manual-metricas-por-mensajero.md:283` | Cambia | sin diferencias → R18 |

Árbol `app/`/`components/`/`docs/ayuda` (Fase 2), medido por la guardia: coincide con §2.2/§2.3, con **una línea a
elevar al leader**:

- `app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx:208` — `GESTION_AYUDA_TOPE_NOTA`: «… Lo que sí podés
  registrar desde acá es **el rechazo**, y el mensajero todavía puede entregarla.» Design §2.2 la clasifica «Se conserva
  (acción «Rechazar»)» y así queda declarada como excepción del brazo 1. Pero se puede leer como el **resultado** que se
  registra (que hoy se llama «Devolución a origen por rechazo»). **Decisión del leader/humano**; si cambia, se retira
  la excepción en la misma edición (la guardia lo pide sola, R22).

## T0.2 — Censo de tests que fijan literales viejos

Hecho por `grep` de las frases «Antes» de §0 en `tests/` (líneas que no son comentario). **Ya actualizados en la Fase 1**
(fallaban con el cambio de `lib/`):

- `tests/components/ComposicionGananciaCard.test.tsx:349,352` (C1, C2)
- `tests/unit/components/wallet-labels.test.ts:38,41,64,65` (C1-C4)
- `tests/unit/components/desglose-tienda-labels.test.ts:40,43` (C7, C8)
- `tests/unit/analytics/etiquetas-visibles.guardia.test.ts:56,62,108` (K1, K2, leyenda K1)
- `tests/unit/api/openapi-415-zona-y-costo.test.ts:255-256` (R16)
- `tests/unit/services/wallet-origen-legible.test.ts:58,154`, `tests/integration/db/wallet-origen-legible.test.ts:126` (C15)
- `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts:171,177` (E12, E13)
- `tests/unit/guards/tope-intentos-pii.guardia.test.ts:78-80` (E6)

**Lista de trabajo de T2.7 (frontend)** — siguen con texto viejo en líneas que no son comentario y hoy están verdes
porque el rótulo de `app/` aún no cambió (o son títulos de `it`/`describe`, o asertos negativos que hay que leer uno a uno):

```
tests/components/AnularMovimientoDialog.test.tsx: 39,40,49,112
tests/components/CierreBodegaDesglosePorTienda.test.tsx: 909,1031
tests/components/CierreBodegaDetalleCascadas.test.tsx: 441,465,537,550
tests/components/CierreCobrosDeLaGestion.test.tsx: 250
tests/components/CierreDetalleIncidente.test.tsx: 204,238
tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx: 77,79,83
tests/components/CierreDiaModule.test.tsx: 344,362,366,496
tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx: 57,184,243
tests/components/CierreFacturaSinGestionar.test.tsx: 517,534
tests/components/CierreMensajeroDesglosePorTienda.test.tsx: 632,653
tests/components/CierreMensajeroDetalleCascadas.test.tsx: 460,475,500,600,647
tests/components/CierreMotivoRechazoAutomatico.test.tsx: 33
tests/components/CierreTarifaAplicada.test.tsx: 196,204
tests/components/CierresAdminModule.test.tsx: 621,849,890,924
tests/components/ComposicionGananciaCard.test.tsx: 383,384,484,485,679,680
tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx: 52,54,63,68,295
tests/components/CorregirResultadoCierre.test.tsx: 173
tests/components/DetalleMovimientoPanel.test.tsx: 149,243,255
tests/components/DineroIdentidadesEnPantalla.test.tsx: 946,1205
tests/components/OrigenMovimiento.test.tsx: 54,59
tests/components/ProductosTabla.test.tsx: 578
tests/components/RechazarNovedad.test.tsx: 104,256,257
tests/components/RechazosSlaModule.test.tsx: 134
tests/components/TarifasAlineacionRejilla.test.tsx: 192
tests/components/TarifasClaridadMontos.test.tsx: 147,152,157,177,202,237,340,341
tests/components/WalletLedgerVer458C.test.tsx: 109,276
tests/components/WalletLibroCaja458E.test.tsx: 557,587
tests/components/descarga/CierresDescarga.test.tsx: 813,830
tests/components/paginacion/ColasPaginacion.test.tsx: 838
tests/integration/db/analitica-anulacion-rechazo-458.test.ts: 70
tests/integration/db/analytics-daily-migration.test.ts: 60
tests/integration/db/caja-caracterizacion-459.test.ts: 515
tests/integration/db/caja-invariante-tiendas.test.ts: 334,498,668
tests/integration/db/cierre-rechazo-tienda-aprobacion.test.ts: 829
tests/integration/db/como-quedo.test.ts: 229
tests/integration/db/ingreso-bodega-migration.test.ts: 28
tests/integration/db/libro-caja-a-quien.test.ts: 139
tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts: 530
tests/integration/db/rechazo-tienda-cobro.int.test.ts: 51
tests/integration/db/resolver-novedad-reprograma-dinero.test.ts: 153
tests/integration/db/wallet-anulacion-458.test.ts: 289
tests/integration/db/wallet-anulacion-concurrencia.test.ts: 83
tests/integration/db/wallet-origen-legible.test.ts: 104
tests/unit/analytics/analitica-operativa-service.test.ts: 14
tests/unit/analytics/financiera-ingresos-repo.test.ts: 311
tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts: 471
tests/unit/analytics/metrics.test.ts: 44,401,406
tests/unit/analytics/tablero-agregacion.test.ts: 328,336
tests/unit/api/analitica-integrador-borde.test.ts: 434,457
tests/unit/asistente/contexto-458.test.ts: 73,86,89,91,92
tests/unit/components/desglose-tienda-labels.test.ts: 54,55
tests/unit/components/mi-wallet-labels.test.ts: 39,42,53,54
tests/unit/components/motivo-rechazo-automatico-legible.test.ts: 27,29,31,68,74,78,86
tests/unit/components/textos-455-recorrido.test.ts: 51
tests/unit/components/wallet-cobros-rechazo-tienda-panel.test.tsx: 117
tests/unit/components/wallet-labels.test.ts: 194,220,221
tests/unit/descarga/analitica-productos-descarga-columnas.test.ts: 102,313,325
tests/unit/descarga/censo-tablas.ts: 475
tests/unit/descarga/cierre-dia-descarga-columnas.test.ts: 399,433
tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts: 152,194
tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts: 196
tests/unit/guards/caja-clasificacion-459.guardia.test.ts: 178,208,221
tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts: 221
tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts: 616
tests/unit/guards/estado-con-info.guardia.test.ts: 198
tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts: 117,143   (T2.2b)
tests/unit/historial-accion/catalogo-y-choke-point.test.ts: 722
tests/unit/notificaciones/presentacion-aviso.test.ts: 89,96
tests/unit/services/cierre-bodega-service.test.ts: 454
tests/unit/services/cierre-dia-service.test.ts: 734,866
tests/unit/services/cierres-admin-service.test.ts: 49,615,679,773,785,2354
tests/unit/services/cierres-bodega-admin-service.test.ts: 498,1418
tests/unit/services/notificacion-service.test.ts: 533,544
tests/unit/services/push-web-service.test.ts: 257,275,300
tests/unit/services/rechazo-tienda-cobro-service.test.ts: 121
tests/unit/services/wallet-anulacion-service.test.ts: 218
tests/unit/services/wallet-comprobante-service.test.ts: 126,197
tests/unit/services/wallet-origen-legible.test.ts: 151
tests/unit/utils/cascadas-cierre-bodega.test.ts: 132
tests/unit/utils/incidente-no-mueve-dinero.test.ts: 48
tests/unit/utils/partes-por-tienda.test.ts: 289
```

(Varias de `lib/`-adyacentes de esta lista —`cierres-admin-service`, `metrics.test`, `push-web-service`— están verdes
con el cambio de `lib/`: son títulos o fixtures históricos; T2.7 decide línea a línea con §0.6.)

## Archivos tocados (Fase 1)

`lib/`: `constants/wallet-rotulos.ts` (C1-C4), `constants/origen-legible-rotulos.ts` (C15), `types/historial-accion.ts`
(C25-C28), `analytics/metrics.ts` (K1, K2 y la frase §0.5 de dos `descripcion`), `services/mensajes-bloqueo.ts` (E6, con
`NOMBRE_ESTADO`), `services/CierresAdminService.ts` (E4, con `NOMBRE_ESTADO`), `notificaciones/emitir.ts` (E12, E13, con
`NOMBRE_ESTADO`), `api/openapi-spec.ts` (R16).

`app/` (dos diccionarios, NO componentes; acoplados por tests de igualdad a lo de `lib/`):
- `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts:46,49` (C7, C8) — `desglose-tienda-labels.test.ts`
  exige `CATEGORIA_TIENDA_LABEL.flete_devolucion === CATEGORIA_LABEL.ingreso_flete_devolucion`.
- `app/(app)/analitica/_components/operativo/catalogo-paneles.ts:104` (leyenda K1) — `etiquetas-visibles.guardia`
  exige leyenda = etiqueta de la métrica (design §3.6, «en el mismo commit»).

`docs/api/`: `api-key-openapi.yaml` (espejo R16), `manual-metricas-por-mensajero.md` (R18), `CHANGELOG.md` (R19).

`tests/`: nuevos `unit/guards/rechazo-nombre-466.guardia.test.ts`, `unit/api/openapi-466-descripciones.test.ts`,
`unit/types/rechazo-nombre-466-lib.test.ts`; actualizados los de T0.2 «ya actualizados» y
`unit/api/changelog-455.test.ts` (ver nota).

**Nota `changelog-455.test.ts`:** exigía que la entrada de la 455 fuera «la PRIMERA» del CHANGELOG. La 466 añade una
entrada posterior (R19), así que se cambió a lo que ese aserto quería decir —orden cronológico: por encima solo
entradas de fecha posterior al 2026-09-24, por debajo solo anteriores—. No se compara contra su propia fuente.

## T1.1 — Mutaciones de la guardia, EJECUTADAS (R23)

Sobre el árbol real, restaurando cada archivo después (copia en scratchpad, no `git checkout`):

| # | Mutación | Resultado |
|---|---|---|
| M1 | `wallet-rotulos.ts:31` vuelve a «Flete por rechazo cobrado a la tienda» | ROJO: `ninguna palabra «rechazo» fuera de…` y `ninguna frase de §0.5…` — `lib/constants/wallet-rotulos.ts:31 Flete por rechazo cobrado a la tienda` / `…:31 Flete por rechazo`. Tests 2 failed / 10 passed |
| M2 | `docs/ayuda/tienda/novedades.md` + línea `El **Cobro por rechazo** se ve en tu wallet.` | ROJO: brazo 2 (`docs/ayuda/tienda/novedades.md:98 Cobro por rechazo`) y brazo 3 (`maestro:`, `admin:`, `adminTienda:` …). 2 failed / 10 passed |
| M3 | `cierre-labels.ts:79` `"Rechazado"` → `"Rechazada"` (excepción con texto cambiado) | ROJO: infractor `…cierre-labels.ts:79 Rechazada` y caducada `…cierre-labels.ts: «Rechazado»` (R22). 2 failed / 10 passed |
| M4 | `wallet-labels.ts:301` arreglado (pendiente que sobra) | ROJO: `el pendiente del brazo 1 cambio … expected +0 to be 1` y lo mismo en el brazo 2. 2 failed / 10 passed |
| sint. | `"Flete por rechazo cobrado a la tienda"`, `<span>Tasa de rechazo</span>`, `` `quedó rechazada` ``, `"Rechazos"`, `**Cobro por rechazo**` | rojo (tests «MUTACION» del propio archivo, verdes = el detector los ve) |
| sint. | `"Devolución a origen por rechazo"`, `"Rechazar"`, `"El destinatario rechazó el paquete."`, `// flete por rechazo`, `"rechazos"`, `"tasa_rechazo"` | verde (no denuncia) |

Corrida de la guardia en verde: `Tests 12 passed (12)`, `skipped 0`.

## R17 — el contrato no cambió de forma (medido contra `550803ed`)

Script de un solo uso (scratchpad): esqueleto del objeto `openApiSpec` sin `description`/`summary`, viejo (`git show
550803ed:lib/api/openapi-spec.ts`) vs nuevo: **igual** (32 131 = 32 131 caracteres). El `.yaml` sin las líneas/bloques
`description`: **igual**. Queda además el test permanente `openapi-466-descripciones.test.ts` (campos, `required`, tipos e
ids de métrica literales).

## Mapa R<n> → test (parte backend)

| R | Test |
|---|---|
| R1 (lib: C1-C4, C15, C25-C28) | `tests/unit/types/rechazo-nombre-466-lib.test.ts` › «el flete y su IVA, cobrados y anulados…», «el origen legible del cobro (C15)…», «las tres acciones del cobro y su entidad»; `tests/unit/components/wallet-labels.test.ts` (27 textos aprobados) |
| R2 (Excel = misma fuente) | `wallet-labels.test.ts` › «el filtro por concepto ofrece los 27 con SU nombre»; `tests/unit/services/wallet-origen-legible.test.ts` (columna «Motivo y origen») — **Fase 2 añade las descargas de `app/`** |
| R3 (filas viejas) | `tests/integration/db/wallet-origen-legible.test.ts` (fila sembrada, texto derivado al leer: «Gestión de orden · cobro por devolución a origen · guía …»); `tests/unit/services/wallet-origen-legible.test.ts:154` |
| R4, R5, R8 | **Fase 2** (cierres, tarifas, productos) |
| R6 | `rechazo-nombre-466-lib.test.ts` › «`rechazos` se rotula…»; `tests/unit/analytics/etiquetas-visibles.guardia.test.ts` (métrica y leyenda iguales) |
| R7 | `rechazo-nombre-466-lib.test.ts` › mismo `it`; `etiquetas-visibles.guardia.test.ts:62` |
| R9 (lib: E4, E6) | `tests/unit/services/cierres-admin-corregir-resultado.test.ts` › «466/R11 (E4)…»; `tests/unit/guards/tope-intentos-pii.guardia.test.ts` › «los DOS motivos son textos DISTINTOS» (literal E6). E1-E3, E5, E7-E11: **Fase 2** |
| R10 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` › «(a) lote homogeneo de cinco dias», «(b) … 24 horas» (literales con la cifra de config) |
| R11 | igual que R9 (E4, E6) |
| R12 | `rechazo-nombre-466-lib.test.ts` › «466/R12» |
| R13 | `rechazo-nombre-466-lib.test.ts` › «R13: la decision sobre OTRAS entidades conserva «Rechazó»»; excepciones del brazo 1 de la guardia |
| R14 | guardia brazo 2 sobre `docs/ayuda` (hoy con `PENDIENTES` de la Fase 2) |
| R15 | guardia › «466/R15 (brazo 3)» |
| R16 | `tests/unit/api/openapi-466-descripciones.test.ts` › «466/R16…» (3 `it`); `openapi-415-zona-y-costo.test.ts` › «y remite al escenario `devuelto`…» |
| R17 | `openapi-466-descripciones.test.ts` › «466/R17…» (2 `it`) + medición de esqueleto de arriba |
| R18 | `openapi-466-descripciones.test.ts` › «466/R18…» |
| R19 | `openapi-466-descripciones.test.ts` › «466/R19…» (2 `it`); `changelog-455.test.ts` (orden cronológico) |
| R20, R22 | guardia › «466/R20 · R22 (brazo 1)» + «MUTACION (R22)…» |
| R21 | guardia › «466/R21 (brazo 2)» |
| R23 | guardia › tests «MUTACION…» + M1-M4 de arriba |
| R24 | **Fase 2 (T2.2b)** |
| R25 | suite de dinero sin cambios de valores esperados: ningún importe tocado en los tests actualizados (solo rótulos) |
| R26 | `rechazo-nombre-466-lib.test.ts` › «466/R26 — ningun identificador cambia»; sin cambios en `db/` |
| R27 | `nombres-estado-retirados.guardia`, `fuente-unica-nombre-estado.guardia`, `nombres-wallet-461.guardia`, `openapi-nombres-455.guardia` verdes sin tocar sus listas |
| R28 | sin cambios en `lib/auth/**` ni `middleware.ts` |

## Lo que queda para la Fase 2 (frontend_dev) — contratos

1. **Vaciar `PENDIENTES`** de `tests/unit/guards/rechazo-nombre-466.guardia.test.ts` (números exactos por archivo y
   brazo; uno menos sin retirar la entrada = rojo). Al vaciarse, el umbral de no-vacuidad sube solo a >15.
2. **Excepciones ya declaradas** (no añadir otras): `cierre-labels.ts` «Rechazado», `cierre-detalle-shared.tsx`
   «Un cierre rechazado no es terminal…», `GestionarDesdeAyudaModal.tsx` `GESTION_AYUDA_TOPE_NOTA` (pendiente de decisión,
   ver T0.1), y las 5 `descripcion` de `lib/analytics/metrics.ts`.
3. **Textos que ya vienen de `lib/` y la pantalla hereda sin tocar nada:** C1-C4 (`CATEGORIA_LABEL`), C15
   (`ORIGEN_ENTIDAD_LABEL.cobroPorRechazo`), C25-C28 (`ACCION_LABELS`/`ENTIDAD_LABELS`), K1/K2 (`getMetrica().etiqueta`),
   E4 (`fieldErrors.resultado[0]` de `corregirResultadoGestion` = «Solo una entrega se puede corregir a Devolución a origen
   por rechazo: los demás resultados no cobran nada.»), E6 (`MSG_TOPE_INTENTOS_GESTION` en `motivo` del `conflict` =
   «esta orden ya agoto sus intentos de entrega: solo se puede registrar como Entregado, Devolución a origen por rechazo
   o Incidente»), E12/E13 (aviso de novedades).
4. **Ya hechos aquí aunque §2.2 los ponía en Fase 2:** C7/C8 (`desglose-tienda-labels.ts:46,49`) y la leyenda K1
   (`catalogo-paneles.ts:104`). Siguen pendientes en `desglose-tienda-labels.ts` C9/C10.
5. **T2.2b** guardia de la 338: tras T2.1/T2.2/T2.4 «Flete por rechazo» cae por debajo de 5 en `app/` y su
   autocomprobación se pone roja; cambiar `NOMBRE_VIGENTE` a `/flete\s+por\s+devoluci[oó]n\s+a\s+origen/iu`.
6. **T2.7** la lista de tests de T0.2 de arriba.

## Gate

`./init.sh` COMPLETO sobre `e39c74cf` (con `.env` copiado al worktree: la integración corre contra la base local),
salida entera en `progress/gate_466_backend.log`, `INIT_EXIT` escrito dentro:

```
✓ typecheck paso
✓ lint paso                      (0 errores, 218 warnings preexistentes)
 Test Files  2331 passed (2331)
      Tests  32390 passed | 26 skipped (32416)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2331 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son `it.skip` preexistentes de `tests/components/AnaliticaPage.test.tsx` (17) y
`tests/components/AnaliticaShell.test.tsx` (9); **0 en `tests/integration`**.

Veredicto: Fase 1 de la 466 hecha y verde; la guardia vigila desde hoy con `PENDIENTES` medido para la Fase 2.

---

# impl_466 — Fase 2 (frontend_dev)

> Rama local `fe/466-rechazo-nombre-nuevo` (la `feature/466-rechazo-nombre-nuevo` estaba tomada por el worktree
> del backend) sobre `cbb5f30f`, empujada a `origin/feature/466-rechazo-nombre-nuevo`. Sin esquema, sin migraciones.
> Búsqueda: el MCP `codebase-memory` NO estaba en mi conjunto de herramientas; se usó `grep` (texto plano) y la
> propia guardia de la 466 como censo.

## Decisión del leader aplicada

`GestionarDesdeAyudaModal.tsx` `GESTION_AYUDA_TOPE_NOTA` **cambia**: «… Lo que sí podés registrar desde acá es la
devolución a origen por rechazo, y el mensajero todavía puede entregarla.» (con
`NOMBRE_ESTADO.devolucion_a_origen_por_rechazo.toLowerCase()`, voseo conservado). Su excepción del brazo 1 se
**retiró** de la guardia (la guardia la habría pedido sola por caducada, R22).

## Tareas

| Tarea | Hecho |
|---|---|
| T2.1 wallet | `wallet-labels.ts` (C16), `composicion-detalle-labels.ts` (C5, C6), `cobro-rechazo-tienda-labels.ts` (C21-C24; «La tienda rechazó…» y «Cobro descartado…» se conservan, R13), `desglose-tienda-labels.ts` (C9, C10), `mi-wallet-labels.ts` (C11-C14), `detalle-movimiento-panel-labels.ts` (C17-C20) |
| T2.2 cierres y tarifas | `tarifas-labels.ts` (C29, C30, C32; C31 = `nombreDeResultado("devolucion_a_origen_por_rechazo")`), `cierre-labels.ts` (C33, C35, E10; `ESTADO_LABEL.rechazado` y «Este cierre se rechazó…» se conservan), `cierre-detalle-shared.tsx` (C33-C35, E8, E9; «Un cierre rechazado…» se conserva), `CorregirResultadoDialog.tsx` (E1-E3 con `estatusLabel`), `ConsolidacionBodegaModule.tsx` y `cierre-factura.tsx` (aria C34; «Rechazados por la tienda», «Fecha del rechazo», «Motivo de rechazo» se conservan, Pregunta 7) |
| T2.2b guardia 338 | `NOMBRE_VIGENTE = /flete\s+por\s+devoluci[oó]n\s+a\s+origen/iu`; `NOMBRE_RETIRADO` intacto; casos nuevos: «Flete por devolución a origen» e «IVA del flete por devolución a origen» NO casan el retirado y SÍ el vigente; mensaje de error con el nombre nuevo. Censo vacío |
| T2.3 mensajero y novedades | `GestionarOrdenPanel.tsx` (E5 con `estatusLabel("entregado")`/`estatusLabel("devolucion_a_origen_por_rechazo")`), `GestionarDesdeAyudaModal.tsx` (E7 + nota del tope), `RechazarNovedadModal.tsx` (C36), `RechazosSlaModule.tsx` (E11). «Rechazar», «Motivo del rechazo», «Rechazar la orden» intactos |
| T2.4 analítica | `ProductosTabla.tsx` (K3), `DineroProductoDetalle.tsx` (C37 ×3), `analitica-productos-descarga-columnas.ts` (K4, C38; claves `rechazo`/`retorno` intactas). K1 ya venía de la Fase 1 |
| T2.5 ayuda | `docs/ayuda/oficina/wallet-caja.md` (7 líneas), `tienda/mi-wallet.md` (C11, C15), `oficina/cierres.md` (corregir resultado → «Devolución a origen por rechazo», ×2) |
| T2.6 | `PENDIENTES = {}` + `it` nuevo «T2.6: la Fase 2 dejo `PENDIENTES` vacio» (`toEqual({})`); umbral de no-vacuidad sube solo a >15; ninguna excepción añadida (una retirada). Guardias 455 (G2, G3, catálogo) y 461 verdes sin tocar sus listas |
| T2.7 tests | 72 + 34 archivos de `tests/` llevados al literal nuevo (asserts, nombres accesibles, negativos que habrían quedado vacuos, títulos de `it`). Ninguno pasó a comparar contra su propia fuente; ningún importe cambió (solo cadenas de texto) |

**`estado-con-info.guardia` (456):** los dos archivos que ahora componen el nombre del estado
(`tarifas-labels.ts`, `GestionarDesdeAyudaModal.tsx`) se declararon en `USOS_PERMITIDOS` como clase `frase` con
motivo; se amplió el motivo de `GestionarOrdenPanel.tsx` y `CorregirResultadoDialog.tsx` y se corrigió el de
`DineroProductoDetalle.tsx` (citaba «Flete por rechazo + IVA…»). Es una guardia de la 456, no de las de R27.

## Mutaciones ejecutadas (Fase 2)

| # | Mutación | Resultado |
|---|---|---|
| M5 | `cierre-detalle-shared.tsx:469` `FLETE_RECHAZO_LABEL` vuelve a «Flete por rechazo» | ROJO: guardia brazo 1 (`…cierre-detalle-shared.tsx:469 Flete por rechazo`), brazo 2 (ídem) y `rechazo-nombre-466-app.test.ts` › «cierres: flete, IVA, GAM y con IVA (C33)». 3 failed / 24 passed |
| M6 | `docs/ayuda/tienda/mi-wallet.md:104` vuelve a «cobro por rechazo» | ROJO: brazo 2 (`docs/ayuda/tienda/mi-wallet.md:104 cobro por rechazo`) y brazo 3 (`maestro:`, `admin:`, `adminTienda:`). 2 failed / 11 passed |

Restaurados por copia desde el scratchpad (no `git checkout`).

## Mapa R1–R28 → test (COMPLETO; sustituye las celdas «Fase 2» del mapa de arriba)

| R | Test |
|---|---|
| R1 | `tests/unit/types/rechazo-nombre-466-lib.test.ts` (C1-C4, C15, C25-C28); `tests/unit/components/rechazo-nombre-466-app.test.ts` › «composicion: los dos reversos del cobro (C5, C6)», «libro de la tienda desde la oficina (C7-C10)», «Mi wallet, la lectura desde la tienda (C11-C14)», ««Anular …» y el detalle del movimiento (C16-C20)», «la cola de cobros (C21-C24)…», «tarifas: …(C29-C32)», «cierres: flete, IVA, GAM y con IVA (C33)», «cierres: el ingreso de bodega y las notas (C34, C35)», «el aviso del modal de rechazo… (C36)», «la tabla y el detalle de dinero (K3, C37)»; `tests/components/DetalleMovimientoPanel.test.tsx`, `WalletLedgerVer458C.test.tsx` › «R100: el cobro por devolución a origen dice en palabras…» |
| R2 | `tests/unit/components/wallet-labels.test.ts` › «el filtro por concepto ofrece los 27 con SU nombre»; `tests/unit/components/desglose-tienda-labels.test.ts` y `mi-wallet-labels.test.ts` › «dice exactamente los N textos aprobados…» (mismos diccionarios que la descarga); `tests/unit/services/wallet-origen-legible.test.ts` (columna «Motivo y origen») |
| R3 | `tests/integration/db/wallet-origen-legible.test.ts` (fila sembrada, texto derivado al leer); `tests/unit/services/wallet-origen-legible.test.ts:154` |
| R4 | `rechazo-nombre-466-app.test.ts` › «cierres: el ingreso de bodega y las notas (C34, C35)»; `tests/components/CierresAdminModule.test.tsx` › «feature 102/R8: el ingreso de bodega por devoluciones a origen muestra el total…»; `ComprobanteMensajeroOrigenRechazo.test.tsx` › «R3 — … el renglón «Ingreso de bodega por devoluciones a origen» sigue con su monto»; `CierreBodegaDesglosePorTienda.test.tsx`, `descarga/CierresDescarga.test.tsx` (nombre accesible) |
| R5 | `rechazo-nombre-466-app.test.ts` › «tarifas: los dos fletes y el pago por zona junto a «Entregado» (C29-C32)»; `tests/components/TarifasClaridadMontos.test.tsx` › «nombra el resultado que REALMENTE paga: «Devolución a origen por rechazo»», «explica los dos destinatarios…» |
| R6 | `rechazo-nombre-466-lib.test.ts` › «`rechazos` se rotula…»; `tests/unit/analytics/etiquetas-visibles.guardia.test.ts` |
| R7 | `rechazo-nombre-466-lib.test.ts` (mismo `it`); `etiquetas-visibles.guardia.test.ts:62` |
| R8 | `rechazo-nombre-466-app.test.ts` › «la tabla y el detalle de dinero (K3, C37)», «la descarga: encabezados nuevos con sus CLAVES de siempre (K4, C38; R26)»; `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` › «los ONCE encabezados…», «los VEINTIUN encabezados…» |
| R9 | E1-E3: `tests/components/CorregirResultadoCierre.test.tsx` › «466: el aviso, el botón y la confirmación nombran «Devolución a origen por rechazo»»; E4: `tests/unit/services/cierres-admin-corregir-resultado.test.ts` › «466/R11 (E4)…»; E5: `tests/components/GestionarOrdenPanelTope.test.tsx` › «en el tope aparece la nota, TAL CUAL», «dice las dos cosas…»; E6: `tope-intentos-pii.guardia.test.ts`; E7 + nota del tope: `rechazo-nombre-466-app.test.ts` › «la gestion desde ayuda…», `GestionarDesdeAyudaModalTope.test.tsx` › «la nota se lee TAL CUAL»; E8-E10: `rechazo-nombre-466-app.test.ts` › «cierres: los marcadores de origen y el motivo automatico (E8-E10)», `tests/unit/components/motivo-rechazo-automatico-legible.test.ts`, `CierreMotivoRechazoAutomatico.test.tsx`; E11: `tests/components/RechazosSlaModule.test.tsx` › «R22: renderiza la Pagination…» (nombre accesible) y «al paginar con error muestra toast…» (texto del permiso) |
| R10 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` › «(a) …cinco dias», «(b) … 24 horas» |
| R11 | E4 y E6 como en R9 |
| R12 | `rechazo-nombre-466-lib.test.ts` › «466/R12» |
| R13 | `rechazo-nombre-466-lib.test.ts` › «R13: la decision sobre OTRAS entidades…»; `rechazo-nombre-466-app.test.ts` › «la cola de cobros… (R13: el acto de la tienda)», «R13: el estado de un CIERRE rechazado no cambia», «el aviso del modal de rechazo… conserva la accion y el motivo (R13)», «…boton «Rechazar» (R13)»; excepciones del brazo 1 |
| R14 | guardia › «466/R21 (brazo 2)» sobre `docs/ayuda` con `PENDIENTES` vacío (M6) |
| R15 | guardia › «466/R15 (brazo 3)» (M6); `tests/unit/asistente/contexto-458.test.ts` con el literal nuevo |
| R16 | `tests/unit/api/openapi-466-descripciones.test.ts` › «466/R16…» |
| R17 | `openapi-466-descripciones.test.ts` › «466/R17…» |
| R18 | `openapi-466-descripciones.test.ts` › «466/R18…» |
| R19 | `openapi-466-descripciones.test.ts` › «466/R19…»; `changelog-455.test.ts` |
| R20, R22 | guardia › «466/R20 · R22 (brazo 1)» (M5) + «MUTACION (R22)…»; «T2.6: la Fase 2 dejo `PENDIENTES` vacio» |
| R21 | guardia › «466/R21 (brazo 2)» (M5, M6) |
| R23 | guardia › tests «MUTACION…» + M1-M6 ejecutadas |
| R24 | `tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts` › «el MISMO extractor encuentra el nombre VIGENTE en `app/`» (ahora «Flete por devolución a origen», >5), «el detector marca el literal y NO marca el comentario» (casos 466: el vigente no casa el retirado) y el censo |
| R25 | suite de dinero verde sin tocar ningún importe esperado (los cambios de `tests/` son solo cadenas de rótulo) |
| R26 | `rechazo-nombre-466-lib.test.ts` › «466/R26…»; `rechazo-nombre-466-app.test.ts` › «la descarga: … CLAVES de siempre»; `git diff --stat cbb5f30f` sin `db/`, `prisma/` ni migraciones |
| R27 | `nombres-estado-retirados.guardia`, `fuente-unica-nombre-estado.guardia`, `nombres-wallet-461.guardia`, `openapi-nombres-455.guardia` verdes sin tocar sus listas |
| R28 | sin cambios en `lib/auth/**` ni `middleware.ts` |

## Gate (Fase 2)

`./init.sh` COMPLETO, salida entera en `progress/gate_466_frontend.log` con `INIT_EXIT` dentro:

```
✓ typecheck paso
✓ lint paso
 Test Files  2332 passed (2332)
      Tests  32406 passed | 26 skipped (32432)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2332 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son los `it.skip` preexistentes de `AnaliticaPage` (17) y `AnaliticaShell` (9); **0 en
`tests/integration`** (con `.env` copiado al worktree).

Corridas previas, rojas, contadas aquí para no esconderlas:
1. 3 rojos: `NovedadesModule.test.tsx` (MÍO: afirmaba E7 viejo «La orden quedó rechazada.» — el `grep` con
   `[oó]` no lo vio en este terminal; corregido junto con un comentario de `GestionarDesdeAyudaModal.test.tsx`),
   y `CierresAdminFiltros` + `BajoRiesgoPaginacion` (timeout/carga; verdes aislados, ajenos al diff).
2. 2 rojos en `tests/integration/recuperar-contrasena-form.test.tsx` (ajeno al diff; 11/11 verde aislado).
3. Esta: verde.

Veredicto: Fase 2 de la 466 hecha; `PENDIENTES` vacío, guardia 338 apuntando al nombre vigente, R1-R28 con test.
