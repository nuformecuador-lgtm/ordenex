# Review - Feature 63 "Orden lista actualizada"

Reviewer (no edita codigo). Rama: feature/63-orden-lista-actualizada
(tip 4a23991, base de rama 0337c4d, ancestro de adjustments). 2026-07-14.

## Veredicto: RECHAZADO - 1 bloqueante

El nucleo de la 63 (R1-R20) esta bien implementado y verde (92 tests propios).
El bloqueante NO es la logica de la 63: es drift de columnas FUERA DE ALCANCE
que los commits de la 63 arrastraron a ordenes-columns.tsx, regresando 3 tests
que estaban VERDES en la base de rama.

## Checklist R1-R20 (cubierto por test real)

Suite 63 (6 archivos): 6 passed / 92 tests. VERDE.

- R1 order-status.test.ts -> {status:ok, estatus:[{id,value}]}
- R2 it.each(maestro/admin/adminTienda/adminSatelite) -> ok
- R3 sin actor -> unauthenticated, repo NO llamado (asercion explicita)
- R4 mensajero Y rol desconocido -> forbidden, repo NO llamado. Set explicito
     ROLES_CATALOGO (rol futuro cae a forbidden)
- R5 orden-repository.guia.test.ts -> findMany con orderBy {value:asc}
- R6 orden-filter.test.ts -> listarOrdenesSchema acepta filter; opcional
- R7 clave fuera de whitelist -> ZodError (.strict()); status_id vacio -> ZodError
- R8 orden-service.test.ts -> filter.status_id -> where.estatusId; whitelist ==
     [status_id]; precedencia sobre el escalar
- R9 filtro + adminTienda: where.estatusId Y where.tiendaId=store1 (compone)
- R10 sin filter = comportamiento previo; estatusId escalar sigue
- R11 ni estatusId/deletedAt/tiendaId pasan .strict(); ninguna columna arbitraria
      llega a Prisma
- R12 ordenes-tabs.test.tsx -> tablist + 1 tab por estado
- R13 pendiente (default) y exclude custom no generan tab
- R14 tabs derivadas del catalogo (SWR) menos exclude por value
- R15 tab activa consulta listarOrdenes con filter.status_id
- R16 VERIFICADO A FONDO: tab NO visitada -> 0 llamadas a listarOrdenes
      (statusIds NO contiene los no visitados); al activar una 2a tab RECIEN ahi
      consulta. Montaje DIFERIDO por set visited (visited.has(id) ? Module : null),
      NO CSS. keepMounted solo conserva las ya visitadas.
- R17 cada tab monta su OrdenesModule con key SWR [ordenes:list, statusId, page,
      pageSize] -> paginacion/cache por estado
- R18 TabsList con overflow-x-auto; todas las tabs accesibles
- R19 ordenes-module.test.tsx -> con/sin filter reusa DataTable/Pagination; sin
      filter input identico (sin regresion)
- R20 OrdenesPage/page.tsx: mensajero/adminSatelite/sin-sesion NO montan tabs;
      /mis-asignaciones intacto. adminSatelite FUERA del v1 (F1.4-h)

Backend autz (foco): correcta. listarOrderStatus() es accion NUEVA;
listarCatalogoEstatus() (feature 17, lib/actions/ordenes-guia.ts) NO fue tocada.
filter es WHITELIST estricta con mapa explicito FILTER_TO_COLUMN; sin inyeccion.
Alcance por rol (where.tiendaId) compone con el filtro. /mis-asignaciones no
aparece en el diff de la rama.

## Trazabilidad / Tasks / Checkpoints
- Trazabilidad R->test completa. OK.
- tasks.md con casillas [ ] (cosmetico); todas con test verde. menor.
- CHECKPOINTS: falla "pnpm test pasa" y "typecheck pasa" (ver abajo).

## Verificacion ejecutable

typecheck: ROJO SOLO en archivos del baseline adjustments (tarifas/zonas/usuarios/
auth). NINGUN archivo de la 63 tiene error de tipos. -> rojo de BASELINE.

Suite 63: 6 passed / 92 tests. VERDE.

Blast radius del drift (tests que consumen ordenes-columns):
- OrdenesPage D1        tip ROJO | base 0337c4d VERDE -> ROJO NUEVO
- OrdenesPage D3        tip ROJO | base 0337c4d VERDE -> ROJO NUEVO
- AdminTiendaDashboard R11  tip ROJO | base VERDE -> ROJO NUEVO
- ordenes-columns R14 (feat 30 zona)  tip ROJO | base ROJO -> baseline
- OrdenesModuleReuse/OrdenesApartado/EstatusLabel/DataTable  VERDE
Los .test.tsx NO fueron modificados por la 63; cambio el CODIGO de columnas.

## Hallazgos

### BLOQUEANTE - drift de columnas fuera de alcance regreso 3 tests verdes
Los commits de la 63 (4b7e0a8 backend, 4a23991 frontend) modificaron
ordenes-columns.tsx con cambios que NO pertenecen a la 63 (ninguna R los pide) y
que ROMPEN 3 tests VERDES en la base 0337c4d:
- Se ANADIO una columna zona nueva (14 columnas vs 13) -> OrdenesPage D3 falla.
- Se RENOMBRARON headers Estatus->Estado y Flete->Flete + IVA -> OrdenesPage D1
  (labels exactas) y AdminTiendaDashboard R11 (espera Estatus/Flete) fallan.
Evidencia de NUEVO: en 0337c4d el archivo tenia Estatus, Flete, 12 columnas (sin
zona) y sintaxis valida; esos tests pasaban. El parse-error/columna ZOna que la
bitacora llama "drift ajeno pre-existente" fue introducido por el propio commit
backend 4b7e0a8 (que ademas metio un console.log(data) en OrdenesModule.tsx),
pese a que su bitacora afirma "NO se tocaron UI/componentes/paginas". La
afirmacion frontend ("OrdenesPage estaba COMPLETAMENTE roja en el baseline...
mejore el baseline") es INCORRECTA: en la base real la suite estaba verde.

Que falta: revertir los cambios de columnas fuera de alcance en
ordenes-columns.tsx (restaurar labels Estatus/Flete y quitar la columna zona
anadida) dejandolo como en 0337c4d. Si esos cambios se consideran deseables, van
en un cambio ratificado aparte CON sus tests actualizados, no colados en la 63.
Tras ello OrdenesPage D1/D3 y AdminTiendaDashboard R11 deben volver a verde.

### menor - otros archivos fuera de alcance en los commits de la 63
El diff toca ademas DataTable.tsx (wrapper overflow-x-auto), PriceLabel.tsx,
components/ui/sidebar.tsx y crea lib/utils/number.ts, sin R que los respalde. No
rompen tests, pero ensucian el diff y difuminan la trazabilidad. Separar.

### menor - ordenes-columns.test.tsx R14 (feature 30) sigue rojo
Rojo de BASELINE (drift zonas): el test espera columna Zona que rinda zonaNombre;
el codigo rinde relaciones.zona.nombre. Ajeno a la 63, anotado.

### menor - tasks.md con casillas [ ]
Todas las tasks tienen test verde, pero no marcadas [x].

## Resumen de rojos (separacion pedida)
- NUEVOS por la 63 (BLOQUEANTE): OrdenesPage D1, D3; AdminTiendaDashboard R11
  (todos por el drift de columnas colado en los commits).
- BASELINE (no bloqueante): typecheck tarifa/zona/usuario/auth;
  ordenes-columns R14 (feature 30 zona).

Veredicto: RECHAZADO. Vuelve al implementer para revertir el drift de columnas
fuera de alcance y restaurar los 3 tests a verde.
