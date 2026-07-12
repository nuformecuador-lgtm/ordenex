# impl_54 - Reconciliacion del refactor PR #40 (zonas/tarifas) para dejar dev VERDE

FIX-FEATURE fullstack. Rama feature/54-reconciliar-zonas-tarifas. Se ARREGLA HACIA
ADELANTE conservando el refactor del #40 (tarifas por zona, TarifaZonaMensajero,
N:M ZonaDistrito, menu shadcn). El flag de zona central se repone como esCentral
(renombrado del viejo esGam). Los pagos al mensajero viven en tarifa_zona_mensajero,
NO vuelven a Zona.

## Que se reconcio

### Schema + migracion (backend_dev)
- db/schema.prisma modelo Zona: + usuarios Usuario[] (arregla P1012), + esCentral Boolean @default(false) @map(es_central), + nombre String @unique (restaurado; ya existia el indice zona_nombre_key en DB).
- Migracion NUEVA db/migrations/20260712000000_zona_es_central_rename/ (migration.sql + down.sql): RENAME COLUMN es_gam -> es_central, RENAME INDEX zona_es_gam_unico -> zona_es_central_unico (preserva indice unico parcial = a lo sumo UNA zona central); DROP COLUMN pago_entrega/pago_rechazo (pagos movidos a tarifa_zona_mensajero).
- Baseline #40 roto: 20260711200000_provincia_zona_id_nullable fallaba (P3018/42703: provincia.zona_id ya eliminada en 120000). Convertida en no-op idempotente guardado; marcada rolled-back y re-aplicada.

### esCentral / resolver (backend_dev)
- lib/types/zona.ts: +esCentral en ZonaDTO y en zonaFields (zod default false); reintroducidos ProvinciaLightDTO, CantonLightDTO, DistritoCatalogoDTO.
- lib/interfaces/repositories/IZonaRepository.ts: + findCentralZonaId(): Promise string|null, +esCentral en CreateZonaData.
- lib/repositories/ZonaRepository.ts: implementa findCentralZonaId (findFirst where esCentral=true), persiste esCentral en create/update, lo propaga al DTO.
- lib/services/ZonaService.ts: propaga esCentral a CreateZonaData.
- Callers 17/30 (semantica intacta, firmas publicas sin cambios): GuiaAsignacionService.ts y lib/actions/ordenes-guia.ts findGamZonaId->findCentralZonaId, gamZonaId->centralZonaId. Feature 34 (findMensajerosByZona) NO se toco.

### Repos Zona/Tarifa/Geo + errores sueltos (backend_dev)
- OrdenRepository.ts: campo prisma esGam->esCentral en selects/accesos; DTO zonaEsGam MANTENIDO (zonaEsGam: row.zona.esCentral) -> contrato estable, sin ripple en GenerarGuiaModal.
- GeoRepository.ts: listDistritos usa la relacion N:M zonas.
- BulkOrdenService.ts: deriva orden.zonaId del DISTRITO (antes provincia.zonaId, columna inexistente).
- UsuarioService.ts: findById(deseado, false).
- IOrdenRepository.ts: ProvinciaRow sin zonaId (columna inexistente en DB).
- TarifaRepository/ZonaRepository: los ~33 errores eran STALE (client del schema viejo); resueltos al prisma generate.

