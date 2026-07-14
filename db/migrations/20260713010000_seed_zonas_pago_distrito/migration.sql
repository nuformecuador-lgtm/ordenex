-- Feature 24 (datos): siembra las zonas de pago y sus asignaciones N:M a distritos,
-- adaptado de 04_insert_zonas_pago_distrito.sql al schema real (tablas "zona" y
-- "zona_distrito", columnas snake_case, ids uuid explicitos). IDEMPOTENTE: ON CONFLICT
-- DO NOTHING en ambas. Cada link se resuelve por INSERT ... SELECT con joins por nombre
-- (distrito dentro de canton dentro de provincia); un distrito ausente en la DB NO
-- rompe la migracion, simplemente no inserta esa fila (0 filas). REQUIERE que la
-- geografia (provincia/canton/distrito) YA este poblada (seed-zonas.ts / XLSX) para que
-- los links resuelvan; si se corre sobre geografia vacia crea solo las zonas.

-- 1) Zonas de pago (nombre unico). es_central/cobro_vehiculo usan el default (false).
INSERT INTO "zona" ("id", "nombre") VALUES (gen_random_uuid()::text, 'GAM') ON CONFLICT ("nombre") DO NOTHING;
INSERT INTO "zona" ("id", "nombre") VALUES (gen_random_uuid()::text, 'GUANACASTE') ON CONFLICT ("nombre") DO NOTHING;
INSERT INTO "zona" ("id", "nombre") VALUES (gen_random_uuid()::text, 'LIMÓN ABAJO') ON CONFLICT ("nombre") DO NOTHING;
INSERT INTO "zona" ("id", "nombre") VALUES (gen_random_uuid()::text, 'PUNTARENAS') ON CONFLICT ("nombre") DO NOTHING;
INSERT INTO "zona" ("id", "nombre") VALUES (gen_random_uuid()::text, 'QUEPOS') ON CONFLICT ("nombre") DO NOTHING;
INSERT INTO "zona" ("id", "nombre") VALUES (gen_random_uuid()::text, 'SAN RAMÓN') ON CONFLICT ("nombre") DO NOTHING;
INSERT INTO "zona" ("id", "nombre") VALUES (gen_random_uuid()::text, 'ZONA SUR') ON CONFLICT ("nombre") DO NOTHING;

-- 2) Asignaciones zona <-> distrito (N:M). Resuelve distrito por (nombre, canton, provincia).
-- San José > San José
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Carmen'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'San José'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- San José > Aserrí
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Aserrí'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Aserrí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Salitrillos'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Aserrí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- San José > Goicoechea
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Guadalupe'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Goicoechea'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- San José > Tibás
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Juan'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Tibás'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- San José > Curridabat
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Curridabat'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Curridabat'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- San José > Pérez Zeledón
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Isidro de El General'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'El General'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Daniel Flores'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Rivas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Pedro'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Platanares'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Pejibaye'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Cajón'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Barú'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Río Nuevo'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Páramo'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'La Amistad'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pérez Zeledón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'San José'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Alajuela > Alajuela
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Alajuela'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Alajuela'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Tambor'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Alajuela'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Alajuela > San Ramón
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Ramón'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'San Ramón'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Alajuela > San Mateo
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Mateo'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'San Mateo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Desmonte'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'San Mateo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Jesús María'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'San Mateo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Labrador'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'San Mateo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Alajuela > Orotina
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Orotina'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Orotina'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'El Mastate'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Orotina'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Hacienda Vieja'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Orotina'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Coyolar'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Orotina'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'La Ceiba'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Orotina'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Alajuela > San Carlos
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Quesada'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'San Carlos'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Alajuela > Zarcero
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Zarcero'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Zarcero'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Laguna'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Zarcero'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Tapesco'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Zarcero'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Guadalupe'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Zarcero'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Palmira'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Zarcero'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Zapote'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Zarcero'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Brisas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Zarcero'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Alajuela > Río Cuarto
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Río Cuarto'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Río Cuarto'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Santa Rita'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Río Cuarto'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Santa Isabel'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Río Cuarto'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Alajuela'
  WHERE z.nombre = 'SAN RAMÓN'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Cartago > Cartago
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Occidental'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Cartago'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Cartago'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Tierra Blanca'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Cartago'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Cartago'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Cartago > Paraíso
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Llanos de Santa Lucía'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Paraíso'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Cartago'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Cartago > Oreamuno
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Rafael'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Oreamuno'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Cartago'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Potrero Cerrado'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Oreamuno'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Cartago'
  WHERE z.nombre = 'GAM'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Heredia > Sarapiquí
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Puerto Viejo'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Sarapiquí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Heredia'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Guanacaste > Liberia
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Liberia'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Liberia'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Cañas Dulces'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Liberia'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Mayorga'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Liberia'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Nacascolo'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Liberia'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Curubandé'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Liberia'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Guanacaste > Carrillo
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Filadelfia'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Carrillo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Palmira'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Carrillo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Sardinal'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Carrillo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Belén'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Carrillo'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Guanacaste > Nandayure
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Carmona'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Nandayure'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Santa Rita'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Nandayure'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Zapotal'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Nandayure'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Pablo'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Nandayure'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Porvenir'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Nandayure'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Bejuco'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Nandayure'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Guanacaste'
  WHERE z.nombre = 'GUANACASTE'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Puntarenas
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Puntarenas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Pitahaya'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Chomes'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Lepanto'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Paquera'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Manzanillo'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Guacimal'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Barranca'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Isla del Coco'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Cóbano'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Chacarita'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Chira'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Acapulco'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'El Roble'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Arancibia'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puntarenas'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Buenos Aires
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Buenos Aires'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Volcán'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Potrero Grande'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Boruca'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Pilas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Colinas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Chánguena'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Biolley'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Brunka'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Buenos Aires'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Montes de Oro
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Miramar'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Montes de Oro'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'La Unión'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Montes de Oro'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'San Isidro'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Montes de Oro'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'PUNTARENAS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Osa
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Puerto Cortés'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Osa'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Palmar'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Osa'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Sierpe'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Osa'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Bahía Ballena'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Osa'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Piedras Blancas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Osa'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Bahía Drake'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Osa'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Quepos
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Quepos'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Quepos'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'QUEPOS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Savegre'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Quepos'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'QUEPOS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Naranjito'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Quepos'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'QUEPOS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Golfito
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Golfito'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Golfito'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Guaycará'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Golfito'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Pavón'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Golfito'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Parrita
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Parrita'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Parrita'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'QUEPOS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Corredores
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Corredor'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Corredores'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'La Cuesta'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Corredores'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Canoas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Corredores'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Laurel'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Corredores'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Garabito
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Jacó'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Garabito'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'QUEPOS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Tárcoles'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Garabito'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'QUEPOS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Lagunillas'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Garabito'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'QUEPOS'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Puntarenas > Puerto Jiménez
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Puerto Jiménez'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Puerto Jiménez'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Puntarenas'
  WHERE z.nombre = 'ZONA SUR'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
-- Limón > Pococí
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Guápiles'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pococí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Limón'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Jiménez'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pococí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Limón'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Rita'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pococí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Limón'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Roxana'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pococí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Limón'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Cariari'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pococí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Limón'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'Colorado'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pococí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Limón'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, z.id, d.id FROM "zona" z
  JOIN "distrito" d ON d.nombre = 'La Colonia'
  JOIN "canton" c ON c.id = d.canton_id AND c.nombre = 'Pococí'
  JOIN "provincia" p ON p.id = c.provincia_id AND p.nombre = 'Limón'
  WHERE z.nombre = 'LIMÓN ABAJO'
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
