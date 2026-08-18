# Feature 230 — Descarga de cierres general y detallada · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas de su misma
> tanda. Cada task lleva su criterio de **HECHO**. Nada se da por hecho sin gate:
> `./init.sh --rapido` para cerrar una tanda, `./init.sh` completo antes del PR.
>
> **La gate F1.4 está PASADA** (2026-08-18, D6…D13 en `requirements.md`). No queda ninguna
> pregunta bloqueante. Antes de arrancar, leer `design.md §11`: el trabajo real excede
> `complexity: medium` y las tandas están cortadas para poder partir la entrega
> (tandas 1-6 = `cierres-admin`; tanda 7 = bodega).

---

## Tanda 1 — Contrato compartido y schema

- [ ] **T1.1 — DTO y result compartidos.** `CierreGestionDescargaDTO` y
      `ListarGestionesDescargaServiceResult` en `lib/interfaces/services/ICierresAdminService.ts`
      (design §2.4).
      **HECHO:** `pnpm typecheck` verde y el DTO **no declara** `evidenciaUrl`,
      `tieneEvidencia`, `gestionId` ni `ordenId` (design §2.5).

- [ ] **T1.2 [P] — Schema de la lista blanca.** `filtrosDescargaGestionesSchema` +
      `FiltrosDescargaGestiones` en `lib/types/filtros-cierres.ts`, desde las primitivas que ese
      módulo ya tiene (`listaDeIds`, `fechaCalendario`, `rangoCoherente`).
      **HECHO:** `destinoZonaIds`, `page` y `pageSize` producen `ZodError` (un caso por clave), y
      un rango invertido también.

- [ ] **T1.3 [P] — `RESULTADO_FILA_LABEL`** (singular) en `cierre-labels.ts`, junto al plural,
      sin tocarlo (design §6.1).
      **HECHO:** caso que fija los cinco textos y que falla si se derivan del plural.

---

## Tanda 2 — Borde de lectura A: cierres del día (`cierres-admin`)

- [ ] **T2.1 — Método del repositorio.** `findGestionesPorAlcanceCompleto(alcance, filtros)` en
      `CierresAdminRepository` + su firma en la interfaz. Reusa `alcanceWhere`, `filtrosWhere` y
      `ORDEN_CIERRES_ADMIN`; **no** selecciona `evidenciaStoragePath`.
      **HECHO:** test de `where` que afirma el alcance dentro de la relación `cierre` y el orden
      `[{cierre:{solicitadoAt:"desc"}},{createdAt:"desc"}]`.
      *Depende de: T1.1, T1.2.*

- [ ] **T2.2 — Método del servicio.** `listarGestionesCierresAdminCompleto` en
      `CierresAdminService`, calcado de `listarPendientesCierresAdminCompleto:334-350`. **Sin
      una sola llamada a `this.signedUrls`.**
      **HECHO:** los tests de T2.2 pasan, incluido «cero llamadas al firmador» con un doble que
      cuenta invocaciones.
      *Depende de: T2.1.*

- [ ] **T2.3 — Server Action** en `lib/actions/cierres-admin.ts`, hermana de `:216-228`. Actor
      ANTES de validar.
      **HECHO:** los cuatro desenlaces (`ok`, `unauthenticated`, `forbidden`,
      `validation_error`) cubiertos, y `unauthenticated` se resuelve **sin** parsear la entrada.
      *Depende de: T2.2.*

---

## Tanda 3 — La declaración de columnas (26 columnas, decididas)

- [ ] **T3.1 — Módulo `cierres-gestiones-fundida-descarga-columnas.ts`:**
      `COLUMNAS_DESCARGA_GESTIONES_FUNDIDA` (26 columnas, tabla de `design.md §6`) +
      `filaDescargaGestionFundida`. PURO. **Sin columna de evidencia.**
      **HECHO:** `columnas-sensibles.guardia.test.ts` lo descubre por convención y pasa; el
      módulo no importa React.
      *Depende de: T1.1, T1.3.*

