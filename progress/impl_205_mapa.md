# Feature 205 — Mapa consolidado `R<n> → test` (T7.1)

Rama `feature/205-pago-mensajero-desde-wallet`. Contrato:
`specs/205-pago-mensajero-desde-wallet/{requirements,design,tasks}.md` — **58 requisitos**.

Este archivo cierra **T7.1**. Existe porque la evidencia estaba repartida en cuatro bitácoras
(`impl_205_tanda0.md`, `impl_205_tandas1y2.md` +addendum, `impl_205_tandas3y4.md` +ENMIENDA,
`impl_205_tandas5y6.md`) y la unión de las cuatro **no nombraba R10, R11, R12, R13 ni R17**: la
tanda 0 no dejó tabla de mapa. Sus tests existían —el reviewer los abrió y los ejecutó uno a uno—;
lo que faltaba era el mapa que `CLAUDE.md > regla 4` y `docs/specs.md > Trazabilidad` exigen.

> **Nombre del archivo.** `tasks.md > T7.1` pedía `progress/impl_205-pago-mensajero-desde-wallet.md`.
> Se llama `impl_205_mapa.md` porque las bitácoras de esta feature se partieron por tandas y el
> consolidado tenía que distinguirse de las cuatro. Queda anotado en la propia tarea.

## Quién midió qué (para que nadie lea esto como una medición mía)

Lo escribe el **spec_author** el 2026-08-12 y **no re-ejecuta la suite**: no toca código ni tests,
y correr el gate en paralelo con una mutación del árbol da un veredicto que no vale. Cada fila
nombra archivo y caso, y **los nombres de los casos están copiados de los archivos de test leídos
hoy**, no de las bitácoras (que en dos sitios los parafraseaban). Las corridas que se citan abajo
son, con su fuente:

| Quién | Qué corrió | Resultado |
| --- | --- | --- |
| implementer, tanda 0 | los 2 archivos de la tanda | `Test Files 2 passed (2) · Tests 45 passed (45)` |
| implementer, tandas 1-2 | los 5 archivos de las tandas | `Test Files 5 passed (5) · Tests 104 passed (104)` |
| implementer, tandas 3-4 | los 5 archivos nuevos/editados | `Test Files 5 passed (5) · Tests 158 passed (158)` |
| implementer, enmienda R36 | los 3 archivos de la enmienda | `Test Files 3 passed (3) · Tests 130 passed (130)` |
| implementer, tandas 5-6 | los 4 archivos nuevos | `Test Files 4 passed (4) · Tests 44 passed (44)` |
| implementer, tandas 1-2 | `tests/integration/db` con la migración **aplicada y sin aplicar** | `100 passed (100) · 1268 passed (1268)` · **0 skipped** en los dos estados |
| **reviewer** (`progress/review_205.md`) | **`./init.sh` completo en esta rama** | **`init OK`** · `Test Files 1066 passed · Tests 13346 passed (13346)` · lint `0 errors, 58 warnings` |
| **reviewer** | los 13 archivos de la 205 | `13 passed · 254 passed (254)` |
| **reviewer** | migración + módulo puro + config | `3 passed · 69 passed (69)`, **0 skipped** (el bloque contra Postgres real SÍ corrió) |

**Mutaciones plantadas y muertas:** 9 (tanda 0) + 22 (tandas 1-2) + 32 (tandas 3-4) + 8 (enmienda
R36) + 13 (tandas 5-6) = **84 del implementer**, más **11 independientes del reviewer**. Sobreviven
dos, y las dos están declaradas: `f3` (mutante **equivalente** demostrado, `impl_205_tandas3y4.md`)
y `M4` del reviewer (coincidencia del fixture — hallazgo menor **m3**, **ya cerrado**: ver R58).

**El gate hay que volver a correrlo** después de este plegado del spec: `T7.2` sigue sin marcar en
`tasks.md` a propósito.

---

## El mapa de los 58

Abreviaturas de archivo usadas en la columna «Test»:

