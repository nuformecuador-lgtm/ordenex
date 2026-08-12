# 208 — Pago múltiple por entrega (backend) — Tasks

Rama: `feature/208-pago-multiple-entrega` (de `origin/dev`, `c23c118a`).
Convención: un commit por task lógica (`docs/conventions.md`). `[P]` = paralelizable con las tasks
que comparten el mismo bloque de dependencias. `./init.sh --rapido` al cerrar cada tanda;
`./init.sh` completo antes del PR (`docs/verification.md`).

---

## Tanda 1 — Modelo

### [x] T1. Schema Prisma: modelo `GestionOrdenPago` + relación inversa
- **Archivos:** `db/schema.prisma`
- **Qué:** modelo nuevo según design §1.1 (`id`, `gestionId`, `metodo: MetodoPagoValue`,
  `monto Decimal @db.Decimal(12,2)`, `createdAt`, FK CASCADE, `@@unique([gestionId, metodo])`,
  `@@index([gestionId])`, `@@map("gestion_orden_pago")`) + `pagos GestionOrdenPago[]` en
  `GestionOrden`. `monto_recibido` y `metodo_pago` se CONSERVAN intactos (R5); comentario que marca
  `metodoPago` como DEPRECADO y remite a la 209.
- **Hecho:** `pnpm db:generate` limpio y `pnpm run typecheck` verde.
- **Cubre:** R1, R2, R3, R5.

### [x] T2. Migración `<ts>_gestion_orden_pago` (UP + DOWN) — depende de T1
- **Archivos:** `db/migrations/<ts>_gestion_orden_pago/migration.sql`, `.../down.sql`
- **Qué:** los 5 bloques del design §1.2 (tabla, unique + index, FK CASCADE, `ENABLE ROW LEVEL
  SECURITY` sin policies, backfill con `WHERE monto_recibido IS NOT NULL AND monto_recibido > 0 AND
  metodo_pago IS NOT NULL`). `down.sql` = `DROP TABLE IF EXISTS` y nada más, con el comentario de
  qué se pierde al revertir.
