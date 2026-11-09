-- Ventas con datos para probar el Normalizador
-- Ejecutar en SQL Server (SSMS o Azure Data Studio)

CREATE TABLE Cliente (
    Id_Cliente INT NOT NULL,
    Nombre NVARCHAR(50) NOT NULL,
    Ciudad NVARCHAR(50) NOT NULL,
    Pais NVARCHAR(50) NOT NULL,
    PRIMARY KEY (Id_Cliente)
);
GO

CREATE TABLE Venta (
    Id_Venta INT NOT NULL,
    Id_Cliente INT NOT NULL,
    Fecha DATE NOT NULL,
    PRIMARY KEY (Id_Venta)
);
GO

CREATE TABLE Detalle_Venta (
    Id_Venta INT NOT NULL,
    Id_Producto INT NOT NULL,
    Nombre_Producto NVARCHAR(50) NOT NULL,
    Precio DECIMAL(10,2) NOT NULL,
    Cantidad INT NOT NULL,
    PRIMARY KEY (Id_Venta, Id_Producto)
);
GO

INSERT INTO Cliente (Id_Cliente, Nombre, Ciudad, Pais) VALUES
(1, N'Ana López', N'San Pedro Sula', N'Honduras'),
(2, N'Luis Mejía', N'Tegucigalpa', N'Honduras'),
(3, N'Carla Ruiz', N'Guatemala', N'Guatemala'),
(4, N'Pedro Soto', N'San Pedro Sula', N'Honduras');
GO

INSERT INTO Venta (Id_Venta, Id_Cliente, Fecha) VALUES
(101, 1, '2026-01-10'),
(102, 2, '2026-01-12'),
(103, 1, '2026-02-03'),
(104, 3, '2026-02-15'),
(105, 4, '2026-03-01');
GO

INSERT INTO Detalle_Venta (Id_Venta, Id_Producto, Nombre_Producto, Precio, Cantidad) VALUES
(101, 1, N'Café molido 500g', 85.00, 2),
(101, 2, N'Azúcar 1kg', 32.50, 1),
(102, 1, N'Café molido 500g', 85.00, 1),
(103, 3, N'Té verde 20u', 40.00, 3),
(103, 1, N'Café molido 500g', 85.00, 2),
(104, 2, N'Azúcar 1kg', 32.50, 4),
(105, 3, N'Té verde 20u', 40.00, 1);
GO

ALTER TABLE Venta ADD CONSTRAINT FK_Venta_Cliente FOREIGN KEY (Id_Cliente) REFERENCES Cliente (Id_Cliente);
GO
ALTER TABLE Detalle_Venta ADD CONSTRAINT FK_Detalle_Venta_Venta FOREIGN KEY (Id_Venta) REFERENCES Venta (Id_Venta);
GO
