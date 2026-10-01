# Review 465 — Tarifas: Excel de cobertura por distrito

- Rama revisada: `origin/feature/465-tarifas-excel-cobertura` @ `b2c7f023` (worktree detached, `git log -1` confirmado).
- Fecha: 2026-10-01. Revisor: reviewer (subagente).
- Busqueda de codigo: lectura directa del diff (`git diff origin/dev...HEAD`) y de los archivos citados por el design, mas `grep` para guardias y convenciones. No se uso el grafo `codebase-memory`: todo lo revisado era el diff de la rama, leido en el archivo real.

## Veredicto: RECHAZADO (cambios requeridos)

Un solo bloqueante, de arreglo pequeno (un caso de test): las columnas **GAM** y **Tarifa general de la zona** del archivo no las distingue ningun test, y una mutacion que las intercambia pasa la suite en verde. El resto (codigo, capas, trazabilidad, gate completo, T10 con numeros) esta bien.

## Checklist

### Especificacion
- [x] `requirements.md` con R1–R21 en EARS.
- [x] `design.md` con 6 alternativas descartadas y su porque.
- [ ] `tasks.md` con todas las tasks `[x]` — **las 11 siguen en `[ ]`** (ver hallazgo M1).

### Trazabilidad
- [x] `progress/impl_465.md` tiene el mapa R1–R21 → test.
- [ ] Cada R mapea a un test que lo verifica de verdad — **falla para R12/R14 en la proyeccion a celdas** (B1). El resto se leyo test a test (abajo).

### Calidad de codigo
- [x] typecheck limpio, lint `0 errors, 220 warnings` (preexistentes).
- [x] Tests: `./init.sh` COMPLETO corrido por el revisor en su worktree: `Test Files 2337 passed (2337)` · `Tests 32455 passed | 26 skipped (32481)`; los 26 skipped son `AnaliticaPage` (17) y `AnaliticaShell` (9), preexistentes; `tests/integration/db/cobertura-repository.test.ts (2 tests)` EJECUTADO (424 lineas de `integration/db` en el log, ninguna saltada); `== init OK ==`, `INIT_EXIT=0`.
- [x] E2E: no aplica (no toca auth, pagos, recaudo, ingesta ni webhooks; y no hay harness E2E). Sustituido por la verificacion visible T10 con Playwright (abajo).

### Datos y seguridad
- [x] Sin tablas nuevas ni migraciones (RLS no aplica).
- [x] Sin secretos ni hardcode de pais/moneda/cuenta.
- [x] Sin webhooks.
- [x] R21 solo-lectura: la interfaz del repositorio solo tiene dos lecturas; el servicio solo las llama (Proxy estricto en el test).

### Capas
- [x] Action (`lib/actions/cobertura.ts`) sin queries ni logica: sesion → servicio. Composition root unico que PASA `new CoberturaRepository(getPrismaClient())`, ejercitado por `cobertura.composition-root.test.ts`.
- [x] Servicio sin HTTP; puerta de rol antes de leer (R2).
- [x] Repositorio solo Prisma; la regla vive en `lib/utils/cobertura-distrito.ts` sobre `zonaUnicaDeDistrito` (no copia la regla).
- [x] Interfaces en `lib/interfaces/{repositories,services}/`.

### Permisos
- [x] La pagina ya corta a no-maestros en servidor; la action vuelve a autorizar (R2/R3). Server Action, no fetch.

### Ficha 275 (conflicto de archivos)
- [x] `TiendasModule.tsx`, `CrearTiendaForm.tsx` y `ZonasTarifasModule.tsx` NO aparecen en el diff. Unico archivo existente editado: `app/(app)/configuracion/tarifas/page.tsx` (+14) y `lib/actions/cobertura.ts` (propio de la ficha). Nada de `components/shared/` tocado.

### Verificacion final
- [x] `./init.sh` completo en verde (revisor).
- [ ] `progress/history.md` sin entrada de la 465 (M3; la escribe quien cierra).

## Mutaciones corridas por el revisor (secuenciales, sin gate en paralelo; revertidas con `git checkout`)

| Mutacion | Resultado |
| --- | --- |
| `CoberturaRepository.listZonaIdsConTarifaGeneral`: quitar `tiendaId: null` del `where` | ROJO: integracion R14 + composition root (2 failed) |
| `DescargarCoberturaButton`: anular el caso `unauthenticated` | ROJO: «R3 — sesion no valida…» |
| `clasificarCobertura`: `cobertura = row.distrito.activo && zona` (ignora la cadena) | ROJO: R7-R8, R9 y 4 casos de R15 |
| `filaCobertura`: `gam` lee `tieneTarifaGeneral` en vez de `esCentral` | **VERDE (sobrevive)** |
| `filaCobertura`: `tarifa_general` lee `esCentral` en vez de `tieneTarifaGeneral` | **VERDE (sobrevive)**: 35/35 en `tests/unit/app/tarifas` + `cobertura-descarga-columnas.test.ts` |

