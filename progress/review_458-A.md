# Revisión 458-A «Detalles y guardias» (reviewer, 2026-09-26)

Rama `origin/feature/458-A`, HEAD `cd91bcf4` (merge-base con `origin/dev` = `752e40df`, un commit
por detrás de `origin/dev` `27c6dce7`, que solo toca docs/ficha). Diff revisado: el de la rama contra
`origin/dev` por tres puntos (55 archivos de código, 3 de ayuda, 51 tests tocados o nuevos).

**Herramientas.** El MCP `codebase-memory` NO está en el conjunto de herramientas de este agente:
búsqueda con grep y lectura de los archivos reales. **Base propia: NO se pudo crear.** El clasificador
del modo auto denegó leer/reapuntar el `.env` («Credential Exploration») y no hay `psql` en la máquina;
no se tocó la base compartida. Por eso `tests/integration/db/**` NO lo corrí yo: me apoyo en
`progress/gate_458A.log` (`INIT_EXIT=0`, 0 saltados en integration/db, los tres archivos nuevos en
verde) y en la lectura de esos tests. Lo que SÍ corrí, con instalación de dependencias y cliente Prisma
propios en el worktree:

- typecheck → 0 · lint → 0.
- Vitest sobre los 51 tests tocados + `tests/unit/{actions,asistente,components,guards,services,types}`
  enteros: **762 archivos, 12.763 tests en verde, 2 rojos ajenos** (`impresion-flujo.guardia` y
  `factura-contraste.guardia`, timeout de 25 s bajo carga); aislados: 2/2 archivos, 108/108 verdes.

## Veredicto: **RECHAZADA**

Un bloqueante: **R33 no se cumple y la rama reintroduce el síntoma P5 en el historial del cobro**, con la
guardia de R33 en verde porque su censo no mira esos repositorios. El resto (WHERE con la cuenta,
roles, bordes `.uuid()`/`.strict()`, guardias de uuid y de códigos crudos, ayuda, dinero intacto) está
bien y verificado; los menores no bloquean.

## Checklist

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Trazabilidad R→test (R1–R15, R16 selectores, R33, R36, R62, R84, R90, R93–R97, R99, R101 parte, R102–R104) | OK salvo R33: el test existe pero no cubre el requisito (ver B1) |
| 2 | Tasks de 458-A marcadas `[x]` en `tasks.md` | **NO**: TA.0–TA.9 siguen `[ ]` (m1) |
| 3 | `progress/impl_458-A.md` con mapa R→test y tests reescritos | OK (§3, §5, §11, §12) |
| 4 | typecheck / lint | OK (corridos por mí) |
| 5 | Tests | OK los no-DB (corridos por mí); integration/db según el log del implementer (no reproducible aquí) |
| 6 | Tablas nuevas / RLS / migraciones | N/A: ni migraciones ni `schema.prisma` |
| 7 | Secretos | OK: 0 URLs con credencial en los logs y el `recorrido.json` commiteados |
| 8 | Webhooks / API pública | N/A: `app/api/**` no usa ningún schema de la wallet; el asistente tampoco |
| 9 | Capas | Menor: 3 servicios importan de `app/(app)/**/_components` (m2) |
| 10 | Permisos por rol | OK (ver «Verificado») |
| 11 | WHERE con la cuenta en cierres y conceptos | OK (ver «Verificado») |
| 12 | Dinero sin tocar | OK en importes; solo cambian textos (ver «Verificado») |
| 13 | Entrada en `progress/history.md` | **NO** (m1) |
| 14 | Recorrido por rol y asistente | OK (`progress/recorrido_458-A/`); R62 no visible porque la región está comentada, está anotado |

## Hallazgos

### B1 — BLOQUEANTE · R33: la misma tienda vuelve a leerse «Tania Tienda» y «Tania» en el historial de la wallet

- **Qué pasa.** La rama cambió el historial del REGISTRO del cobro a `etiquetaDeCuenta`
  (`lib/repositories/WalletTiendaMovimientoRepository.ts:361-372`), pero el historial de la ANULACIÓN
  del mismo cobro sigue con el nombre a secas: `lib/repositories/CobroTiendaAnulacionRepository.ts:50-62`
  (`select: { tienda: { select: { nombre: true } } }` → `tiendaNombre: cobro?.tienda.nombre`). Su propio
  comentario dice «La MISMA etiqueta que la fila del registro del cobro (381)».
