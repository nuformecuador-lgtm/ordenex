# 476 — Informe de picking por WhatsApp — tasks

> Zona `fullstack`: backend_dev (F0–F4) y luego frontend_dev (F5), en secuencia (memoria del repo).
> `[P]` = paralelizable con las otras `[P]` de la MISMA fase. Cada task: un commit
> `feat(476)/test(476)/…`. Gate: `./init.sh --rapido` (sale **ampliado**: toca `lib/types/` y añade
> integración de `tests/integration/db/`; exige `DATABASE_URL`). Nunca el completo.

## F0 — Arranque

- [ ] **T0.1** Comprobar que la 474 está en `origin/dev` (`git merge-base --is-ancestor <SHA de la 474> origin/dev`).
  Si no lo está, PARAR y avisar al leader: esta ficha no arranca sobre la rama de la 474.
  **Hecho:** SHA de partida anotado en `progress/impl_476.md` y la 474 incluida.
- [ ] **T0.2** Mirar si la 475 ya mergeó §3.1/§3.2 del design (rama `error` de `ResultadoInforme`,
  catálogos de descriptor). **Hecho:** anotado en la bitácora «reutilizo» o «lo hago yo (T1.1/T1.2)».

## F1 — Contrato de la 474 (depende de F0)

- [ ] **T1.1** `ResultadoInforme` + `{ tipo: "error"; motivo }` en `informes/tipos.ts`, y en
  `EjecucionEnvioService.ejecutar` la terminación `error` tras la rama `vacio` (design §3.1).
  **Hecho:** `unit/services/ejecucion-envio-informe-error.test.ts` verde (ejecución `error` terminal
  con el motivo, cero entregas, cero llamadas al almacén y a Meta); los tests de la 474 siguen verdes.
- [ ] **T1.2** Catálogo `tiendas_fulfillment` en `DescriptorParametro` (design §3.2).
  **Hecho:** typecheck verde; la rama genérica de `ParametrosInforme.tsx` sigue pintando «todavía no
  se puede editar» para los demás catálogos (test existente verde).

## F2 — Lógica pura (depende de F0; T2.x en paralelo)

- [ ] **T2.1 [P]** `fecha-larga-cr.ts` (`fechaLargaCR`, tablas fijas, sin `Intl`).
  **Hecho:** test con «Lunes 5 de octubre de 2026» y la frontera 23:30 CR = día siguiente UTC.
- [ ] **T2.2 [P]** `picking-modelo.ts` (`construirModeloPicking`): parseo con `parsearProducto`, fusión
  por orden, forma visible, orden de grupos, «Sin producto indicado», días CR, atrasadas, identificador
  con guía, totales, `valores`, `nombreArchivo` (design §4.5).
  **Hecho:** `unit/whatsapp-envios/picking-modelo.test.ts` cubre R10–R15, R18, R23, R26 (filas
  ordenadas) y el módulo no importa nada con IO (lo dice un test de imports o la revisión).
- [ ] **T2.3** `picking-pdf.ts`: `maquetarPicking(modelo, medir)` y `pdfDePicking(modelo)` (design §4.6,
  D6). Depende de T2.1 y T2.2.
  **Hecho:** `unit/whatsapp-envios/picking-pdf.test.ts` cubre R16, R17, R19–R22 (incluido 500 órdenes
  → varias páginas con «Página X de Y» correcto y U+1D560 → «?» con aviso); humo `%PDF` y nº de
  páginas.

## F3 — Datos (depende de F0; en paralelo con F2)

- [ ] **T3.1 [P]** `IPickingRepository` + `PickingRepository` con las tres lecturas (design §4.3).
  **Hecho:** `unit/repositories/picking-repository.test.ts` (UNA `$queryRaw` con 1 y con 60 órdenes,
  R29).
- [ ] **T3.2** int `picking-ordenes-en-preparacion.test.ts` (R6, R9 parte de datos, R14 historial,
  R26). Depende de T3.1.
  **Hecho:** verde contra Postgres, conjunto EXACTO de ids, y las **cuatro mutaciones** del WHERE
  (`s.value`, `t.fulfillment`, `o.deleted_at`, `o.tienda_id`) medidas UNA A UNA: aplicada → comprobada
  con `git diff` → ROJO → revertida → verde. Tabla de mutaciones en la bitácora.
- [ ] **T3.3** int `picking-resumen-tiendas.test.ts` (R3: solo `adminTienda` con fulfillment, conteos,
  atrasadas con dos N, orden por nombre) + test cruzado SQL vs modelo de «atrasada». Depende de T3.1.
  **Hecho:** verde y mutación «sin `fulfillment = true`» ROJA.

## F4 — Informe, registro y acción (depende de F1, F2, F3)

