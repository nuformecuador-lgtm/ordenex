# Revisión — Ficha 463 (wallets: buscador y filtros canónicos en dos niveles, selector de orden)

Revisor: reviewer. Fecha: 2026-10-01. Rama revisada: `origin/feature/463-wallets-filtros-y-orden` @ `b5bb07e1`
(merge-base con `dev`: `78972be6`). Revisado en worktree aislado, `checkout --detach` de ese SHA.

Búsqueda de código: lectura directa de archivos y `grep` (el diff es acotado y se leyó entero); no hizo
falta el grafo `codebase-memory` para localizar nada que el diff no dijera ya.

## Veredicto: **RECHAZADO**

Dos bloqueantes, los dos de trazabilidad sobre dinero y los dos baratos de cerrar:

1. **R49 no se cumple en los cuatro estados de cuenta** (solo en la caja), y su fila del mapa apunta a un
   test que no lo verifica. Medido con una sonda (abajo).
2. **R12, cláusula «el detalle de una fila de la composición»: sin red.** Una mutación que manda
   Entra/Sale y categoría al detalle de fila sobrevive a todas las suites de la caja.

El resto está bien hecho: backend sólido y probado contra Postgres con datos, el modo «Aplicar» es opt-in
de verdad, las cifras de la caja no se mueven con la zona del libro (mutación propia muerta), el saldo
corrido es idéntico en los dos sentidos y la línea del saldo inicial cae donde debe en pantalla y en Excel
(mutaciones propias muertas).

## Checklist

### Especificación
- [x] `requirements.md` con R1–R49 en EARS.
- [x] `design.md` con 6 alternativas descartadas y su porqué.
- [x] `tasks.md`: T1–T10 marcadas `[x]`.

### Trazabilidad
- [x] `progress/impl_463.md` contiene el mapa R1–R49 → test.
- [ ] **Cada R mapea a un test que lo verifica: NO** — R49 (estado de cuenta) y R12 (detalle de fila). Ver B1/B2.

### Calidad de código
- [x] `pnpm run typecheck`: 0 errores (gate).
- [x] `pnpm run lint`: 0 errores, 220 warnings preexistentes.
- [x] `pnpm test`: verde en el gate completo (abajo).
- [x] E2E: **no aplica** — el repo no tiene harness E2E; el riesgo se cubre con integración contra Postgres
      y la verificación en la app de `impl_463.md` (T10).