- **Escenario.** Ordenex le cobra a Tania (`nombre` «Tania», `primerApellido` «Tienda») y luego anula
  el cobro. Historial: «cobro registrado · Tania Tienda» y «cobro anulado · Tania». Antes de esta rama las
  dos decían «Tania». La rama CREA la divergencia que R33 («que la misma cuenta no se lea "Tania" en una
  superficie y "Tania Tienda" en otra») y P5 querían eliminar, y lo hace en el historial, que R33 nombra.
- **Y quedan más compositores en la wallet.** TA.1 dice «sustituye a `etiquetaDePersona` donde la wallet
  la usa». Siguen con `etiquetaDePersona` (nombre + primer apellido): `lib/repositories/LiquidacionPagoRepository.ts:59`
  (documento del pago a tienda/mensajero, `beneficiarioNombre`) y `:423` (historial de la anulación), y
  `lib/repositories/LiquidacionRepartoRepository.ts:101` y `:147` (historial del reparto). Un mensajero
  aprobado por postulación TIENE segundo apellido: se lee «Juan Pérez» en el historial de su pago y
  «Juan Pérez Mora» en la tabla, el origen y el selector de cierres de la wallet.
- **Por qué la suite no lo ve.** `tests/unit/guards/wallet-etiqueta-cuenta.guardia.test.ts:40-41`
  descubre los repos por un prefijo que deja fuera `CobroTienda*`, `CobroTiendaAnulacion*`,
  `LiquidacionPago*` y `LiquidacionReparto*`. La guardia está verde con el requisito roto.
- **Qué falta.** `etiquetaDeCuenta` (con `CUENTA_USUARIO_SELECT`) en esos tres repositorios; ampliar el
  censo de la guardia a todo repositorio que escriba `entidadEtiqueta`/`tiendaNombre`/`beneficiarioNombre`
  de la wallet (o por lista con control de no-vacuidad), con contraprueba sobre la fuente de hoy de
  `CobroTiendaAnulacionRepository`; y un test contra Postgres que fije que registro y anulación del mismo
  cobro llevan la MISMA `entidadEtiqueta` (un literal escrito a mano, no `etiquetaDeCuenta(...)`).
  De paso, corregir los comentarios desfasados: `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts:48`
  y `:294`, y `lib/utils/descripcion-cobro-tienda.ts:10` (siguen diciendo «nombre + primer apellido,
  `etiquetaDePersona`»).
- **Nota sobre lo persistido.** `nombreDeTienda` escribe la línea de caja del cobro
  (`CobroTiendaService.ts:185-189`), y los nombres de abono y pago por cuenta van a las líneas de caja y a
  sus contra-asientos. Con `etiquetaDeCuenta` una tienda CON segundo apellido se escribiría distinto de lo
  que rellenó la migración de la 461 (nombre + primer apellido). En el código, `segundoApellido` solo se
  llena al aprobar una postulación de mensajero, así que para tiendas el efecto real debería ser nulo.
  **No lo medí** (sin base): conviene contar las tiendas (`adminTienda`) con `segundo_apellido` no nulo en
  producción, en solo lectura, antes de desplegar.

### Menores

- **m1 · procedimiento.** `specs/458-rediseno-wallet/tasks.md:40-90`: TA.0–TA.9 siguen `[ ]`, y no hay
  entrada de 458-A en `progress/history.md` (CHECKPOINTS «Especificación» y «Verificación final»). Hay
  que cerrarlo antes de dar la hija por hecha.
- **m2 · capas.** `lib/services/OrigenLegibleService.ts:1-10`, `lib/services/FiltrosWalletService.ts:1`
  y `lib/services/WalletEgresoService.ts:22` importan de `app/(app)/**/_components`. En `origin/dev`
  ningún archivo de `lib/services` ni `lib/repositories` lo hacía (el único `lib → app` es
  `lib/types/plantilla-datos.ts`). Hoy los módulos importados son puros y funciona, pero invierte la
  dirección de capas de `docs/architecture.md`. Mover los diccionarios (o `horaCostaRica`) a `lib/`, o
  dejarlo anotado como decisión.
