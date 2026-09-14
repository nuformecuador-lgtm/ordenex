# 425 — Salida del rechazo de tienda por el cierre · Tareas

> Requisitos: `requirements.md` · Diseño: `design.md` · Decisiones: `progress/decisiones_425.md`.
> Zona **fullstack** → se secuencia **backend primero, frontend después** (bloque B antes del F).
> El diff toca `db/schema.prisma` + una migración: el gate rápido se niega solo, **`./init.sh`
> completo es obligatorio** antes del PR y antes de la release.
> `[P]` = puede ir en paralelo con las de su mismo bloque (sin conflicto de archivos).

---

## Bloque M — Medir antes de tocar nada (solo lectura contra producción)

### M1. La sonda: ¿es este el único bloqueo? **(BLOQUEANTE, va primero)**
Ejecutar la consulta `M5` de `design.md` §8 contra producción, en solo lectura.
**Hecho:** las 3 órdenes en `rechazada` aparecen con `mensajero_asignado_id` **no nulo** e **igual**
al `mensajero_id` de su última gestión vigente, y `deleted_at IS NULL`. El número medido y la salida
cruda quedan pegados en `progress/impl_425.md`.
**Si NO se cumple:** *parar*. El arreglo no destraba esas órdenes; volver al humano con el dato. No
se escribe una línea de código.

### M2. [P] La evidencia del doble cobro
Ejecutar la consulta `M6` de §8.
**Hecho:** en `progress/impl_425.md` queda el conteo de `rechazo_tienda_cobro` por estado sobre las
gestiones sin cierre, con el total en colones. Es lo que justifica `R8` con un número.

### M3. [P] El desglose a avisar (D3) y el efecto sobre el bloqueo
Re-medir la tabla de `design.md` §6 y ejecutar la consulta de cierres abiertos por mensajero (`M7`).
**Hecho:** `progress/aviso_425_desglose.md` escrito y **commiteado**, con: la tabla por mensajero, la
frase «esto es lo esperado, no un error», qué tiene que hacer quien aprueba (separar y devolver, sin
escanear) y la lista de mensajeros que quedarían en N ≥ 2 cierres abiertos.
**Depende de:** nada. **Bloquea:** el despliegue (V4), no la implementación.

### M4. [P] La foto del «antes»
Los seis totales del último cierre **aprobado** de cada uno de los 6 mensajeros + `SUM(pago_mensajero)`
de sus gestiones (`M1/M2` de §8, mitad *antes*).
**Hecho:** tabla pegada en `progress/impl_425.md`, con fecha y hora de la medición.

---

## Bloque B — Backend (depende de M1 en verde)

### B1. Esquema + migración
`db/schema.prisma`: modelo `CierreRechazoTienda` (§4.1) y las relaciones inversas en `CierreDia`,
`GestionOrden` y `Orden`. `db/migrations/<ts>_cierre_rechazo_tienda/migration.sql` + `down.sql`.
**Hecho:** `pnpm run db:migrate:create` genera el UP; el `down.sql` está escrito a mano y es un
`DROP TABLE IF EXISTS`; la migración aplica y revierte en local (`db:migrate` → `db:rollback` →
`db:migrate`) **sin drift** y sin renumerar nada. Sin backfill, sin enum nuevo, sin tocar ningún
`down.sql` anterior.
**Ojo:** la base local está compartida entre worktrees; avisar antes de aplicar (rompe gates ajenos).

### B2. Test de migración `tests/integration/db/cierre-rechazo-tienda-migration.test.ts`
**Hecho:** verde contra Postgres real y afirma: la tabla existe; `UNIQUE(gestion_id)`; los índices
por `cierre_id` y `orden_id`; las 3 FKs con `ON DELETE RESTRICT`; `relrowsecurity = true` y **cero
policies**; y —`R21`— que **ninguna columna es numérica/decimal** (se consulta
`information_schema.columns`, no se escribe la lista a mano).
**Depende de:** B1.

### B3. Predicado de pertenencia
`lib/repositories/CierreDiaRepository.ts`: `rechazosDeTiendaDelCierreWhere(mensajeroId)` (§5.1-a),
declarado **una sola vez** y con el comentario que explica los dos cerrojos de D2.
**Hecho:** compila; el test unitario de `tests/unit/repositories/cierre-dia-repository.test.ts` afirma
el objeto `where` literal (contrato), sin compararlo contra su propia fuente.
**Depende de:** B1.