- `utils` = `tests/unit/utils/reparto-liquidacion-mensajero.test.ts`
- `config` = `tests/unit/config/reparto-mensajero-config.test.ts`
- `svc` = `tests/unit/services/liquidacion-reparto-service.test.ts`
- `guard` = `tests/unit/guards/liquidacion-reparto-bloqueos.guardia.test.ts`
- `money` = `tests/unit/guards/liquidacion-money-safe.test.ts`
- `pagoRepo` = `tests/unit/repositories/liquidacion-pago-repository.test.ts`
- `repartoRepo` = `tests/unit/repositories/liquidacion-reparto-repository.test.ts`
- `derivado` = `tests/unit/repositories/desglose-mensajero-cierre-derivado.test.ts`
- `mig` = `tests/integration/db/liquidacion-reparto-migration.test.ts`
- `schema` = `tests/unit/types/liquidacion-reparto-schema.test.ts`
- `acciones` = `tests/unit/actions/liquidacion-reparto-actions.test.ts`
- `accionesLiq` = `tests/unit/actions/liquidacion-action.test.ts`
- `prev` = `tests/components/RepartoPrevisualizacion.test.tsx`
- `pago` = `tests/components/PagoMensajeroAcciones.test.tsx`
- `desglose` = `tests/components/DesglosePagosMensajero.test.tsx`
- `deep` = `tests/components/CierresAdminDeepLink.test.tsx`