- **m3 · comentario falso.** `lib/services/WalletTiendaService.ts:313-318` sigue diciendo que
  `listarMovimientosDeTiendaSchema` «NO es `.strict()`» y que descarta claves en silencio. Desde TA.6 es
  estricto por herencia (`lib/types/wallet-tienda.ts:190-201`, `.extend` en `:282`).
- **m4 · escala del buscador de cierres.** `lib/repositories/FiltrosWalletRepository.ts:28-47`:
  `idsQueCasan` hace un `findMany` SIN tope sobre `cierre_dia` y mete todos los ids en un `IN`.
  Escenario: buscar «a» casa casi todos los mensajeros, es decir, todos los cierres de la historia. Hoy es
  poco (producción se vació el 2026-08-25), pero con decenas de mensajeros al día pasa el límite de
  parámetros de Postgres (32.767) en unos años y el selector entra en «error». Resolver el nombre o el día
  en la misma consulta, o acotar.
- **m5 · consulta muerta.** `app/(app)/analitica/_components/financiero/cargar.ts:122-132`: con
  `periodoFiltrado: true`, `rotuloCifraPrincipal` devuelve siempre «Movimiento neto del periodo» sin mirar
  `estado` (`wallet-labels.ts:192-195`), y aun así `verResumenCajaAction({})` se sigue llamando en cada
  carga. R62 está bien; sobra la lectura.
- **m6 · aserción contra su propia fuente.** `tests/integration/db/wallet-cierres-selector.test.ts:132`
  (`mensajero: etiquetaDeCuenta(r.e.ana)`) y `tests/integration/db/wallet-origen-legible.test.ts:95`
  (`mensajeroNombre: etiquetaDeCuenta(mensajero)`). El riesgo es bajo porque
  `tests/unit/utils/etiqueta-cuenta.test.ts` fija literales, pero el contrato visible es «Anacleta
  Zúñiga458» y debería estar escrito a mano.
- **m7 · cobertura contra Postgres del origen.** `tests/integration/db/wallet-origen-legible.test.ts`
  prueba 2 de los 8 lectores del repositorio (cierre y gestión). `pagos`, `podios`, `pagosPorCuenta`,
  `abonos`, `movimientosTienda` e `incidentes` solo se prueban con un doble. El `WHERE` es por `id IN` de
  filas que el actor ya ve, así que no es una fuga, pero una relación mal elegida (p. ej. un
  `pago_mensajero` de un reparto cuyo `origen_id` no sea un `liquidacion_pago`) caería al rótulo solo sin
  que nadie lo notara. Tampoco existe el `wallet-origen-enlace.test.tsx` que nombra TA.2; lo cubren
  `OrigenMovimiento.test.tsx` y el bloque R7/R8 del test de servicio (aceptable, pero hay que anotarlo).
- **m8 · ayuda.** `docs/ayuda/oficina/wallet-mensajeros.md` («Podés buscar por día (2026-09-12) o por
  nombre»): en el desglose de UN mensajero todos los cierres son suyos, así que buscar por nombre no acota
  nada. Basta con «por día».
- **m9 · semántica.** `lib/repositories/SaldosSatelitesRepository.ts:80`: `conciliadoPorNombre` es la
  PERSONA que concilió, no una cuenta. `etiquetaDeCuenta` da lo mismo que `nombreCompletoUsuario`, pero
  el nombre de la función engaña.

## Verificado (lo que pidió el leader)

- **WHERE con la cuenta.** `FiltrosWalletRepository.ts:77` (`tiendaId` en el conteo de la tienda),
  `:96` y `:118` (cierres de tienda y de mensajero): la cuenta la escribe el método y la búsqueda solo
  ACOTA ids dentro de ella. `mi_tienda` usa `actor.usuarioId` (`FiltrosWalletService.ts:86-98`), la misma
  convención que `/mi-wallet` (`lib/actions/wallet-tienda.ts:436`), y su schema no admite `tiendaId`.
  Contra Postgres: un cierre ajeno da 0 filas en tienda y en mensajero, los conceptos de otra tienda no se
  cuelan, y `mi_tienda` con `tiendaId` da `validation_error` (`wallet-cierres-selector.test.ts:166-203`,
  `wallet-conceptos-con-movimientos.test.ts:77-150`). El implementer anotó 5 mutaciones de WHERE en rojo.