### B4. Escritura dentro de `crearCierre` + guarda «algo pasó»
`crearCierre`: pre-`SELECT` con B3, `createMany({ skipDuplicates: true })` sobre la tabla nueva y la
guarda ampliada con `rechazosIncorporados` (§5.1-b). **No se toca** el `updateMany` que vincula, ni
`ORIGENES_GESTION_FUERA_DEL_CIERRE`, ni una sola función de dinero.
**Hecho:** compila y B5 pasa.
**Depende de:** B3.

### B5. Test del `WHERE` contra Postgres — `tests/integration/db/cierre-rechazo-tienda-sql-real.test.ts`
Molde: `cierre-excluye-gestiones-de-escritorio.test.ts` (mensajero recién creado por caso,
`enTransaccionRevertida`, conjuntos exactos). Casos: incorpora el rechazo suelto (R1); no incorpora el
que ya tiene vínculo (R3); una segunda corrida no duplica (R4); el mensajero **solo** con rechazos
ahora **sí** obtiene cierre (R5, el caso Arnel); la `reprogramacion_tienda` no entra por ningún lado
(R17); la de calle y la de ayuda entran como siempre (R18).
**Hecho:** verde; y **contraprueba de mutación aplicada y pegada** en `progress/impl_425.md`: al
quitar `resultado: "rechazada"` **o** el `some` del origen, el archivo se pone rojo. Un test que no se
haya matado antes no cuenta.
**Depende de:** B4.

### B6. Test de totales — `tests/integration/db/cierre-rechazo-tienda-totales.test.ts`
El **mismo** escenario sembrado dos veces: con rechazo y sin rechazo. Compara los **seis** totales de
`cierre_dia` como STRING escala 2 (`toFixed(2)`), literal contra literal.
**Hecho:** verde y afirma: los seis totales coinciden al céntimo (R6, R7); la gestión de rechazo sigue
con `cierre_id`, `pago_mensajero` e `ingreso_bodega_rechazo` en **`NULL`** (R9); un cierre sin
rechazos se comporta idéntico al de antes de la ficha (R19).
**Depende de:** B4.

### B7. Test de aprobación — `tests/integration/db/cierre-rechazo-tienda-aprobacion.test.ts`
Molde: `liberacion-al-aprobar-cierre-real.test.ts`. Aprueba un cierre que incorpora un rechazo y
afirma: **ni un** `wallet_movimiento` / `wallet_tienda_movimiento` / `pago_mensajero_movimiento`
nuevo atribuible a esa gestión, y en particular ningún `ingreso_flete_devolucion` (R8); la
confirmación física no lo exige —el cierre se aprueba sin escanearlo— (R10); la orden sale de
`rechazada` a `por_devolver_a_tienda` en zona **central** y a `por_devolver` en **satélite**, en los
dos casos (R11), con su fila de historial y sin tocar mensajero/prioridad/importes (R12); el caso
NA-981 reproducido —mensajero cuyas únicas gestiones sueltas son rechazos— termina con la orden fuera
de `rechazada` (R13); y un cierre **rechazado** conserva sus vínculos (R20).
**Depende de:** B4.

### B8. [P] No-regresión de la 337 — extender `tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts`
**Sin cambiar ni una aserción existente** (son el contrato de la 337: `porGestion[rechazoTienda]`
sigue siendo `null`). Se **añaden** dos: el rechazo aparece en `cierre_rechazo_tienda` de ese cierre,
y la reprogramación no aparece en ninguna de las dos tablas.
**Hecho:** verde, con el comentario de cabecera actualizado explicando que la 337 **no se revoca**:
se separa pertenencia de facturación.
**Depende de:** B4.

### B9. [P] Guardia de la lista — extender `tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts`
**Hecho:** afirma que `ORIGENES_GESTION_FUERA_DEL_CIERRE` sigue siendo exactamente
`["rechazo_tienda", "reprogramacion_tienda"]` **después** de esta ficha, con el comentario de por qué
sacar `rechazo_tienda` de ahí es la alternativa descartada (§7.1) y no una mejora pendiente.
**Depende de:** B1 (solo por orden de commits).