| R | Test | Caso concreto |
| --- | --- | --- |
| R1 | `svc` | describe «R1/R4 — el permiso se comprueba ANTES de tocar o leer un solo dato»: «R1: `<rol>` no puede REGISTRAR un reparto y no se lee nada» y «R1: `<rol>` tampoco puede PREVISUALIZAR», los dos para 4 roles, con **el log vacío como aserción**; control «maestro y admin SÍ pueden»; y «R1: un `mensajeroId` cualquiera en la petición no amplía el alcance de un rol sin acceso» |
| R2 | `acciones` | «previsualizar sin sesion → `unauthenticated`, sin tocar el servicio», «registrar sin sesion → …», y **el que fija el ORDEN**: «R2 (el ORDEN): sin sesion Y con una peticion invalida, gana `unauthenticated`»; control «con sesion, la accion SI llama al servicio» |
| R3 | `desglose` + `pago` | «el desglose monta el bloque de pago, con lo que dice el servidor que se puede pagar» + «ofrece registrar el pago con lo que el servidor dice que se puede pagar» |
| R4 | `svc` | mismo describe que R1: el predicado es el de acceso total y se aplica **antes de la primera lectura** en los dos métodos (log vacío), con el control positivo maestro/admin |
| R5 | `pagoRepo` + `svc` | «R5/R24 — EL WHERE: filtra por mensajero Y por estado `aprobado`, los dos» (probado donde vive el `where`) + «R5/R6: un cierre ya saldado no recibe nada Y NO OCUPA PLAZA en la ventana» |
| R6 | `svc` + `pagoRepo` | «R6/R7: el pendiente sale de la Σ de pagos VIGENTES, y se vuelve a derivar en cada lectura» + «lee SEIS columnas del cierre y emite los montos como STRING de escala 2» (no hay saldo almacenado que leer) |
| R7 | `svc` + `pagoRepo` | «R6/R7: …Σ de pagos VIGENTES…» + (172, intacto) «sumarVigentesPorCierre agrupa con el mismo filtro y en UNA sola consulta» — el filtro es la **ausencia** de fila de anulación |
| R8 | `utils` + `pagoRepo` | describe «ordenarCierresFifo (R8)»: «ordena del dia trabajado MAS ANTIGUO al mas reciente», «dos cierres con el MISMO instante desempatan por id ascendente, siempre igual», «el orden es REPETIBLE… y no muta el array recibido», «compara INSTANTES, no texto» (×2, incluido el offset horario) y «Q1: ignora cualquier OTRA fecha del cierre» + «R8 — EL ORDEN: `solicitadoAt` asc con desempate por `id` asc, y NUNCA por `resueltoAt`» |
| R9 | `schema` + `acciones` + `pago` | «`cierreId` no existe en el schema del REGISTRO, y `.strict()` lo nombra al rechazarlo», «… tampoco … en la PREVISUALIZACION», «ESTRUCTURAL: el modulo no declara `cierreId` en ningun schema de ENTRADA» + «R9: un `cierreId` colado en el REGISTRO muere en el borde» (y el servicio no se entera) + «la petición lleva el mensajero y NUNCA un cierre: contra cuáles se imputa lo decide el servidor» |
| R10 | `utils` | describe «repartirEntreCierres — troceo FIFO (R10, R11, R13)»: «importe menor que el primer pendiente: UNA sola imputacion, parcial», «importe que cruza tres cierres: dos completas y SOLO la ultima parcial», «importe que AGOTA exacto un cierre: ninguna imputacion es parcial» — cada imputación es `min(restante, pendiente)` |
| R11 | `utils` | «R11: en ningun reparto hay mas de UNA imputacion parcial, y es la ULTIMA» (**propiedad** medida sobre 7 importes) + «importe que cruza tres cierres: dos completas y SOLO la ultima parcial (R11)» |
| R12 | `utils` | describe «repartirEntreCierres — nada de ceros (R12)»: «un cierre con pendiente 0.00 NO aparece y NO ocupa plaza de la ventana», «un pendiente negativo (dato historico raro) se descarta igual que el cero», «sin ningun cierre imputable no hay imputaciones…», «importe 0: ninguna imputacion, ni siquiera de 0.00» |
| R13 | `utils` | describe «repartirEntreCierres — money-safe al centimo (R13, R16)»: «Σ montos es EXACTAMENTE el importe: ni se crea ni se pierde un centimo», «un centimo suelto se imputa al cierre MAS ANTIGUO y no se pierde», «decimales que rompen un float: los tercios de 8000.01 cuadran al centimo», «importes grandes (DECIMAL(12,2) casi lleno) no pierden precision» |
| R14 | `svc` + `utils` | «R14: un importe por encima del imputable se rechaza informando del disponible», «R14: la frontera exacta (importe == imputable) SÍ se acepta», «R14/R54: por encima de la VENTANA se responde `excede` con el disponible de la ventana» (cero escrituras) + «R14: importe MAYOR que el imputable ⇒ sobrante > 0 y totalImputado = imputable» |
| R15 | `svc` + `pago` | «R15: sin cierres imputables se responde `sin_saldo` y no se escribe nada», «R15: cierres aprobados pero TODOS saldados también son `sin_saldo` (no `excede` con 0.00)» + «sin nada imputable el control queda deshabilitado y se explica por qué» |
| R16 | `utils` + `money` + `schema` + `prev` + `pago` | «R16: ni una conversion de monto a numero — solo `toFixed(2)` de serializacion» + «ningún archivo de la feature convierte un monto a número», «en el servidor, todo `toFixed` de la feature es de escala 2», «ningún archivo de CLIENTE de la feature trae una biblioteca de decimales» + «R16: el modulo de contratos no convierte ningun monto a numero» + «el componente no convierte ningún importe a número» + «el cableado no convierte ningún importe a número» |
| R17 | `utils` | describe «el modulo del reparto es PURO (R17, R53)»: «no lee el entorno: el tope entra por parametro», «no lee el reloj: ningun `new Date(...)` en todo el modulo», «no conoce Next, ni repositorios, ni servicios, ni el cliente de Prisma», «el archivo de test no importa Prisma: entra STRING, sale STRING» — los 38 casos del archivo corren **sin base de datos** |
| R18 | `svc` | «R18: cada imputación escribe UN pago atado a SU cierre, del más antiguo al más nuevo» (3 imputaciones ⇒ 3 documentos con su `cierreId`) |
| R19 | `svc` | «R19: cada pago escribe SU movimiento en el libro, enlazado por `origen_id` al documento» |
| R20 | `svc` | «R20: si la TERCERA imputación revienta, no queda ni un pago, ni un movimiento, ni el reparto», «R20: si revienta la PRIMERA, tampoco queda el reparto (la fila del acto va dentro)», «R20: si una imputación CHOCA con una clave ya usada, se revierte todo (no se salta)», «R20 (control): sin fallo, esas mismas filas SÍ se confirman» — el doble de transacción **modela el rollback**: lo escrito solo pasa a `confirmados` si la función no lanza |
| R21 | `guard` | «R21: se toma el candado del CIERRE para cada cierre que se toca, y de ningún otro grano» + «R21/R23: los candados se toman ANTES de la lectura que DECIDE y antes de toda escritura» |
| R22 | `guard` | «R22: el orden de adquisición es el FIFO del reparto, aunque la lectura llegue desordenada», «R22: el orden de los candados coincide FILA A FILA con el de las imputaciones», «R22: dos ejecuciones sobre los mismos datos adquieren en el MISMO orden», y los estructurales «los candados se piden EN SERIE, nunca en paralelo» y «el orden lo fija `ordenarCierresFifo`, no un comparador propio del servicio» |
| R23 | `svc` + `pagoRepo` | «R23: si el pendiente cambió entre la primera lectura y el bloqueo, se aplica el RECALCULADO», «R23: las DOS lecturas del reparto ocurren DENTRO de la transacción» + «R23: con `tx` la relectura ocurre EN LA TRANSACCION, no en el cliente propio» |
| R24 | `svc` + `pagoRepo` | «R24: un cierre que dejó de estar `aprobado` bajo bloqueo NO recibe nada», «R24: un cierre de OTRO mensajero no recibe nada aunque la lectura lo devuelva» + «R5/R24 — EL WHERE: filtra por mensajero Y por estado `aprobado`, los dos» |
| R25 | `svc` + `pago` | «R25: el resultado devuelve el reparto APLICADO, con lo que queda por imputar» + «pinta el reparto que devolvió la escritura, aunque difiera de lo que se vio» (fixture donde aplicado ≠ previsualizado **a propósito**) |
| R26 | `guard` + `svc` + `pagoRepo` | «ninguna escritura llega al delegado de `cierreDia` durante un reparto», «ESTRUCTURAL: el servicio no nombra ninguna escritura sobre `cierreDia`» + «R26: no se escribe NADA en el cierre: sus datos son de solo lectura» + «R26: listarlos no ESCRIBE nada en el cierre» y «R26: contarlos tampoco ESCRIBE nada en el cierre» |
| R27 | `pago` + `acciones` | «el reintento tras un fallo viaja con la MISMA clave» (la clave se acuña al **abrir**) + «la clave de idempotencia tiene que ser un uuid: la acuña el CLIENTE al abrir (R27)» y «la clave del cliente llega INTACTA al servicio: el borde no la regenera» |
| R28 | `svc` + `repartoRepo` + `pagoRepo` + `mig` + `pago` | «R28: la segunda petición con la MISMA clave no escribe nada y devuelve el reparto original», «R28: la reconstrucción NO depende de que el FIFO vuelva a dar el mismo resultado» (mata la alternativa §5.2), «R28: una clave reusada apuntando a OTRO mensajero no devuelve el reparto ajeno», «R28: choque de clave sin fila que lo explique ⇒ `no_encontrado`» + describe «LiquidacionRepartoRepository.obtenerPorClave (R28)» + describe «listarPorReparto (205 / R28)» («acota por `reparto_id` — es lo que reconstruye el resultado original en vez de inferirlo») + «R28: `reparto_id` apunta a `liquidacion_reparto(id)` con RESTRICT, y admite NULL» (Postgres real) + «la respuesta idempotente enseña el reparto ORIGINAL y lo dice sin alarmar» |
| R29 | `mig` + `repartoRepo` + `svc` + `guard` | «R29: la MISMA clave dos veces la rechaza la BASE, y una clave distinta SI entra» (**en el motor**, con su control) y «R29: la clave de idempotencia es UNICA — la barrera es de DATOS, no un SELECT previo» + describe «LiquidacionRepartoRepository.crear (R29)» (P2002 ⇒ `clave_repetida` sin lanzar, también con `meta.target` vacío) + «R29: la barrera es DE DATOS: no hay lectura previa que decida si escribir» + «`buildService` le da al servicio el repositorio del ACTO, construido sobre prisma» |
| R30 | `svc` + `pago` | «R30: abrir el formulario otra vez (clave NUEVA) registra un pago distinto con los mismos datos» + «abrir el formulario DE NUEVO tras registrar acuña una clave nueva: es otro pago (R30)» |
| R31 | `pago` | «el reintento tras un fallo viaja con la MISMA clave» y «un rechazo del servidor tampoco renueva la clave» — las dos familias de fallo, red y dominio |
| R32 | `prev` + `svc` | «enseña a qué cierres se aplicaría y cuánto a cada uno, TAL CUAL» + «R32: sin monto, la previsualización trae el conjunto imputable y ninguna imputación» y «R32/R33/R34: la previsualización marca la parcial y dice el resto, todo como STRING» |
| R33 | `prev` + `svc` | «marca la parcial y solo la parcial, y dice el resto de su cierre» + «R32/R33/R34…» (`parcial: true` solo en la última, con su `pendienteDespues`) |
| R34 | `prev` + `svc` | «los importes del SERVIDOR mandan: se cambia uno en la respuesta y cambia el pintado» (y el total tecleado no aparece por ningún lado) + «R32/R33/R34: … todo como STRING» |
| R35 | `svc` | «R35: previsualizar no abre transacción, no bloquea y no llama a ningún método de escritura» — medido con el log entero |
| R36 | `pagoRepo` + `svc` + `schema` + `prev` | **Enmienda `design.md §6.4`: CONTEO por estado, no lista.** `pagoRepo`: «R36 — EL WHERE: el mensajero Y el complemento EXACTO de `aprobado`», «R36 — AGREGA EN LA BASE: es un `groupBy`, y `findMany` no se llama ni una vez», «R36 — agrupa por ESTADO y por nada mas», «R36 — es el COMPLEMENTO de los imputables: ni un cierre en las dos lecturas, ni uno fuera», «R36/§7.2 — la consulta NO pide ningun monto», «devuelve `{ estado, cantidad }` por grupo: el CONTEO, sin ningun cierre nombrado», «ACOTADO POR CONSTRUCCION: nunca mas entradas que valores tiene `CierreEstado`», «orden determinista por `estado`». `svc`: «R36: los excluidos llegan CONTADOS por estado, sin importe y sin nombrar ningún cierre», «R36: la respuesta NO crece con el historial — dos años de rechazos son UNA entrada», «R36: el conteo se pide UNA vez, al mensajero de la petición, y se copia tal cual», «R36: sin cierres fuera, la lista de conteos viene VACÍA». `schema`: «R36 — ESTRUCTURAL: el aviso de excluidos es un CONTEO por estado, no una lista de cierres» (**es el test que impide revertir la decisión**). `prev`: «dice cuántos hay de cada estado, con su rótulo», «sin excluidos, el aviso NO aparece», «un historial largo sigue siendo UNA línea por estado: no se listan cierres» |
| R37 | `svc` + `prev` | «R37: la deuda que no cuelga de ningún cierre se avisa con su cifra, ya comparada», «R37: cuando todo lo que se debe cuelga de cierres, no hay aviso ni cifra negativa», «R37 (borde): un imputable MAYOR que la cuenta por pagar no produce una deuda al revés» + «con deuda no imputable lo dice, y sin ella no lo dice» |
| R38 | `svc` + `prev` | «R38: un importe por encima de la ventana se avisa ANTES de confirmar» + «avisa con el sobrante y el máximo, los dos del servidor» y «sin exceso, no hay aviso de exceso» |
| R39 | `deep` | «con `?cierre=` el detalle se abre solo, y la lectura se pide POR ID», «sin parámetro no se abre nada ni se pide ninguna lectura», «el módulo lee la clave que escribe el constructor del enlace» (ata las dos puntas del parámetro) |
| R40 | `deep` | «funciona con un cierre que NO está en la página visible» (el cierre **no está en ninguna de las dos tablas**: es lo que demuestra que la lectura es por id) y «se abre UNA vez por navegación, no una por render» |
| R41 | `deep` | «avisa y no pinta ni un dato del cierre» (id inexistente ⇒ `no_encontrada`) y «una sesión caída se dice como tal, sin dejar la pantalla rota» |
| R42 | `tests/components/CierresAdminPage.test.tsx` + `tests/unit/repositories/cierres-admin-repository.test.ts` | **Cobertura heredada, verificada por el reviewer ejecutándola:** «R1: roles sin acceso NO ven el módulo (notFound)» (`CierresAdminPage.test.tsx:223`) + «R13: cierre WHERE id + alcance; si no casa → null, sin cargar gestiones» (`cierres-admin-repository.test.ts:260-270`, con `ALCANCE_SAT` sobre un cierre ajeno). Es decir: el enlace no amplía nada — un `adminSatelite` que teclee el uuid de otra zona cae en `no_encontrada` por el `WHERE` del repositorio. `design.md §12` prometía además un caso propio en `deep`, que **no se escribió**: es el hallazgo menor **m1** del reviewer y lo trata otro encargo |
| R43 | `desglose` + `derivado` | «la fila con cierre lleva enlace a su detalle, con nombre accesible propio», «la fila SIN cierre no lleva enlace: ni roto ni deshabilitado», «todas las filas mantienen su cierre aunque cambie la página de datos» + las tres ramas de §7.3: «`cierre_dia`: el `origen_id` ES el cierre», «`pago_mensajero`: el cierre sale del DOCUMENTO, resuelto por consulta», «`manual` (y cualquier otro origen) no identifica ningun cierre: `null`», más «UNA consulta por PAGINA, no una por fila» y «la DESCARGA del desglose no gana el campo» |
| R44 | `prev` + `pago` | «un enlace por cierre, a `/cierres-admin?cierre=<id>` y con nombre propio» + «cada cierre del resultado lleva su enlace al detalle (R44)» |
| R45 | `deep` | «cerrar el detalle abierto por enlace retira el parámetro de la URL», «conserva los demás parámetros de la dirección», «el detalle abierto desde la TABLA no toca la URL al cerrarse» |
| R46 | `schema` + `acciones` | «todos los campos de dinero de los DTO son `string`; los cardinales del recorte son `number`» + «R46: un `monto` NUMERICO no se coerciona: muere con `validation_error`» (también en la previsualización) y «`ok` devuelve el reparto aplicado, con todos los importes como texto» |
| R47 | `schema` + `acciones` | describe «R47 — `.strict()`: la forma se valida entera, no por lista de nombres»: «cualquier clave desconocida cae, no solo `cierreId`» + control «una peticion valida SI pasa (si no, lo de arriba no diria nada)» + «R47: cualquier otra clave desconocida tambien muere (`.strict()`, no una lista de nombres)» |
| R48 | `schema` + `svc` + `money` | «los DTO de salida emiten `cierreId` y NINGUN identificador de persona» + «R48: la previsualización emite el NOMBRE del mensajero y ningún id de persona» + (172, intactos) «el DTO del comprobante no declara ningún identificador salvo el `id` del pago» y «la descarga del comprobante no emite NI UN uuid, ni siquiera el del pago» |
| R49 | `mig` | «R49: la migracion es ADITIVA — no destruye, no renombra, no reescribe, no crea enums», «R49: RLS habilitada (relrowsecurity = true) en la tabla nueva» (**medido en `pg_class`**, no en el DDL), «R49: el `down.sql` REAL deja el esquema EXACTAMENTE como estaba» (lista de columnas idéntica, no «parecida»), «R49: el beneficiario tiene que existir, y borrar a quien cobro o registro FALLA (RESTRICT)», «suelta la COLUMNA antes que la TABLA, y nada mas» |
| R50 | `money` | «el censo de archivos de la feature existe entero y cubre sus propios árboles» — la cláusula de **auto-captura**, vista en ROJO **tres veces** antes de ampliar el censo (ver «La contraprueba de T0.3» abajo) + «CONTRAPRUEBA: el barrido caza un `Number(monto)` colado y no caza su cita» |
| R51 | `tests/unit/services/liquidacion-service.test.ts` + `svc` + `pagoRepo` | el test de la 172 sigue verde **sin tocar un solo assert** (solo cableado) + describe «R51 — un reparto que cae entero en UN cierre escribe lo mismo que el pago simple» → «las filas del documento y del libro coinciden campo a campo» + «205/R51: y emite `null` cuando no nace de ninguno — la clave SE EMITE, no se omite» |
| R52 | `guard` + `accionesLiq` + `mig` + `repartoRepo` | «ni el servicio ni el repositorio del acto exponen un método que lo deshaga», «las Server Actions del reparto son DOS y ninguna corrige nada» + «la superficie del modulo es EXACTAMENTE la de registrar, listar y anular» (lista cerrada, **5 → 7** nombres) y «ninguna exportacion se llama editar/actualizar/modificar/corregir/desanular» + «R52: fila INMUTABLE — ni `updated_at` ni `deleted_at`, ni en el SQL ni en el modelo» + describe «LiquidacionRepartoRepository — el acto es INMUTABLE (R52)» |
| R53 | `config` + `svc` + `utils` | el defecto **50**, la sobreescritura por `REPARTO_MENSAJERO_MAX_CIERRES` y el valor basura que cae al defecto —**recargando el módulo**, no leyendo la constante ya evaluada—, más que el número no se repite en ningún otro archivo + «R53: sin tope inyectado, el servicio usa el del único punto de configuración (50)» (51 cierres ⇒ ventana de 50) + «no lee el entorno: el tope entra por parametro (R53, design §2.5.2)» |
| R54 | `utils` + `svc` | «R54: con tope 2 y 5 imputables, solo los DOS mas antiguos reciben — y NO hay rechazo», más los cinco bordes del tope (0, negativo, 1, = n, > n) + «R54: con `tope: 2` y 3 imputables se responde `ok` sobre los DOS más antiguos» |
| R55 | `guard` + `utils` | «R55: con `tope: 2` y 5 imputables: 2 candados, 2 pagos, 2 movimientos», «R55: los TRES cierres recortados no aparecen en NINGUNA llamada», «R55 (control): sin tope, esos mismos tres cierres SÍ se bloquean» + «R55: ningun cierre fuera de la ventana aparece en las imputaciones, ni con importe de sobra» |
| R56 | `svc` + `prev` + `utils` | «R56: el recorte sale del servidor con SUS TRES cifras, y es distinto del aviso de R37», «R56: sin cierres fuera de la ventana, `aplicado` es falso» + «con recorte aplicado dice cuántos entran, cuántos quedan y cuánto suman» y «con los DOS activos aparecen los DOS textos, distinguibles (R56)» + «imputable + montoFuera == imputableTotal para CADA tope (coherencia por construccion)» |
| R57 | `svc` + `utils` + `config` | «R57: previsualizar y aplicar en el MISMO servicio dan la MISMA ventana» + «no lee el entorno: el tope entra por parametro» (el módulo puro no puede tener un segundo número) + el test de que la constante no se repite en ningún otro archivo |
| R58 | `svc` + `schema` | «R58: método, referencia y fecha son IDÉNTICOS en las tres, capturados una sola vez» y «R58: esa fecha viene de la PETICIÓN y no del reloj del servidor» + «R58: la referencia es obligatoria en pago electronico y opcional en efectivo». **Cicatriz, ya cerrada:** la mutación `M4` del reviewer (la fecha sale del reloj) **sobrevivía** porque en el fixture el reloj y `fechaPago` valían lo mismo (`2026-07-30`) — hallazgo menor **m3**. Cerrado: el reloj se movió a `2026-08-02`, el caso «esa fecha viene de la PETICIÓN» reparte **dos veces con fechas distintas**, ninguna la del reloj, y `M4` **ahora muere con 4 rojos** (verificado por el reviewer en su segunda vuelta, mutación `N3`). Las otras tres mutaciones de R58 —referencia inventada por cierre, fecha que varía por imputación, fecha constante ajena— ya morían |