- **Roles.** `cierresDeLaCuenta` solo acceso total; `conceptos` `caja`/`tienda` solo acceso total y
  `mi_tienda` solo `adminTienda`. `forbidden` sale sin tocar el repo (`filtros-wallet-service.test.ts:54-66`
  y `:100-108`). En el origen legible, la tienda no ve el mensajero del cierre ni enlaza a
  `/cierres-admin`, pero sí a SU orden (`OrigenLegibleService.ts:62-71`, tests R7/R8).
- **`.uuid()` / `.strict()`.** zod es `^4.4.3`, cuyo `.uuid()` exige RFC (versión y variante). Los ids de
  `cierre_dia` son `@default(uuid())` (v4) y ninguna migración inserta cierres con id propio: ningún id
  real queda fuera. Llamadores: `MiWalletModule.buildInput`/`buildInputCompleto` mandan solo claves del
  schema, `/mi-wallet/page.tsx` manda `{}`, y los dos desgloses mandan el `cierreId` elegido en el
  selector. Ni `app/api/**` (API pública) ni `lib/asistente` usan estos schemas.
- **Guardias de uuid y de códigos crudos.** `wallet-sin-uuid.guardia.test.tsx` renderiza 7 superficies y
  mira texto, `aria-label`, `placeholder`, `title`, `value` y `describedby` resuelto. Tiene contraprueba
  del `EnlaceCierre` de antes y control de no-vacuidad (hay ids en `href`). Los códigos crudos del origen
  los cierra `wallet-origen-total.guardia.test.ts`: diccionarios `Record<WalletOrigenTipo>` totales, sin
  `?? origenTipo`, claves = catálogo en ejecución y composition root contado (9 bordes). En los conceptos,
  `opcionesDeConceptos` no pinta ninguno sin rótulo.
- **«Tania» → «Tania Tienda» y los consumidores.** Ningún webhook ni notificación lee estos nombres (los
  webhooks son de órdenes, y los servicios que notifican no usan estos repos). Cambian las descargas
  (saldos de tiendas, columna Origen), que solo leen personas. Lo persistido está en B1.
- **Tests reescritos.** Las reescrituras de `wallet-labels`, `desglose-tienda-labels`, `mi-wallet-labels`
  y `WalletDescarga` conservan sus literales escritos a mano (`CONCEPTOS_ESPERADOS`, `DESDE_ORDENEX`,
  `LECTURA_DESDE_LA_TIENDA`), ahora con «(n)»: son contrato, no polizón. `contexto-457/461` pasan de «el
  2026-09-25» a «≥ 2026-09-25», que es razonable porque R102 obliga a mover la fecha. R62 fija el literal
  «Movimiento neto del periodo».
- **Dinero.** Ningún cambio en importes, sumas, signos ni en qué fila se escribe. Solo cambian dos textos:
  la descripción del reverso de un egreso sin descripción (`WalletEgresoService.ts:134-135`, R4; antes caía
  al uuid) y el nombre de tienda que componen las líneas de caja (B1, nota). `caja-caracterizacion-459`
  está 18/18 en verde en el gate del implementer.
- **Ayuda.** Los tres documentos traen `actualizado` y `fuentes` y describen lo que hace la pantalla
  (selector sin pegar nada, conceptos con «(n)» y «(0)», origen con «Ver»). Correcto salvo m8.

## Para cerrar

1. B1: los tres repositorios, la guardia ampliada con contraprueba, el test contra Postgres de igualdad
   entre registro y anulación, y los comentarios desfasados.
2. m1: marcar TA.0–TA.9 y añadir la entrada en `progress/history.md`.
3. Gate completo con base propia (`INIT_EXIT=0`, 0 saltados en integration/db) y nueva revisión.