### B10. Contratos e interfaces
`ICierreDiaRepository`, `ICierreDiaService`, `ICierresAdminService`: `CierreRechazoDeTienda` y
`rechazosDeTienda: CierreRechazoDeTienda[]` (§5.2), **lista vacía nunca `null`**, sin ningún campo de
importe. Documentado en el JSDoc con el porqué.
**Hecho:** typecheck verde en todo el árbol, incluidos los dobles de test.
**Depende de:** B1.

### B11. Lectura del detalle
En `CierreDiaRepository`, el método que compone el detalle de un cierre ya creado suma la lectura por
`cierre_id`, ordenada por `rechazado_at` ASC; `CierreDiaService.verCierrePasado` y el equivalente de
`CierresAdminService` propagan el campo (junto a `ordenesSinGestion`).
**Hecho:** tests de servicio extendidos en `tests/unit/services/cierre-dia-service.test.ts` y
`tests/unit/services/cierres-admin-service.test.ts`: un cierre con 3 rechazos los emite los 3, uno sin
ninguno emite `[]`, y un cierre fuera de alcance no emite el campo.
**Depende de:** B10.

---

## Bloque F — Frontend (empieza cuando B11 está verde)

### F1. La sección en el comprobante
`app/(app)/cierres-admin/_components/cierre-factura.tsx`: prop `rechazosDeTienda` y la sección de
§5.4 (rótulo, la línea «no son gestiones del mensajero y no suman a su pago», guía · remisión ·
destinatario · producto · tienda · **fecha del rechazo** · motivo).
**Hecho:** sin ninguna columna de importe, sin casilla de confirmación, y con la sección omitida
entera cuando la lista está vacía. Componentes de `components/ui/` existentes; nada nuevo.
**Depende de:** B11.

### F2. Las tres superficies
`CierresAdminModule.tsx` y `CierreDiaModule.tsx` pasan la prop desde el resultado del servidor (nunca
un literal).
**Hecho:** las tres superficies pintan lo mismo para el mismo cierre.
**Depende de:** F1.

### F3. Guardia de superficies — extender `tests/unit/guards/cierre-detalle-superficies.guardia.test.ts`
Añadir `rechazosDeTienda` a `PROPS_OBLIGATORIAS`.
**Hecho:** rojo si se quita la prop de cualquier `.tsx` de `app/**` (comprobado a mano quitándola);
verde con las tres puestas (R14).
**Depende de:** F2.

### F4. Test de componente — `tests/components/CierreRechazosDeTienda.test.tsx`
**Hecho:** verde y afirma: se pinta la **fecha** de cada rechazo (R15); el rótulo dice que no son
trabajo del mensajero (R16); **no** aparece ningún importe ni casilla de confirmación en esa sección;
y una lista vacía no deja ni encabezado. Texto en español claro, sin siglas.
**Depende de:** F1.

---

## Bloque V — Verificación, despliegue y cierre

### V1. Gate completo
`./init.sh` (completo, no `--rapido`), con `INIT_EXIT=$?` **escrito dentro del log** y el log íntegro
en `progress/` (sin `tail`).
**Hecho:** `INIT_EXIT=0`, **y** revisados los `skipped`: los ~78 archivos de `tests/integration/db`
tienen que haber **corrido** (si están saltados es que falta `DATABASE_URL`, y entonces los tests que
sostienen R1-R13 no se ejecutaron y el verde no vale).
**Depende de:** todo B y F.

### V2. Trazabilidad
`progress/impl_425.md` con la tabla `R<n> → test` de abajo, las salidas crudas de M1-M4, la
contraprueba de mutación de B5 y el comando exacto con el que se corrió cada test.
**Hecho:** escrito **y commiteado** (un informe sin commitear no existe: se lo lleva el primer
`git checkout`).

### V3. PR
PR contra `dev` desde `feat/425-salida-rechazo-tienda`, enlazando los tres archivos del spec y el
informe.
**Hecho:** abierto con el gate completo en verde adjunto. **No se escribe `feature_list.json` desde
esta rama** (se cuela en el merge y revierte cierres ajenos): el estado lo actualiza el leader fuera.

