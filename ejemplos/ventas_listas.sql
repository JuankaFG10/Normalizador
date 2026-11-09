-- Ventas con varios productos por venta (valores separados por coma, " y " o salto de línea).
-- Datos repetidos: Cliente, Telefono_Cliente, Fecha y Vendedor se repiten en varias ventas.
-- Cada cliente tiene un solo teléfono, pero un teléfono puede ser de varios clientes (familia).
-- Ejecutar en SQL Server (SSMS o Azure Data Studio)

CREATE TABLE Venta (
    Id_Venta INT NOT NULL,
    Fecha DATE NOT NULL,
    Cliente NVARCHAR(50) NOT NULL,
    Telefono_Cliente NVARCHAR(20) NOT NULL,
    Vendedor NVARCHAR(50) NOT NULL,
    Productos NVARCHAR(200) NOT NULL,
    PRIMARY KEY (Id_Venta)
);
GO

INSERT INTO Venta (Id_Venta, Fecha, Cliente, Telefono_Cliente, Vendedor, Productos) VALUES
(1, '2026-01-05', N'Maria Lopez', N'9988-1122', N'Carlos Mejia', N'Cafe, Pan y Leche'),
(2, '2026-01-05', N'Jose Ramos', N'9955-3344', N'Ana Flores', N'Pan dulce'),
(3, '2026-01-06', N'Maria Lopez', N'9988-1122', N'Carlos Mejia', N'Te
Galletas
Mermelada'),
(4, '2026-01-07', N'Luis Castro', N'3344-5566', N'Ana Flores', N'Cafe y Azucar'),
(5, '2026-01-08', N'Jose Ramos', N'9955-3344', N'Carlos Mejia', N'Queso, Jamon'),
(6, '2026-01-08', N'Rosa Pineda', N'9955-3344', N'Ana Flores', N'Pan y Leche y Huevos'),
(7, '2026-01-09', N'Maria Lopez', N'9988-1122', N'Ana Flores', N'Huevos
Queso'),
(8, '2026-01-10', N'Luis Castro', N'3344-5566', N'Carlos Mejia', N'Cafe'),
(9, '2026-01-10', N'Rosa Pineda', N'9955-3344', N'Carlos Mejia', N'Galletas, Te, Azucar'),
(10, '2026-01-11', N'Jose Ramos', N'9955-3344', N'Ana Flores', N'Pan dulce y Queso');
GO