- [ ] **T4.1** `picking.ts` (`crearInformePicking`) y registro en `catalogo.ts` con el lector real
  perezoso (design §4.1, §4.2, §4.4).
  **Hecho:** `unit/whatsapp-envios/informe-picking.test.ts` cubre R1, R2 (schema), R7, R8, R24, R25,
  R27, R28; `catalogo-informes.test.ts` y `catalogo-de-variables.test.ts` de la 474 verdes con
  `picking` dentro.
- [ ] **T4.2** int R9/R30 por el catálogo REAL (`informePorClave("picking")!.generar`): remisiones
  sembradas; `updated_at` intacto y cero filas de historial; repetida con `ahora + 1 día` sigue
  saliendo; tras moverla de estado ya no.
  **Hecho:** verde y mutación «registrar con lector vacío» ROJA.
- [ ] **T4.3 [P]** `unit/services/whatsapp-envio-service-picking.test.ts`: R2 (guardar sin tienda →
  `parametros.tiendaId`) y R5 (rol y usuario `adminTienda` rechazados) con el informe del catálogo.
  **Hecho:** verde.
- [ ] **T4.4 [P]** Acción `listarTiendasPicking({ diasAtraso })` en `lib/actions/envios-whatsapp.ts`,
  schema y DTO en `lib/types/envios-whatsapp.ts` (design §5).
  **Hecho:** `unit/actions/envios-whatsapp-picking-actions.test.ts` (R4: sin sesión / `admin` /
  `adminTienda` → sin llamar al repo; `maestro` → lista).
- [ ] **T4.5** Bitácora backend en `progress/impl_476.md`: SHA, contrato para frontend (acción y DTO),
  mapa R → test, mutaciones medidas, desvíos. `./init.sh --rapido` con `INIT_EXIT` dentro del log
  (`progress/gate_476_backend.log`), mirando `skipped` de `integration/db`.
  **Hecho:** gate verde, ningún archivo de `integration/db` saltado. COMMITEADO (memoria «informe de
  agente sin commitear»).

## F5 — Pantalla (frontend_dev, depende de F4)

- [ ] **T5.1** `SelectorTiendaPicking` + rama `tiendas_fulfillment` en `ParametrosInforme.tsx` (una
  elección, «N órdenes · M atrasadas», re-pide al cambiar N, estado vacío).
  **Hecho:** `components/SelectorTiendaPicking.test.tsx` (R3 de pantalla) verde; mutación «no re-pedir al
  cambiar N» ROJA; la guardia `superficie-de-uso` verde con la acción usada.
- [ ] **T5.2** Verificación visual: capturas (escritorio y 390 px) del panel de parámetros y del PDF
  generado con datos de ejemplo de tres tiendas (una con atrasadas, una sin, una con 60+ órdenes),
  comparadas con `ParamsPicking.dc.html` y `PdfPicking.dc.html`; diferencias decididas anotadas
  (D1: radio en vez de casillas; D2: «Remisiones»; pie sin «X van en su propio PDF»). Un solo dev
  server (memoria «dos dev servers se pisan»).
  **Hecho:** capturas fuera del repo y lista de diferencias en la bitácora.
- [ ] **T5.3** `./init.sh --rapido` frontend (`progress/gate_476_frontend.log`, `INIT_EXIT` dentro).
  **Hecho:** verde, bitácora frontend con mapa R → test de pantalla, COMMITEADA.

## F6 — Cierre (leader)

- [ ] **T6.1** `gh pr checks` del PR: build de Vercel verde antes de mergear (el gate no corre `next build`).
- [ ] **T6.2** Tras desplegar: crear la plantilla «de informe: Picking» con documento y enviarla a
  aprobación; al aprobarse, un envío por tienda apagado → «Probar ahora» en cada uno → PDF en el
  teléfono y fila en el historial; comparar ÓRDENES/UNIDADES del PDF con un conteo de solo lectura de
  producción de las órdenes en preparación de esa tienda (memoria «medir antes»). Encender solo cuando
  el humano lo pida.
  **Hecho:** cifras PDF = cifras medidas, anotado en `progress/`.

## Dependencias

```
T0.1 ─ T0.2 ─┬─ F1 (T1.1, T1.2) ───────────────┐
             ├─ F2: T2.1 [P], T2.2 [P] ─ T2.3 ──┼─ F4: T4.1 ─ T4.2 ; T4.3 [P], T4.4 [P] ─ T4.5 ─ F5 ─ F6
             └─ F3: T3.1 [P] ─ T3.2, T3.3 ──────┘
```

F2 y F3 corren en paralelo entre sí; F1 también si T0.2 dice que hay que hacerla aquí.