**58 de 58 con test nombrado.** Ninguno queda sin fila.

---

## Las dos contrapruebas que T7.1 pide por escrito

### T0.3 — el censo money-safe, visto en ROJO antes de ampliarlo (tres veces)

No se completó una lista a mano: cada archivo nuevo de `lib/**` con `liquidacion` en la ruta
**tumbó el barrido** al crearse, por la cláusula de auto-captura, y solo entonces se censó.

```
 FAIL  tests/unit/guards/liquidacion-money-safe.test.ts > … > el censo de archivos de la feature
       existe entero y cubre sus propios árboles
AssertionError: expected [ Array(1) ] to deeply equal []
+   "lib/utils/reparto-liquidacion-mensajero.ts"                       ← tanda 0, :146
+   "lib/interfaces/repositories/ILiquidacionRepartoRepository.ts"     ← tandas 1-2, :157
+   "lib/repositories/LiquidacionRepartoRepository.ts"                 ← tandas 1-2, :157
+   "lib/types/liquidacion-reparto.ts"                                 ← tandas 3-4, :164
```

Fuente verbatim: `impl_205_tanda0.md > T0.3`, `impl_205_tandas1y2.md > El censo money-safe`,
`impl_205_tandas3y4.md`. Tras censarlos, `Tests 7 passed (7)` las tres veces. Los **tres archivos
de cliente** de T5.4 (`DesglosePagosMensajero.tsx`, `PagoMensajeroAcciones.tsx`,
`RepartoPrevisualizacion.tsx`) viven en `app/**`, que ninguna cláusula auto-captura: entraron a
mano y pasan las **cuatro** aserciones.