- [ ] **T3.2 — Test de orden y censo** en
      `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts`, con el esperado
      LITERAL de las 26 claves y los 26 encabezados (patrón de
      `cierre-gestiones-descarga-columnas.test.ts:38-72`).
      **HECHO:** `columnas-asercion-de-orden.guardia.test.ts` deja de listarla como «desnuda»; una
      permuta de dos columnas pone rojo el caso.
      *Depende de: T3.1.*

- [ ] **T3.3 — Tests de proyección por resultado** (cinco casos + invariantes de celda), con el
      vacío exacto de la tabla de `design.md §6`.
      **HECHO:** cubren R9, R10, R43, R44, R45, R46, R47.
      *Depende de: T3.1.*

- [ ] **T3.4 — Test de ausencia de evidencia (R40/R41).** Un requisito que se cumple «porque la
      columna no existe» necesita su test igual. Tres aserciones: (a) ninguna clave ni
      encabezado de `COLUMNAS_DESCARGA_GESTIONES_FUNDIDA` menciona evidencia; (b) la fila
      proyectada no tiene ninguna celda cuyo origen sea un campo de evidencia; (c) el DTO del
      servicio no declara campo de evidencia alguno (lectura del fuente de la interfaz).
      **HECHO:** añadir a mano una columna «Tiene evidencia» a la fundida pone rojo el caso
      (mutación comprobada).
      *Depende de: T3.1.*

- [ ] **T3.5 [P] — Corregir la cabecera de `cierre-gestiones-descarga-columnas.ts`** con el
      texto de `design.md §8`. **Ni una línea de código de ese archivo.**
      **HECHO:** la guardia de T3.6 pasa y el `git diff` del archivo es solo comentario.

- [ ] **T3.6 [P] — Guardia de la prosa (R52):** test que lee el archivo y falla si la cabecera
      afirma que no existe un archivo único **y** falla si ha perdido la mención a la P2 de la
      170.
      **HECHO:** los dos canarios se comprueban con cadenas sintéticas (positivo y negativo),
      como hace `columnas-asercion-de-orden.guardia.test.ts:147-201`.

---

## Tanda 4 — El diálogo

- [ ] **T4.1 — `DescargarGestionesDialog.tsx`:** control + `Modal` con selección múltiple de
      mensajeros (de `catalogoFiltros.mensajeros`) y rango de fechas propio (`desde`/`hasta`),
      cancelar y confirmar. Recibe la Server Action por prop: el mismo componente sirve a las
      dos pantallas.
      **HECHO:** cancelar y confirmar-con-cero **no** llaman al borde (espía sobre la acción); un
      rango invertido no produce archivo.
      *Depende de: T2.3, T3.1.*

- [ ] **T4.2 — Independencia de la barra de filtros (R34/R35).**
      **HECHO:** test que afirma que el objeto enviado al borde contiene SOLO lo elegido en el
      diálogo, y que cambiar los filtros de pantalla no altera ese objeto.
      *Depende de: T4.1.*

---

## Tanda 5 — Montaje en `cierres-admin`

- [ ] **T5.1 — Montaje en `CierresAdminModule.tsx`** junto al control general, en las dos
      pestañas, con `titulo` propio.
      **HECHO:** la pantalla renderiza DOS controles de descarga con nombres accesibles
      distintos, y el general sigue siendo byte a byte el de antes.
      *Depende de: T4.2.*

---

## Tanda 6 — Verificación transversal del camino A

- [ ] **T6.1 [P] — Guardia de frontera** (fuente única, patrón 134): el subárbol del control
      detallado no importa `lib/services`, `lib/repositories`, `getPrismaClient` ni construye un
      `where`; y no existe ninguna ruta `app/api/` que sirva esta descarga.
      **HECHO:** mutación comprobada — añadir el import del servicio pone la guardia roja.
      *Depende de: T5.1.*