### Datos y seguridad
- [x] Sin tablas nuevas (sin RLS que poner), sin migraciones, sin índices.
- [x] Sin secretos ni hardcode de país/moneda/cuenta. Sin webhooks.
- [x] Escapado de `%` y `_` (`escaparComodinesLike`, que también escapa `\`) en caja y estado de cuenta;
      probado con filas trampa contra Postgres (`100%dto` vs `100 dto`, `a_b` vs `axb`, `%%%`, `___`).
- [x] Mínimo de 3 en el borde (`.trim().min(3).max(100)`); `ILIKE` parametrizado, sin `Prisma.raw`.
- [x] R27 se decide en el servidor: `conNombreRegistrador = vista === "oficina"`, y `vista` la fija el método
      del servicio (`leerMiTienda` ⇒ `"tienda"`), no el cliente. El placeholder de `/mi-wallet` no nombra a
      quién registró. Probado contra Postgres: buscar el nombre del registrador en `/mi-wallet` = texto ausente.

### Patrón de capas
- [x] Acciones parsean con zod y llaman al servicio; servicios sin HTTP; SQL solo en repositorios.
- [x] Interfaces actualizadas en `lib/interfaces/`.
- [x] Término y orden NO están en `BalanceFiltros`: ningún agregado de las cifras puede recibirlos por tipo;
      `terminoYOrden` vive fuera de `construirFiltros`.

### Permisos / multi-país
- [x] Mismos guards (`esAccesoTotal`) antes de leer. Nada hardcodeado.

### Verificación final
- [x] `./init.sh` COMPLETO en verde, corrido por el revisor (no se confió en la bitácora).
- [ ] `progress/review_463.md` con veredicto OK — **no: RECHAZADO**.
- [ ] Entrada en `progress/history.md` — pendiente (la pone el leader al cerrar).

## Verificación ejecutable (salida real)

`./init.sh` completo, secuencial, sin dev server ni mutaciones en paralelo; log en
`progress/gate_review_463.log` (`INIT_EXIT` escrito dentro):

```
✓ feature_list.json: sin ids duplicados (461 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 325 archivos de tests contra Postgres SI se ejecutan
 Test Files  2351 passed (2351)
      Tests  32666 passed | 26 skipped (32692)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2351 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son de `AnaliticaPage` (17) y `AnaliticaShell` (9), ajenos. Las tres integraciones nuevas
corrieron contra Postgres: `libro-caja-busqueda-orden-463` (9), `estado-cuenta-busqueda-orden-463` (10),
`saldos-tiendas-busqueda-463` (5). Ninguna tiene `if (!x) return;`; todas afirman conteos exactos del
conjunto sembrado (no-vacuidad).

## Mutaciones propias (todas restauradas; árbol limpio comprobado con `git status` tras cada una)

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | Dinero: al releer la wallet, resumen y desglose reciben Entra/Sale y categoría (`entradaWallet = inputDeLibro(...)`) | **Muerta**: 5 rojos (CJ R12, CJ R19, 458E periodo, 458E R60, AQuien458E mensajero) |
| M1b | Dinero: el detalle de una fila de la composición recibe Entra/Sale y categoría (`ComposicionGananciaCard filtros={{...filtrosDeWallet(..), tipo, categoria}}`) | **SOBREVIVE** a WalletCaja463, WalletLibroCaja458E, WalletFiltroAQuien458E, WalletDescarga, DetalleFilaComposicion, ComposicionGananciaCard y wallet-page → **B2** |
| M2 | `ORDER BY` final del estado de cuenta invertido (`asc`⇒DESC, `desc`⇒ASC) | **Muerta**, pero solo por las redes de la 458 (5 rojos vía `CRONOLOGICO`); `estado-cuenta-busqueda-orden-463` **pasa entero** → m3 |
| M3a | Excel del estado de cuenta: saldo inicial siempre primera fila | **Muerta**: 4 rojos (EC R43 desc, descarga-columnas ×2, WalletDescarga) |
| M3b | Pantalla: con «Más recientes» el saldo inicial arriba de la página 1 | **Muerta**: 14 rojos (EC regla y R39, EstadoCuenta.test 463 R39 ×2, Anulados, Satélite, mi-wallet-page…) |
| M4 | R14: `verResumenCajaAction` parsea el esquema del libro (acepta término y orden) | **Muerta**: 4 rojos (ACT R14 ×4) |
| M5 | `FilterComponent`: la precarga de URL se emite siempre en el acto (rama del modo «Aplicar» para todos) | **SOBREVIVE** a las 5 suites `filter-component*` (110 tests) → m4 |
| M6 | Libro de la caja: sentido del orden invertido en el repositorio | **Muerta**: 7 rojos en `libro-caja-busqueda-orden-463` |

Más las del implementador (M1–M8, E1–E7, T1–T2, F1–F3), que no se repitieron.

## Hallazgos

### B1 — BLOQUEANTE — R49 no se cumple en los estados de cuenta; el test mapeado no lo verifica

R49 (ubicuo): «SI una lectura falla, ENTONCES el sistema DEBE avisar en español y conservar en pantalla
las cifras, el libro y los filtros aplicados que había antes del intento.» Aplica a toda superficie con
libro. Design §6 y T7 solo lo resolvieron en la caja, y el mapa lo da por cubierto en el estado de cuenta
con `EstadoCuenta.test` «R5 (171) … el fallo se dice», que solo afirma que sale el aviso y que las tarjetas
siguen en pie.

**Medido** con una sonda de componente (montar la tienda, hacer fallar `verEstadoCuentaAction`; la sonda
se borró después):

- **Aplicar un periodo que falla:** las tarjetas siguen siendo las de SIN periodo (`keepPreviousData`), pero
  la zona de la wallet dice `Periodo: 01 oct 2026 – 28 oct 2026` con «Quitar periodo» visible, y la tabla
  queda REEMPLAZADA por «No se pudo cargar el estado de cuenta.» (el libro anterior desaparece). Es lo que
  la caja evita con su `siembra` («para que la pantalla no diga que hay puesto un periodo que las cifras no
  reflejan», `WalletFiltrosCaja.tsx`): cifras de dinero de un periodo con el control diciendo otro.
- **Cambiar un chip que falla:** «Cobros» queda `aria-pressed=true` y el libro se sustituye por el aviso.

Qué falta: en `components/shared/estado-cuenta/EstadoCuenta.tsx`, ante un fallo de lectura, (a) seguir
pintando las filas de la última lectura buena con el aviso en español al lado (no en lugar de la tabla), y
(b) devolver periodo, chip, cierre, término y orden a los de esa lectura (para el periodo, `siembra` del
`FilterComponent`, como en la caja). Más un test de componente que afirme las tres cosas (aviso, libro
anterior, filtros anteriores) para el periodo y para un filtro del libro. Si el humano prefiere acotar R49
a la caja, hay que enmendar `requirements.md` y el mapa; tal como está aprobado, falla.

Nota: el contrato viejo «171 R5 — el extracto lo dice» (el aviso SUSTITUYE la tabla) choca con R49; el
arreglo debe reescribir ese test conforme al contrato nuevo, no debilitarlo.

### B2 — BLOQUEANTE — R12, «el detalle de una fila de la composición»: sin test

R12 nombra tres cosas: resumen, composición/desglose y «el detalle de una fila de la composición». El
código es correcto (`ComposicionGananciaCard` recibe `filtrosDeWallet(filtrosWallet)`, con tipo y categoría
vacíos), pero la mutación M1b —pasarle Entra/Sale y categoría— sobrevive a todas las suites que montan la
caja. CJ «R12» solo mira `resumen` y `desglose`. Es dinero: el detalle de una fila enseñaría un conjunto
distinto del importe de esa fila (lo que la ficha 339 R20 prohibió).

Qué falta: en `tests/components/WalletCaja463.test.tsx` (o `WalletLibroCaja458E`), con Entra/Sale y una
categoría puestas en la zona del libro, abrir el detalle de una fila de la composición y afirmar que
`listarMovimientosDeFilaAction` recibe solo `fila`, periodo/«A quién» y paginación (ni `tipo` ni
`categoria`). Comprobar que M1b lo pone rojo.

### m1 — menor — Clics del libro de la caja ignorados en silencio mientras se lee

`LibroCajaBarra.tsx`: los `SegmentedToggle` de orden y de Todo/Entra/Sale descartan el clic con
`if (!disabled …)` mientras `loading` (que incluye cada lectura del buscador), pero el control no se ve
deshabilitado (`SegmentedToggle` no tiene `disabled`). Pulsar «Más antiguas» mientras viaja una búsqueda
no hace nada y no lo dice. Los turnos (`turnoLibro`) ya resuelven la concurrencia, así que la guarda sobra:
o se quita, o se pinta deshabilitado.

### m2 — menor — Posición del saldo inicial con el orden pedido, no con el pintado

`EstadoCuenta.tsx`: `posicionSaldoInicial(sortDir, page, pageSize, data.total)` usa el `sortDir` del estado,
pero con `keepPreviousData: true` `data` puede ser la lectura anterior (otro orden). Mientras llega la nueva
página —y de forma persistente si falla— la línea del saldo inicial se coloca según un orden que no es el de
las filas pintadas. El comentario dice «con el orden de lo que se PINTA»; el código no. Se arregla guardando
el orden junto a la lectura (o derivándolo de la clave de `data`). Se resuelve de paso con B1.

### m3 — menor — La integración 463 del estado de cuenta no fija el sentido absoluto

`estado-cuenta-busqueda-orden-463` solo compara relativos (`desc` = `asc` al revés; «sin orden» = `desc`):
M2 la pasa entera. Hoy la atrapan las redes de la 458 vía `CRONOLOGICO`; conviene que «R34/R47» afirme
también que la primera fila de «Más recientes» es la de fecha mayor.

### m4 — menor — La precarga de URL de `FilterComponent` sin red de R22

M5 (emitir la precarga en el acto, sin debounce, también fuera del modo «Aplicar») sobrevive a las 110
pruebas de `filter-component*`. Ninguna wallet combina `leerDeUrl` con «Aplicar», así que la rama nueva no
está en uso, pero el test «463 R22» no cubre ese camino. Añadir un caso R22 con precarga por URL y debounce.

### m5 — menor — La ayuda del asistente describe el comportamiento viejo

`docs/ayuda/oficina/wallet-tiendas.md` («La primera fila es el saldo inicial», «Desde y Hasta»),
`wallet-mensajeros.md` («El extracto va del más antiguo al más reciente, con el saldo inicial como primera
fila», «Desde/Hasta»), `mi-wallet.md` y `wallet-caja.md` (la tarjeta «Movimiento neto del periodo» con
«Tenés filtros puestos»: ahora solo la mueven periodo y «A quién») quedan desfasadas. No lo exige el spec,
pero el asistente responderá con lo de antes. Ficha o tarea del leader.

### m6 — menor — Desvíos del design no anotados en él (decisiones técnicas de `impl_463.md`, juzgadas)

- Categoría (caja) y cierre (estado de cuenta) a la vista y no tras el selector «Filtros». **Aceptable**:
  R5/R7 solo exigen que estén en la zona del libro, y lo están.
- `WalletFiltros.tsx` se conserva como módulo de traducción sin JSX (design/T7 decían retirarlo).
  **Aceptable** por las referencias de la ayuda y su test; el nombre `PascalCase.tsx` sin componente choca
  con `docs/conventions.md` (kebab-case para lo que no es componente).
- «El orden por defecto no viaja». **Aceptable**: el borde pone `desc` (probado en SCH/ACT) y la clave SWR
  lleva el orden explícito (R41).
- Periodo con el calendario de `FilterComponent`; R18 solo por unitario. **Aceptable**: con el calendario un
  rango invertido no se puede elegir; la guarda existe y está probada (siembra invertida en
  `filter-component-aplicar-463`). Por eso el test viejo del aviso en `EstadoCuenta.test` pasó a uno de R17.

Conviene anotar los cuatro en `design.md` al cerrar.

### Observación (no es de la 463)

`tests/integration/wallet-page.test.tsx` falla AISLADO (timeout de 20 s en el primer `import()` en frío del
page; el segundo caso hereda la llamada tardía), en las tres corridas, con y sin mutación; en el gate
completo pasa (13/13). `WalletModule` está stubbed en ese archivo: no lo causa esta ficha.

## Juicio de los tests reescritos

- `WalletLibroCaja458E` «R54»: pasar resumen/desglose de `toHaveBeenCalledWith(esperado)` a
  `not.toHaveBeenCalled()`, y la ganancia que NO cambia, ES el contrato nuevo aprobado (pregunta abierta 1).
  Pasar el libro de `LastCalledWith` a `CalledWith` se debe a la lectura extra del conteo de la tarjeta
  (decisión 5) y no oculta nada: M1 lo pone rojo.
- `WalletFiltroAQuien458E`: opciones de «A quién» con el periodo aplicado y sin `tipo` (afirmado con un bucle
  sobre TODAS las llamadas); «Limpiar» → «Limpiar todo» del libro, que no toca «A quién» (R30). Correcto.
- `EstadoCuenta.test`, `EstadoCuentaAnulados`, `EstadoCuentaSatelite`, `mi-wallet-page`,
  `estado-cuenta-descarga-columnas`, `WalletDescarga`: cambian los índices porque el saldo inicial pasa al
  final en «Más recientes» (R39/R43); las aserciones de contenido se conservan. M3a/M3b los ponen rojos.
- Integraciones de la 458 con `CRONOLOGICO` explícito: siguen midiendo lo mismo (y son las que matan M2).
- `wallet-listados-descarga-action`: deja de tratar `busqueda` como clave colada SOLO para saldos de tiendas
  (R45 la declara); las plantillas la siguen rechazando. Correcto.
- Guardias (`wallet-conceptos-sin-seed`, `wallet-textos-458`, `wallet-sin-uuid`): cambio de ruta al archivo
  nuevo, sin relajar el patrón.

## `FilterComponent`: el modo «Aplicar» es opt-in

`aplicarConBoton` solo lo pasan `WalletFiltrosCaja.tsx` y `EstadoCuenta.tsx`; los otros 8 consumidores
(`OrdenesListado`, `SateliteOrdenesListado`, `NovedadesFiltrosBarra`, `HistoricoFiltrosBar`,
`HistorialAccionesFiltrosBar`, `UsuariosModule`, `FiltrosCierresBarra`, `FiltrosEntregas`) no se tocaron, ni
sus tests ni los 4 `filter-component*.test.tsx` previos. Sin la prop, `emitir` y la precarga siguen el camino
de antes (las ramas nuevas se guardan con `modoAplicar`). Ver m4 para el hueco de red.

## Trazabilidad R1–R49 (comprobada contra los archivos)

R1–R11, R13–R48: cada uno tiene al menos un test que lo afirma (mapa de `impl_463.md`, verificado por nombre
en los archivos y, para dinero/orden/búsqueda, con mutación). Excepciones:

| R | Estado |
| --- | --- |
| R12 | Parcial: resumen y desglose sí (CJ R12, M1 muerta); **detalle de fila sin test (B2)** |
| R18 | Solo unitario de `FilterComponent` (aceptado, m6) |
| R49 | Caja sí (CJ R49 ×2); **estados de cuenta: no se cumple y el test mapeado no lo mide (B1)** |

## Para volver a revisión

1. B1: R49 en `EstadoCuenta.tsx` + test (o enmienda del spec por el humano).
2. B2: test del detalle de fila sin filtros del libro, que mate M1b.
3. Opcional en la misma vuelta: m1–m4.