### V4. Puerta humana antes de desplegar (D3)
Entregar `progress/aviso_425_desglose.md` (M3) al humano **antes** de mergear a `prod`, para que avise
a quien aprueba los cierres.
**Hecho:** el humano confirma que ha avisado. Sin esa confirmación, la release espera.
**Depende de:** M3, V3.

### V5. Medición del «después» (post-despliegue)
Sobre el **primer** cierre que incorpore rechazos: las dos consultas `M1/M2` de §8, mitad *después*.
**Hecho:** `total_pago_mensajero` cuadra con la suma de los `pago_mensajero` de las gestiones **con
`cierre_id`**, la consulta de contaminación devuelve **0**, y las órdenes atascadas —NA-981 incluida—
están fuera de `rechazada`. Resultado pegado en `progress/impl_425.md`.
**Si no cuadra:** revertir el código (la tabla vacía no estorba) y volver al humano. No se ha emitido
ningún apunte, así que no hay nada que compensar.

---

## Mapa de trazabilidad `R<n> → test`

> Regla del repo: un cambio en el `WHERE` del cierre **se prueba contra Postgres real**. Los tests de
> servicio usan dobles y no ven el SQL; están aquí solo donde lo que se prueba es cableado.

| R | Qué asegura | Test |
| --- | --- | --- |
| R1 | El rechazo suelto entra al cierre | `tests/integration/db/cierre-rechazo-tienda-sql-real.test.ts` |
| R2 | El vínculo es persistente y sobrevive a la aprobación | `…-sql-real.test.ts` + `…-aprobacion.test.ts` |
| R3 | Un cierre posterior no se lo vuelve a llevar | `…-sql-real.test.ts` |
| R4 | Idempotencia (segunda corrida, un solo vínculo) | `…-sql-real.test.ts` |
| R5 | El mensajero solo con rechazos **sí** obtiene cierre | `…-sql-real.test.ts` (caso Arnel) |
| R6 | `total_pago_mensajero` no se mueve | `tests/integration/db/cierre-rechazo-tienda-totales.test.ts` |
| R7 | Los otros cinco totales no se mueven | `…-totales.test.ts` |
| R8 | La aprobación no emite ni un apunte por esas gestiones | `tests/integration/db/cierre-rechazo-tienda-aprobacion.test.ts` |
| R9 | `ingreso_bodega_rechazo` sigue sin congelar | `…-totales.test.ts` |
| R10 | No se exige confirmación física del rechazo | `…-aprobacion.test.ts` |
| R11 | La orden sale de `rechazada` al destino **por zona** (central y satélite) | `…-aprobacion.test.ts` |
| R12 | Historial con el admin como actor; sin tocar mensajero/prioridad/importes | `…-aprobacion.test.ts` |
| R13 | NA-981 se destraba sin edición manual | `…-aprobacion.test.ts` (caso reproducido) + V5 en producción |
| R14 | Las **tres** superficies pasan la lista | `tests/unit/guards/cierre-detalle-superficies.guardia.test.ts` |
| R15 | Guía, remisión, destinatario, producto, tienda y **fecha** | `tests/components/CierreRechazosDeTienda.test.tsx` |
| R16 | Sección aparte y rotulada como decisión de la tienda | `tests/components/CierreRechazosDeTienda.test.tsx` |
| R17 | `reprogramacion_tienda` sigue fuera de todo (D2) | `…-sql-real.test.ts` + `tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts` |
| R18 | Calle y ayuda de tienda entran igual que hoy | `tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts` (ampliado) |
| R19 | Un cierre sin rechazos se comporta exactamente como antes | `…-totales.test.ts` + `cierre-excluye-gestiones-de-escritorio.test.ts` |
| R20 | Un cierre rechazado conserva sus vínculos | `…-aprobacion.test.ts` |
| R21 | Tabla sin columnas de importe + RLS sin policies | `tests/integration/db/cierre-rechazo-tienda-migration.test.ts` |

## Orden de ejecución (resumen)

```
M1 ──(verde)──> B1 ──> B2 [P] B3 ──> B4 ──> B5, B6, B7, B8 [P]
                 └──> B9 [P]   └──> B10 ──> B11 ──> F1 ──> F2 ──> F3, F4 [P]
M2, M3, M4 [P] (en cualquier momento; M3 bloquea V4)
                                                   todo ──> V1 ──> V2 ──> V3 ──> V4 ──> V5
```