> **Hueco conocido:** `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts` gana
> cinco bloques de rótulos que formatean dinero y **no está en el censo**. Es el hallazgo menor
> **m2** del reviewer; hoy es inocuo (`money` opera sobre STRING) y lo trata otro encargo.

### T0.5 — el barrido de la referencia repetida: compuerta ABIERTA

`R58` copia la misma `referencia` en las N filas de `liquidacion_pago`. Antes de escribir T3.2 se
barrió el repo entero buscando algo que asumiera unicidad. **Script en archivo, nunca `node -e`**
(la memoria del repo: `node -e` se come una capa de escapado y el censo miente en verde), con
autocomprobación obligatoria:

```
=== AUTOCOMPROBACIÓN DEL BARRIDO ===
  [CAZADO] (a) @unique / @@unique / CREATE UNIQUE INDEX sobre `referencia`   … 3 casos
  [CAZADO] (b) findFirst / findUnique por `referencia`                        … 2 casos
  [CAZADO] (c) groupBy / distinct / SQL de conciliación 1:1                   … 3 casos
  [OK-LIMPIO] la referencia copiada como DATO en un `create`, y declarada en un DTO
  [CAZADO] inyección en archivo REAL lib/repositories/LiquidacionPagoRepository.ts: 0 → 1
AUTOCOMPROBACIÓN OK: el barrido caza los 8 casos plantados y no marca los 2 limpios.
```