## Hallazgos

### B1 — BLOQUEANTE: las celdas GAM y Tarifa general no estan verificadas (R12, R14)

En `tests/unit/descarga/cobertura-descarga-columnas.test.ts` todos los DTO con zona unica llevan `esCentral` y `tieneTarifaGeneral` IGUALES (true/true en el `dto()` por defecto, false/false en «R12/R14 — zona unica no central y sin tarifa general»), y lo mismo el `ITEM` de `DescargarCoberturaButton.test.tsx` (true/true). Por eso cruzar las dos columnas en `filaCobertura` deja la suite verde (medido arriba). Es un fallo mudo en lo que el archivo entrega al usuario: el Excel diria GAM = Si donde hay tarifa general y viceversa.

Que falta: un caso con valores DISTINTOS en cada sentido, p. ej. `zonaUnica: { esCentral: true, tieneTarifaGeneral: false }` → gam «Sí», tarifa_general «No», y su inverso. Despues, repetir las dos mutaciones de la tabla y verlas en rojo.

Las capas de abajo SI estan cubiertas: `esCentral` real desde Postgres (integracion «En La Central»), el cruce de tarifa general por zona (`CoberturaService.test.ts`; `cobertura-distrito.test.ts` «la tarifa de OTRA zona no cuenta») y el `WHERE` (integracion, mutacion medida).

### M1 — menor: tasks.md sin marcar
Las 11 tasks de `specs/465-tarifas-excel-cobertura/tasks.md` siguen en `[ ]`. CHECKPOINTS exige `[x]` para `done`. Marcarlas en el mismo arreglo de B1 (T10 con los numeros de abajo).

### M2 — menor: T10 no la hizo el implementer; hecha por el revisor
`impl_465.md` la deja abierta. Numeros medidos aqui (seccion T10); deben copiarse a `progress/impl_465.md` como pide la task.

### M3 — menor: falta la entrada en progress/history.md
Se escribe al cerrar.

### M4 — menor: R2 no prueba el rol admin
`CoberturaService.test.ts` cubre adminTienda, mensajero, adminSatelite y apiKey, pero no `admin` (el test de la pagina si lo incluye). El codigo (`rol !== "maestro"`) lo cubre por construccion; anadirlo cuesta una palabra.

### M5 — menor: R17 prueba la fecha CR sobre la funcion comun, no sobre el boton
El caso de la fecha de Costa Rica llama a `nombreArchivoDescarga` con el literal del titulo; el test del boton solo comprueba la forma del nombre. Juntos cubren R17 (el titulo lo fija el boton y la fecha la funcion comun, con sus propios tests de la 151); no bloquea.

### M6 — observacion: R15 y nombres que solo difieren en tildes o mayusculas
`resolveGeo` tambien rechaza por AMBIGUEDAD (dos distritos del mismo canton con igual `normalize(nombre)`), caso que la regla del Excel no modela. Los `@@unique` de la base son por nombre exacto, asi que es posible en teoria. Medido en la base local: 0 colisiones normalizadas en provincia, canton y distrito. No se pide cambio.

### M7 — observacion ajena a la 465: modal «Confirma el SINPE de GAM» tapa Tarifas
Al entrar como maestro a `/configuracion/tarifas` en local se abre ese dialogo (de otra ficha) y deja la pagina aria-hidden hasta pulsar «Ahora no». No es de esta feature; se cita porque la verificacion visible tuvo que cerrarlo primero.

## Desviaciones declaradas por el frontend — juicio

1. **Mensaje propio para sesion caducada (R3): ACEPTABLE, y necesaria.** R3 exige un mensaje que pida volver a iniciar sesion; el adaptador comun (`filasDesdeResultado`) produce «No hay una sesion valida. Vuelve a intentarlo; el listado no cambio.», que no lo pide. Interceptar solo `unauthenticated` y delegar el resto es el arreglo minimo; hay precedente (`ExportarOperativoPanel` y varios modulos de configuracion con «Vuelve a iniciar sesion»). El test fija el texto literal y la mutacion que lo anula sale roja. El design §3.6 queda desactualizado en ese punto; no bloquea.
2. **Test de columnas en `tests/unit/descarga/`: ACEPTABLE.** Es la convencion del repo: los ~30 `*-descarga-columnas.test.ts` viven ahi y la guardia `columnas-asercion-de-orden.guardia.test.ts` busca alli la asercion de orden. tasks.md (T7) citaba la ruta equivocada.

## Trazabilidad leida test a test