- [ ] **T6.2 [P] — No-regresión** (R2, R3): los tests existentes de `CierresDescarga.test.tsx`,
      `cierres-admin-descarga-columnas.test.ts`, `cierres-bodega-descarga-columnas.test.ts` y
      `cierre-gestiones-descarga-columnas.test.ts` pasan **sin modificarse**, y las constantes
      `TIENE_EVIDENCIA_*` y el helper `tieneEvidencia` siguen existiendo.
      **HECHO:** si alguno hubo que tocarlo, es un hallazgo, no un ajuste.
      *Depende de: T5.1.*

- [ ] **T6.3 — Alcance por rol, listado por listado** (R14, R20, R37, R38): maestro,
      adminSatelite con zona, adminSatelite sin zona, y un `mensajeroIds` de otra zona.
      **HECHO:** el satélite no recibe ni una gestión fuera de su zona destino; pedir el
      mensajero ajeno devuelve cero filas (no error, no filas) y el MISMO desenlace que un
      mensajero sin cierres.
      *Depende de: T2.2.*

---

## Tanda 7 — Borde de lectura B y montaje: cierres de BODEGA (D10)

> Puede entregarse en un PR aparte (design §11). Depende de las tandas 1-6 solo por T3.1.

- [ ] **T7.1 — Método del repositorio de bodega.**
      `findGestionesDeCierresBodegaCompleto(filtros)` en `CierresBodegaAdminRepository`, reusando
      `GESTION_ADMIN_SELECT`, `DETALLE_ADMIN_SELECT` y `toPendienteRowDesdeSnapshot` que ese
      módulo ya importa, con `where: { cierre: { cierreBodegaId: { not: null }, ...recortes } }`.
      **HECHO:** test de `where` que afirma `cierreBodegaId: { not: null }` y el mismo `orderBy`
      que el camino A.
      *Depende de: T1.1, T1.2.*

- [ ] **T7.2 — Método del servicio de bodega.** `listarGestionesCierresBodegaCompleto` en
      `CierresBodegaAdminService`, con el guard `esAccesoTotal` ANTES del repositorio y el mismo
      bloque del tope. Sin firmador.
      **HECHO:** rol distinto de acceso total → `forbidden` sin tocar el repositorio (R25).
      *Depende de: T7.1.*

- [ ] **T7.3 — Server Action** en `lib/actions/cierres-bodega-admin.ts`, misma forma que T2.3.
      **HECHO:** los cuatro desenlaces cubiertos.
      *Depende de: T7.2.*

- [ ] **T7.4 — Montaje en `CierresBodegaAdminModule.tsx`,** reusando el diálogo de T4.1 con la
      acción de T7.3.
      **HECHO:** la pantalla renderiza el control nuevo sin tocar sus cuatro descargas
      existentes.
      *Depende de: T7.3, T4.1.*

- [ ] **T7.5 — Paridad de los dos caminos (R26) y cobertura de la GAM (R27).**
      **HECHO:** (a) test que ejecuta los dos servicios sobre gestiones equivalentes y compara la
      fila proyectada: idénticas, mismas 26 columnas desde la misma declaración; (b) test que
      afirma que una gestión de un cierre con destino `bodega_central` sale por el camino A sin
      ningún `if` sobre `esCentral` en el código nuevo (grep del subárbol).
      *Depende de: T7.4, T5.1.*

---

## Tanda 8 — Cierre

- [ ] **T8.1 — Gate.** `./init.sh --rapido` al cerrar cada tanda; `./init.sh` completo antes
      del PR, con el baseline de rojos medido ANTES de empezar (ver memoria del repo: la rama
      base puede traer rojos ajenos).
      **HECHO:** delta 0 de rojos respecto al baseline medido, typecheck 0, lint sin errores
      nuevos.

- [ ] **T8.2 — Bitácora.** `progress/impl_230.md` con el mapa R1…R52 → test NOMBRADO Y
      EJECUTADO.
      **HECHO:** 52 de 52; el reviewer rechaza si falta uno.

---

## Trazabilidad — cada `R<n>` con su test