- **Hecho:** `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte, los dos en la base de
  prueba, y `gestion_orden` queda idéntica tras el rollback.
- **Cubre:** R4, R6, R7, R8, R9, R10.

### [x] T3. [P] Test de migración (estático) — depende de T2
- **Archivos:** `tests/integration/db/gestion-orden-pago-migration.test.ts` (nuevo)
- **Qué:** patrón `gestion-orden-evidencia-migration.test.ts`: lee `migration.sql`/`down.sql` por
  regex. Afirma tabla + columnas NOT NULL, PK, unique `(gestion_id, metodo)`, index, FK CASCADE,
  `ENABLE ROW LEVEL SECURITY` **sin** `CREATE POLICY`, el `WHERE` del backfill con sus tres
  condiciones, la ausencia de cualquier `CHECK` de la suma (R10), la ausencia de `ALTER TABLE
  "cierre_dia"` / `"cierre_maestro"` (R8) y el `down.sql` que no toca `gestion_orden`.
- **Hecho:** el archivo pasa y falla si se le quita cualquiera de esas cláusulas al SQL.
- **Cubre:** R1, R2, R4, R6, R7, R8, R9, R10.

---

## Tanda 2 — Borde de escritura (depende de T1)

### [x] T4. Util puro `pagos-recaudo.ts`
- **Archivos:** `lib/utils/pagos-recaudo.ts` (nuevo), `tests/unit/utils/pagos-recaudo.test.ts` (nuevo)
- **Qué:** `aCentimos`, `sumaCuadra`, `normalizarPagos` (design §2). **Sin importar
  `@prisma/client`** — viaja al bundle del cliente. Céntimos enteros, cero `parseFloat`.
- **Hecho:** tests de las tres formas (desglose, escalar → 1 línea, `montoRecibido = 0` → `[]`),
  incluidos montos con decimales que delatarían una suma float.
- **Cubre:** R12, R14, R30.

### [x] T5. zod del borde: la rama `entregada` acepta LAS DOS FORMAS — depende de T4
- **Archivos:** `lib/types/gestion-orden.ts` (`:214-225` + `superRefine`),
  `tests/unit/types/gestion-orden-pagos-schema.test.ts` (nuevo)
- **Qué:** `metodoPago` pasa a opcional, se añade `pagos` opcional con `monto` positivo, y las
  cinco reglas del `superRefine` (design §2), cada una con su error de campo.
- **Hecho:** un test por regla + el caso de compatibilidad («la forma escalar histórica sigue
  validando y produce UNA línea») + el caso «sin cobro con escalar `efectivo` → cero líneas» +
  el caso «las dos formas a la vez → rechaza». Ninguna otra rama del `discriminatedUnion` admite
  `pagos`.
- **Cubre:** R11, R12, R13, R14, R15, R16.
- **Guardia de no-regresión:** el archivo NO puede importar `@prisma/client` (el panel lo usa en
  cliente); se afirma en el propio test.

### [x] T6. Action: `FormData` → `pagos` — depende de T5
- **Archivos:** `lib/actions/mis-asignaciones.ts` (`rawFromFormData` `:194-234`,
  `toGestionarInput` `:246-255`), `tests/unit/actions/mis-asignaciones-pagos.test.ts` (nuevo)
- **Qué:** lee `pagoMetodo`/`pagoMonto` repetidos con `getAll` (patrón evidencias 119) y los empareja
  por índice; si no vienen, NO crea la clave. La rama `entregada` emite `pagos: normalizarPagos(...)`
  y conserva `metodoPago` para la columna de compatibilidad.
- **Hecho:** un `FormData` VIEJO (solo `metodoPago`) sigue produciendo una gestión válida con una
  línea; uno nuevo con dos pares produce dos líneas; longitudes desparejas → error de validación.
- **Cubre:** R12, R11.

### [x] T7. Service: revalidación `Prisma.Decimal` + `metodo_pago` de compatibilidad — depende de T6
- **Archivos:** `lib/interfaces/services/IMisAsignacionesService.ts` (`GestionarInput`),
  `lib/services/MisAsignacionesService.ts` (`:346-363`, `buildGestionData` `:557-565`),
  `tests/unit/services/mis-asignaciones-pagos.test.ts` (nuevo)
- **Qué:** la variante `entregada` de `GestionarInput` gana `pagos: LineaPago[]`; el service suma en
  `Prisma.Decimal` y rechaza si no iguala `montoRecibido`; `buildGestionData` propaga `pagos` y
  calcula `metodoPago`: 1 línea → esa, 0 o ≥2 → `null`.
- **Hecho:** tests de suma que no cuadra (no persiste, error de campo), de 1 línea (`metodo_pago` =
  esa) y de 2 líneas (`metodo_pago` = `null`). La comprobación existente `montoRecibido ==
  montoCobrar` sigue verde sin editar sus aserciones.
- **Cubre:** R18, R19.

### [x] T8. Repositorio: `createMany` de las líneas DENTRO de la misma tx — depende de T7
- **Archivos:** `lib/interfaces/repositories/IGestionOrdenRepository.ts` (`GestionOrdenData`),
  `lib/repositories/GestionOrdenRepository.ts` (`crearGestionYTransicionar` `:374-425`),
  `tests/unit/repositories/gestion-orden-repository.test.ts` (ampliar)
- **Qué:** `pagos` viaja dentro de `GestionOrdenData` (la firma del método NO cambia). Insert con
  `tx.gestionOrdenPago.createMany`, `monto` como `new Prisma.Decimal(...)`, junto al insert de
  evidencias. Lista vacía → no inserta.
- **Hecho:** test de que las líneas se escriben en la MISMA transacción (si el `create` de la
  gestión o la transición falla, no queda ninguna línea) y de que el monto llega como `Decimal`.
- **Cubre:** R17, R20.

---

## Tanda 3 — Lectura y cálculo (depende de T1; T9 puede empezar en paralelo a la tanda 2)

### [x] T9. Tipo de dominio: `pagos` OBLIGATORIO + fixtures
- **Archivos:** `lib/interfaces/repositories/ICierreDiaRepository.ts` (`:20-67`) + los ≈15 archivos
  de tests que construyen `CierreGestionPendienteRow`
- **Qué:** campo `pagos: { metodo; monto: string }[]` obligatorio, sin fallback (design §3.1 y
  alternativa descartada B). Los fixtures se actualizan vía un helper de construcción para no
  repetir el literal 15 veces.
- **Hecho:** `pnpm run typecheck` verde y la suite de cierres verde SIN relajar aserciones previas.
- **Cubre:** R21.

### [x] T10. Proyecciones + mappers — depende de T9
- **Archivos:** `lib/repositories/CierreDiaRepository.ts` (`WITH_DETALLE` `:110-142`,
  `toPendienteRow` `:153`), `lib/repositories/CierresAdminRepository.ts`
  (`GESTION_ADMIN_SELECT` `:107-125`, `toPendienteRowDesdeSnapshot` `:219`)
- **Qué:** `+ pagos: { select: { metodo: true, monto: true }, orderBy: { metodo: "asc" } }` en las
  dos proyecciones; mapeo con el `decimalToString` existente. **`CierresBodegaAdminRepository` no se
  toca**: reusa `GESTION_ADMIN_SELECT`/`toPendienteRowDesdeSnapshot` (verificado).
- **Hecho:** tests de repositorio de los TRES caminos (vivo, admin, bodega) afirmando que la fila
  trae el desglose y que el orden es `efectivo`, `SINPE`, `transferencia`.
- **Cubre:** R21, R22, R23.

### [x] T11. `computeTotales` itera líneas — depende de T9
- **Archivos:** `lib/utils/cierre-totales.ts` (`:53-81`),
  `tests/unit/utils/cierre-totales-pagos.test.ts` (nuevo)
- **Qué:** el `switch` sobre un método pasa a doble bucle sobre `g.pagos` con `Prisma.Decimal`
  (design §4). `derivarPagos`/`derivarIngresoBodega` intactos.
- **Hecho:** la batería de MUTACIÓN completa, casos 1-8 del design §4 (mixta, mutación de método,
  de monto, de resultado, borrado de línea, invariante de suma, paridad con el modelo escalar,
  exactitud decimal). El caso 1 debe ser ROJO contra la implementación anterior.
- **Cubre:** R24, R25, R26, R27, R28, R30.

### [x] T12. La `E` del `min(P, E)` — depende de T11
- **Archivos:** `tests/unit/services/cierre-dia-service-totales-mixtos.test.ts` (nuevo)
- **Qué:** un cierre con una entrega mixta (5.000 efectivo + 3.000 transferencia) → `crearCierre`
  recibe `totalEfectivo = "5000.00"` (no `"8000.00"`), y el pendiente del mensajero calculado con
  esa `E` es el correcto (feature 44, `ILiquidacionPagoRepository.ts:96,106`). La FÓRMULA no se
  toca; solo se fija el valor de `E`.
- **Hecho:** el test falla si `computeTotales` vuelve a meter el total en un solo balde.
- **Cubre:** R29.

### [x] T13. DTO de servicio — depende de T10
- **Archivos:** `lib/interfaces/services/ICierreDiaService.ts` (`:34-35`),
  `lib/services/CierreDiaService.ts` (`:595-603`)
- **Qué:** `CierreGestionDTO` gana `pagos` y CONSERVA `metodoPago` (R31); el mapper lo propaga.
  Éste es el contrato que consume la 209 (panel, detalles y descargas [D4]).
- **Hecho:** test de que el DTO lleva el desglose y sigue llevando `metodoPago`; ningún componente
  actual se rompe (typecheck de `app/` verde sin tocar `app/`).
- **Cubre:** R31.

---

## Tanda 4 — Guardias y cierre

### [x] T14. [P] Guardia de proyección — depende de T10
- **Archivos:** `tests/unit/guards/pagos-proyeccion.guardia.test.ts` (nuevo)
- **Qué:** toda proyección Prisma que alimente `CierreGestionPendienteRow` selecciona `pagos`.
- **Hecho:** al borrar `pagos:` de `WITH_DETALLE` o de `GESTION_ADMIN_SELECT`, la guardia se pone
  roja.
- **Cubre:** R23.

### [x] T15. [P] Guardia de aritmética Decimal — depende de T11
- **Archivos:** `tests/unit/guards/pagos-aritmetica-decimal.guardia.test.ts` (nuevo)
- **Qué:** `cierre-totales.ts`, `pagos-recaudo.ts` y el tramo nuevo del repositorio no usan
  `parseFloat(` ni `Number(` sobre montos, y la serialización sale por el helper money-safe.
- **Hecho:** guardia verde; roja si se introduce una suma float.
- **Cubre:** R30.

### [x] T16. [P] Guardia de frontera — depende de T11
- **Archivos:** `tests/unit/guards/pagos-frontera.guardia.test.ts` (nuevo)
- **Qué:** `CajaCodFeedService`, `WalletTiendaFeedService`, `RecaudoAnaliticaRepository`,
  `AnaliticaFinancieraService`, `descripcion-pago.ts` y los caminos de `LiquidacionPago` NO
  mencionan `gestionOrdenPago`/`gestion_orden_pago`; los `total_*` de `cierre_dia`/`cierre_maestro`
  siguen siendo tres columnas.
- **Hecho:** guardia verde y las guardias de analítica preexistentes (`aislamiento`,
  `alcance-fuente-unica`, `financiera-fuente`) siguen verdes sin editarlas.
- **Cubre:** R32, R33.

### [x] T17. Mapa de trazabilidad + evidencia — depende de todo lo anterior
- **Archivos:** `progress/impl_208-pago-multiple-entrega.md`
- **Qué:** tabla `R1..R33 → test concreto` con la salida real de la suite pegada.
- **Hecho:** ningún requisito sin test; `./init.sh` COMPLETO en verde (no `--rapido`) antes de abrir
  el PR.
- **Cubre:** el criterio del reviewer (`docs/verification.md`).

### T18. Bookkeeping — depende de T17
- **Archivos:** `feature_list.json` (id 208 → `done`, `status_note` con la decisión sobre el retiro
  de `metodo_pago`), `progress/current.md`
- **Qué:** dejar escrito en el PR si la forma escalar del borde y la columna `metodo_pago` se
  retiran en la 209 o quedan (pregunta abierta 3 de `requirements.md`).
- **Hecho:** `./init.sh` verde, PR abierto contra `dev`.

---

## Grafo de dependencias (resumen)

```
T1 ──┬── T2 ── T3
     ├── T4 ── T5 ── T6 ── T7 ── T8
     └── T9 ──┬── T10 ──┬── T13
              │         └── T14 [P]
              └── T11 ──┬── T12
                        └── T15 [P]
                                 T16 [P]
todas ── T17 ── T18
```

Paralelizables entre sí: **T3** con la tanda 2 completa; **T9** con T4-T8; **T14/T15/T16** entre
ellas una vez cerradas T10 y T11.