| R | Test que muerde | Nota |
| --- | --- | --- |
| R1 | `TarifasPage.cobertura.test.tsx` (page.tsx real: maestro ve; 4 roles y sin sesion no) + boton R1 | literales de boton y ayuda |
| R2 | `CoberturaService.test.ts` (4 roles, 0 llamadas al repo) + `actions/cobertura.test.ts` | M4 |
| R3 | `actions/cobertura.test.ts` (`getPrismaClient` espiado, no se llama) + boton R3 (texto literal, sin xlsx ni blob) | mutacion roja |
| R4 | integracion (6 distritos sembrados, 2 no disponibles) + servicio (2 llamadas) + boton (2 clics, 2 lecturas; montar no lee) | |
| R5 | `cobertura-descarga-columnas.test.ts` (literales clave+encabezado) + boton (10 encabezados reales) | literal = contrato |
| R6 | `cobertura-distrito.test.ts` (3 niveles, tildes, mayusculas) + servicio | |
| R7 | regla (canton retirado) + integracion «Bajo Cantón Retirado» + proyeccion | |
| R8 | regla + R15 | mutacion roja |
| R9 | regla (6 casos de precedencia) + proyeccion (5 literales) + R15 | |
| R10 | regla (motivo null) + proyeccion (celda null) | |
| R11 | regla + integracion «Dos Zonas» + proyeccion | |
| R12 | regla + integracion «En La Central» + proyeccion | **B1** |
| R13 | regla + integracion + proyeccion (3 valores) | |
| R14 | integracion del WHERE (4 formas sembradas, mutacion roja) + regla + proyeccion | **B1** |
| R15 | `cobertura-vs-resolve-geo.test.ts` (24 combinaciones contra `resolveGeo` real, anti-vacuidad) | mutacion roja; M6 |
| R16 | boton: selector presente; preferencia guardada aplica orden y ocultas; desmarcar persiste en el ambito propio | |
| R17 | boton (forma del nombre, MIME) + funcion comun (fecha CR) | M5 |
| R18 | boton: forbidden, excepcion (sin filtrar el error crudo), limite | |
| R19 | boton: 0 filas, aviso, sin xlsx ni blob | |
| R20 | boton: dos clics en vuelo, una lectura, boton deshabilitado | |
| R21 | servicio con Proxy estricto | |

Ningun test verde sin datos: la integracion lanza si no hay adminTienda (sin `if (!x) return`) y exige los 6 distritos sembrados; R15 exige las 24 combinaciones y los 6 motivos. Las aserciones de textos son literales, no contra `MOTIVO_SIN_COBERTURA_LABEL` ni `filaCobertura`.

## T10 — verificacion visible (revisor, worktree propio, `pnpm dev -p 3011`, Playwright)

Maestro local `maestro.qa465@ordenex.test` sembrado con `pnpm db:seed:maestro` (con cedula y telefono propios: los por defecto ya existian y el upsert fallaba por unique). Login con OTP leido del log del dev server (el texto real es «Tu codigo de verificacion: NNNNNN», no «Codigo OTP generado»). Servidor bajado al terminar; log borrado (registra la contrasena del login en claro, es local).

- Bloque en pantalla (innerText): «Cobertura / Descargar cobertura / Descarga un Excel con cada distrito, si llegamos a él y con qué zona.» — boton, selector de columnas y linea de ayuda visibles, encima de «Asignar Tarifas» y «Costos por zona».
- Archivo: `cobertura-por-distrito-2026-10-01.xlsx`, 1 hoja, 10 encabezados en el orden de R5, tildes correctas («Cantón», «Sí», «él»).

| Medida | xlsx | Base local (SQL) | Coincide |
| --- | --- | --- | --- |
| Filas de datos | 494 | `count(*) FROM distrito` = 494 | si |
| Cobertura = Sí | 297 | provincia, canton y distrito activos y exactamente 1 fila en `zona_distrito` = 297 | si |
| Cobertura = No | 197 | 194 sin zona + 3 varias zonas | si |
| Motivo «Sin zona asignada» | 194 | 194 | si |
| Motivo «Asignado a varias zonas» | 3 | 3 | si |
| Tarifa general = Sí | 0 (297 «No», 197 vacias) | distritos con zona unica cuya zona tiene tarifa (tienda NULL) = 0 | si |

Ningun distrito retirado en la base local, asi que los motivos de retiro no se ven en el archivo (cubiertos por la integracion).

## Para volver a revision

1. B1: anadir a `cobertura-descarga-columnas.test.ts` los casos `esCentral` distinto de `tieneTarifaGeneral` en ambos sentidos y medir las dos mutaciones en rojo.
2. M1/M2: marcar tasks.md y anotar los numeros de T10 en `progress/impl_465.md`.
3. Opcional: M4 (anadir `admin`).