| R | Test previsto |
| --- | --- |
| R1 | `CierresAdminDescargaDetallada.test.tsx` › `la pantalla ofrece un control de descarga detallada además del general` |
| R2 | `CierresDescarga.test.tsx` (existente, sin tocar) + `cierres-admin-descarga-columnas.test.ts` + `cierres-bodega-descarga-columnas.test.ts` (existentes, sin tocar) |
| R3 | `cierre-gestiones-descarga-columnas.test.ts` (existente, sin tocar) › los cinco casos de orden + `cierres-gestiones-fundida-descarga-columnas.test.ts` › `las constantes de la marca de evidencia siguen exportadas y sin cambios` |
| R4 | `CierresAdminDescargaDetallada.test.tsx` › `descargar no cambia la página, ni los filtros, ni el detalle abierto` |
| R5 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `emite una fila por gestión y ninguna fila agregada` |
| R6 | `CierresAdminDescargaDetallada.test.tsx` › `produce un solo archivo de una sola hoja para un conjunto con los cinco resultados` |
| R7 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `toda fila lleva la columna Resultado con la etiqueta singular de su resultado` |
| R8 | idem › `toda fila lleva el nombre del mensajero dueño del cierre` |
| R9 | idem › `las 26 columnas salen en el orden declarado sea cual sea el resultado` |
| R10 | idem › `una columna que no aplica al resultado deja la celda vacía y no se omite` |
| R11 | `cierres-admin-gestiones-where.test.ts` › `ordena por fecha de solicitud del cierre y luego por la gestión` |
| R12 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `la fundida no declara ni estado del cierre ni destino` |
| R13 | `cierres-descarga-detallada-puerta.test.ts` › `las filas salen de la Server Action de esa pantalla y de ninguna otra fuente` |
| R14 | `CierresAdminService.gestiones-completo.test.ts` › `el satélite no recibe gestiones de cierres fuera de su zona destino` |
| R15 | idem › `el alcance no se lee de la entrada: un input con zona ajena no amplía nada` |
| R16 | `cierres-descarga-detallada-frontera.guardia.test.ts` › `el borde de descarga no importa servicio, repositorio ni Prisma` |
| R17 | `cierres-admin-actions.test.ts` › `devuelve unauthenticated sin parsear la entrada y sin filas` |
| R18 | `CierresAdminService.gestiones-completo.test.ts` › `un rol no admin recibe forbidden antes de tocar el repositorio` |
| R19 | `filtros-descarga-gestiones-schema.test.ts` › `una clave fuera de la lista blanca produce validation_error y ninguna fila` |
| R20 | `CierresAdminService.gestiones-completo.test.ts` › `un adminSatelite sin zona recibe conjunto vacío sin consultar la base` |
| R21 | idem › `superar el tope de descargaConfig devuelve limite_excedido con conteos y sin filas` |
| R22 | idem + `CierresBodegaAdminService.gestiones-completo.test.ts` › `no se firma ninguna URL de evidencia al producir el conjunto` |
| R23 | `CierresBodegaDescargaDetallada.test.tsx` › `el listado de cierres de bodega ofrece el control de descarga detallada` |
| R24 | `cierres-bodega-gestiones-where.test.ts` › `solo devuelve gestiones de cierres del día consolidados en un cierre de bodega` |
| R25 | `CierresBodegaAdminService.gestiones-completo.test.ts` › `un rol sin acceso total recibe forbidden antes de tocar el repositorio` |
| R26 | `cierres-gestiones-paridad.test.ts` › `los dos caminos proyectan la misma fila desde la misma declaración de columnas` |
| R27 | idem › `una gestión con destino bodega central sale por el camino de cierres del día` + `cierres-descarga-detallada-frontera.guardia.test.ts` › `el código nuevo no ramifica por esCentral` |
| R28 | `DescargarGestionesDialog.test.tsx` › `pulsar el control abre el diálogo y no descarga nada todavía` |
| R29 | idem › `el diálogo solo ofrece mensajeros del catálogo del alcance` |
| R30 | idem › `permite seleccionar varios mensajeros a la vez` |
| R31 | idem › `ofrece un rango de fechas opcional que viaja al borde` |
| R32 | `filtros-descarga-gestiones-schema.test.ts` › `un rango invertido produce validation_error` + `DescargarGestionesDialog.test.tsx` › `un rango invertido no produce archivo` |
| R33 | `CierresAdminDescargaDetallada.test.tsx` › `el archivo solo contiene gestiones de los mensajeros y el rango confirmados` |
| R34 | `DescargarGestionesDialog.test.tsx` › `el objeto enviado al borde contiene solo lo elegido en el diálogo` |
| R35 | idem › `el control detallado no lee ni modifica ningún filtro de la pantalla` |
| R36 | `cierres-descarga-detallada-puerta.test.ts` › `lo elegido viaja como filtro del mismo borde, sin consulta paralela` |
| R37 | `CierresAdminService.gestiones-completo.test.ts` › `pedir un mensajero fuera de alcance devuelve cero filas, no filas ajenas` |
| R38 | `CierresAdminDescargaDetallada.test.tsx` › `un mensajero sin cierres y uno fuera de alcance producen el mismo mensaje` |
| R39 | `DescargarGestionesDialog.test.tsx` › `cancelar o confirmar sin selección no produce archivo ni llama al borde` |
| R40 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `la fundida no declara ninguna columna de evidencia y ninguna celda la lee` (T3.4) |
| R41 | `cierres-descarga-detallada-frontera.guardia.test.ts` › `el DTO de descarga no declara ningún campo de evidencia` (T3.4c) + `columnas-sensibles.guardia.test.ts` (existente) |
| R42 | `columnas-sensibles.guardia.test.ts` (existente) › `ninguna fila de export emite un identificador interno con forma de uuid` |
| R43 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `los montos salen como el string del snapshot, sin símbolo ni separador` |
| R44 | `cierres-descarga-detallada-money.guardia.test.ts` › `el módulo de la fundida no contiene parseFloat, Number ni aritmética sobre montos` |
| R45 | `cierres-gestiones-fundida-descarga-columnas.test.ts` › `resultado, método, causa y origen salen como etiqueta legible` |
| R46 | idem › `un dato nulo deja la celda vacía y nunca el guion de pantalla` |
| R47 | idem › `una indemnización sin capturar deja la celda vacía y nunca cero` |
| R48 | `columnas-sensibles.guardia.test.ts` (existente) › `la guardia cubre TODAS las declaraciones del árbol` (la fundida aparece en el censo) |
| R49 | `cierres-descarga-detallada-frontera.guardia.test.ts` › `el módulo de columnas de la fundida es puro: no importa React ni toca el DOM` |
| R50 | `columnas-asercion-de-orden.guardia.test.ts` (existente) › `ninguna constante COLUMNAS_DESCARGA_* se queda sin aserción de orden` |
| R51 | `CierresAdminDescargaDetallada.test.tsx` › `los controles de la pantalla tienen nombres accesibles distintos y el archivo se llama distinto` |
| R52 | `cierre-gestiones-cabecera.guardia.test.ts` › `la cabecera ya no afirma que no existe un archivo único y conserva la razón de la P2` |

---

## Orden de ejecución y paralelismo

```
T1.1 ─┬─ T1.2 [P]
      └─ T1.3 [P]
        │
        ├─ T2.1 ── T2.2 ── T2.3 ──┐
        │            └── T6.3     │
        └─ T3.1 ─┬─ T3.2          │
                 ├─ T3.3          │
                 └─ T3.4          │
           T3.5 [P] ── T3.6 [P]   │
                                  ▼
                            T4.1 ── T4.2 ── T5.1 ─┬─ T6.1 [P]
                                                  └─ T6.2 [P]
        └─ T7.1 ── T7.2 ── T7.3 ── T7.4 ── T7.5 (necesita T5.1)
                                                  ▼
                                            T8.1 ── T8.2
```

La tanda 7 es la candidata natural a segundo PR (`design.md §11`). Dentro de cada tanda, lo
marcado `[P]` toca archivos disjuntos; las tandas 5 y 7.4 son serie porque cada una toca un
módulo de UI grande.
