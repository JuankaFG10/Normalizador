-- Datos no atómicos para probar 1FN: grupos repetidos (Telefono1..3 y Materia1..2)
-- Ejecutar en SQL Server (SSMS o Azure Data Studio)

CREATE TABLE Empleado (
    Id_Empleado INT NOT NULL,
    Nombre NVARCHAR(50) NOT NULL,
    Telefono1 NVARCHAR(20) NULL,
    Telefono2 NVARCHAR(20) NULL,
    Telefono3 NVARCHAR(20) NULL,
    PRIMARY KEY (Id_Empleado)
);
GO

CREATE TABLE Estudiante (
    Id_Estudiante INT NOT NULL,
    Nombre NVARCHAR(50) NOT NULL,
    Materia1 NVARCHAR(30) NULL,
    Materia2 NVARCHAR(30) NULL,
    PRIMARY KEY (Id_Estudiante)
);
GO

INSERT INTO Empleado (Id_Empleado, Nombre, Telefono1, Telefono2, Telefono3) VALUES
(1, N'Ana Pérez', N'2222-1111', N'3333-2222', NULL),
(2, N'Luis Mejía', N'9999-0000', NULL, NULL),
(3, N'Carla Ruiz', N'8888-1234', N'7777-5678', N'6666-9012');
GO

INSERT INTO Estudiante (Id_Estudiante, Nombre, Materia1, Materia2) VALUES
(10, N'Sofía Díaz', N'Matemáticas', N'Física'),
(11, N'Jorge Soto', N'Historia', NULL),
(12, N'Marta Núñez', N'Inglés', N'Química');
GO