Resultado: **58 candidatos en 47 archivos, ninguno es un hallazgo** (casi todo es la palabra
española «referencia» en comentarios sobre FKs). Y la evidencia **positiva**, que es más fuerte que
la ausencia: `tests/integration/db/liquidacion-idempotencia.test.ts` ya exige hoy que dos pagos con
la **misma referencia y la misma fecha** se acepten tras una anulación (R78 de la 172). Detalle
completo y triaje fila a fila en `impl_205_tanda0.md > T0.5`.

---

## Lo que este archivo NO cierra

1. **T7.2 — el gate completo.** El último `./init.sh` verde es el del reviewer (`init OK`,
   13346/13346) y es **anterior** al plegado del spec de hoy. Hay guardias que leen `specs/`
   (`tests/unit/guards/test-citado-desaparecido.guardia.test.ts` recorre `specs/*/tasks.md` y
   `specs/*/design.md`), así que el gate se vuelve a correr antes del PR. Tarea **sin marcar**.
2. **T7.3 — bookkeeping.** `feature_list.json` id 205 ya tiene su `spec_path`. Faltan
   `progress/current.md`, la entrada de `progress/history.md` y el estado/`status_note` finales.
   Tarea **sin marcar**.
3. **Los cuatro hallazgos menores** del reviewer (m1 el caso de R42 prometido en `design.md §12`,
   m2 el censo de los rótulos, m3 el reloj del fixture, m4 la segunda prop del diálogo —ésta ya
   declarada como desviación en `tasks.md > T5.1`—) los trata otro encargo en paralelo.