### UI zonas (frontend_dev)
- app/(app)/configuracion/_components/zonas-columns.tsx: ELIMINADAS columnas pagoEntrega/pagoRechazo (y formatMonto); badge ZonaGamBadge->ZonaCentralBadge, columna central/header Central, render con row.esCentral. Columnas: Nombre, N distritos, Central, Acciones.
- ZonaForm.tsx: NO tocado (ya compilaba; sigue stubbeado - deuda #40).

### Tests actualizados al modelo nuevo
- Backend: zona-repository, geo-repository, orden-repository, orden-repository.guia, guia-asignacion-service, usuario-zona, zona-service, seed-zonas, zona-schema, zonas-action (REESCRITO), ordenes-guia-action, zonas-migration (valida es_central/zona_es_central_unico).
- UI: zonas-columns, zona-form (reescrito al stub real), zonas-module, zonas-page.

## Mapa reconciliacion -> test (cluster feature 54: 17 archivos, 204 tests, 0 fallos)
- Schema valido + P1012 -> prisma validate OK + typecheck 0.
- Migracion esCentral (rename + drop pagos, up/down) -> tests/integration/db/zonas-migration.test.ts.
- findCentralZonaId (id si esCentral=true; null si ninguna) -> tests/unit/repositories/zona-repository.test.ts.
- esCentral persistido + regla cobroVehiculo/tarifas + default -> zona-schema.test.ts, zona-repository.test.ts, zona-service.test.ts.
- Callers 17/30 con resolver renombrado -> guia-asignacion-service.test.ts, ordenes-guia-action.test.ts (cobertura 17/30 intacta).
- CRUD zonas + ZonaDTO nuevo -> zonas-action.test.ts.
- Geo N:M -> geo-repository.test.ts. Tarifas -> tarifa-repository.test.ts.
- OrdenRepository esCentral (DTO zonaEsGam estable) -> orden-repository.test.ts, orden-repository.guia.test.ts.
- BulkOrden deriva zona del distrito -> bulk-orden-service.test.ts.
- Columna Central + sin pagos -> zonas-columns.test.tsx, zonas-module.test.tsx, zona-form.test.tsx, zonas-page.test.tsx.

## Verificacion (salida real)
- prisma validate -> The schema is valid.
- prisma migrate deploy -> aplico 6 pendientes (180000/190000/200000/210000 #40 + seed_roles + 20260712000000).
- prisma migrate status -> 25 migrations found ... Database schema is up to date!
- tsc --noEmit -p tsconfig.json -> 0 errores.
- pnpm lint -> 0 errores (solo warnings preexistentes en scripts de skills).
- pnpm build -> PASA (14 rutas; /postulacion force-dynamic).
- ./init.sh -> exit 0, == init OK == (gatea typecheck 0 + lint 0 + harness down.sql/.env).
- Cluster feature 54 (17 archivos) -> 204 passed, 0 failed.
- Suite completa pnpm test -> 1554 passed | 11 failed.

## Deuda / hallazgos (NO ocultados)
1. 11 tests rojos PRE-EXISTENTES en dev (baseline #40), FUERA del alcance de feature 54. Probado con git stash -u + re-run sobre dev limpio: los MISMOS 11 fallan sin ninguno de mis cambios. En 5 archivos de otros subsistemas del #40:
   - tests/unit/auth/menu-visibility.test.ts (6) - menu/sidebar shadcn NUEVO del #40 cambio orden/mapeo de SIDEBAR_ITEMS.
   - tests/components/OrdenesCargaMasivaButton.test.tsx (2) - feature 51: plantilla xlsx CR vs Ecuador.
   - tests/integration/db/{postulacion-mensajero,usuario-fulfillment,vehiculos}-migration.test.ts (3) - tests fragiles que asumen soy-la-migracion-mas-nueva; rotos por migraciones apendidas del #40.
   No se reconcilian aqui para no expandir alcance a 3 subsistemas ajenos sin decision del leader (regla #5/#6). DECISION DEL LEADER: ampliar alcance o abrir follow-ups.
2. Drift schema/DB en provincia: schema aun declara Provincia.zonaId/Provincia.zona/Zona.provincias, pero provincia.zona_id fue dropeada en DB por 120000. Inofensivo hoy. Limpiar en migracion posterior.
3. ZonaForm.tsx sigue stubbeado (solo campo Nombre; sin distritos/tarifas ni submit real) - deuda #40. No hay forma de setear esCentral desde la UI todavia (schema/DTO/repo ya lo soportan).

## Veredicto (1er pase)
Alcance de feature 54 reconciliado hacia adelante y VERDE: prisma valido, migraciones up-to-date, typecheck 0, lint 0, build OK, init.sh exit 0, 204/204 tests del cluster. Persisten 11 fallos de suite PRE-EXISTENTES del baseline #40 en subsistemas ajenos - documentados para decision del leader.

---

## 2do PASE - reconciliar los 11 loose-ends del #40 (decision del leader: ampliar alcance)

Se cerraron los 11 fallos que quedaban de la suite (1554/1565 -> 1565/1565). Delegado a
backend_dev (Grupos 1 y 3, solo tests) y frontend_dev (Grupo 2, restaurar feature 51).
Ningun cambio de logica de produccion salvo la restauracion de la feature 51 (Grupo 2).

### Grupo 1 - tests/unit/auth/menu-visibility.test.ts (7 fallos): TEST OBSOLETO (backend_dev)
Causa: el test desestructuraba SIDEBAR_ITEMS POR POSICION con el orden VIEJO y tenia
asserts de orden viejo. El #40 reordeno a [Ordenes, Configuracion, Perfil]. El codigo
lib/auth/menu-visibility.ts es CORRECTO y NO se toco.
Fix (solo test): referencia los items por LABEL (helper byLabel) en vez de por indice;
asserts de itemsVisibles al orden real de salida: maestro -> [Ordenes,Configuracion,Perfil];
admin/adminTienda/mensajero -> [Ordenes,Perfil]; adminSatelite -> [Perfil]; sin actor -> [].
Visibilidad reflejada: Ordenes(maestro/admin/adminTienda/mensajero), Configuracion(solo
maestro), Perfil(todos incl. adminSatelite, que si esta en RolValue/ROLES_SEED).

### Grupo 2 - tests/components/OrdenesCargaMasivaButton.test.tsx (2 fallos): RESTAURAR feature 51 (frontend_dev)
Causa: el #40 revirtio la feature 51 -> ejemplos de Ecuador y distrito sin required en
ORDENES_BULK_FIELDS de app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx.
Fix (restaura comportamiento, sin debilitar el test): provincia/canton.example -> "San Jose";
distrito.example -> "Carmen" + required: true; direccion.example -> "Av. Central, 200m
norte del parque" (fuera "amazonas"); telefono.example -> "88887777" (CR 8 digitos).
required SOLO en distrito (notas sigue opcional). Alert de acoplamiento distrito<->zona
intacto. xlsx-template NO se toco: lib/utils/xlsx-template.ts ya aplicaba el sufijo " *"
a cabeceras required (el #40 no revirtio esa capa; TemplateField ya declara required?).

### Grupo 3 - {vehiculos,postulacion-mensajero,usuario-fulfillment}-migration.test.ts (3 fallos): invariante reconciliado (backend_dev)
Causa: el it de orden temporal calculaba maxPrevio como el maximo de las migraciones NO
excluidas mediante una lista de exclusiones que crece sin fin; migraciones posteriores
nuevas (del #40 y la 20260712000000_zona_es_central_rename del 1er pase de la 54) no
estaban excluidas y quedaban como maxPrevio > la migracion bajo prueba.
Fix elegido (el MAS SEGURO: arreglo de tests, NO re-timestampear ninguna migracion
aplicada): se elimino la lista de exclusiones fragil y se compara contra un PREDECESOR
CONOCIDO FIJO/REAL. No es tautologico (no recalcula "el maximo de los que ya son menores")
y sigue fallando si la migracion se re-fechara ANTES de su predecesor.
INVARIANTE FINAL por archivo:
- vehiculos: timestamp posterior a su predecesor conocido `20260710150000_order_status_value_enum`
  (ultima migracion existente al crear la feature 50), que debe seguir presente en dirs.
- postulacion_mensajero: se ordena estrictamente despues de `_vehiculos` por dependencia REAL
  (crea el FK usuario.vehiculo_id -> vehiculos(id)); ese orden es obligatorio.
- usuario_fulfillment: se ordena estrictamente despues de su predecesor inmediato
  `_postulacion_mensajero`.
Los demas it (SQL up/down) intactos.

### Verificacion (salida real, 2do pase)
- pnpm typecheck (tsc --noEmit) -> 0 errores.
- npx prisma validate -> The schema at db\schema.prisma is valid.
- pnpm build -> PASA (14 rutas).
- pnpm test -> Test Files 182 passed (182) | Tests 1565 passed (1565) | 0 failed.
- ./init.sh -> == init OK == (exit 0), incluye pnpm test 1565/1565.

## Veredicto (2do pase)
Suite 100% VERDE: 1565/1565 tests, 0 fallos. typecheck 0, prisma valido, build OK,
init.sh exit 0. Grupos 1 y 3 fueron arreglo de tests (sin tocar produccion); Grupo 2
restauro el comportamiento de la feature 51 (ejemplos CR + distrito required) sin
debilitar el test. Los 11 loose-ends del #40 quedaron cerrados. Deuda #2 (drift
schema/DB provincia) y #3 (ZonaForm stub) siguen abiertas, fuera de alcance.
