CREATE TABLE [dbo].[Cliente](
	[Id_Cliente] [int] NOT NULL,
	[Nombre] [nvarchar](50) NOT NULL,
	[Telefono1] [nvarchar](20) NULL,
	[Telefono2] [nvarchar](20) NULL,
 CONSTRAINT [PK_Cliente] PRIMARY KEY CLUSTERED ([Id_Cliente] ASC)) ON [PRIMARY]
GO
CREATE TABLE [dbo].[Pedido](
	[Id_Cliente] [int] NOT NULL,
	[Id_Producto] [int] NOT NULL,
	[Nombre_Cliente] [nvarchar](50) NOT NULL,
	[Cantidad] [int] NOT NULL,
 CONSTRAINT [PK_Pedido] PRIMARY KEY CLUSTERED ([Id_Cliente] ASC, [Id_Producto] ASC)) ON [PRIMARY]
GO
INSERT [dbo].[Cliente] ([Id_Cliente], [Nombre], [Telefono1], [Telefono2]) VALUES (1, N'Ana', N'111', N'222')
INSERT [dbo].[Cliente] ([Id_Cliente], [Nombre], [Telefono1], [Telefono2]) VALUES (2, N'Luis', N'333', NULL)
GO
INSERT [dbo].[Pedido] ([Id_Cliente], [Id_Producto], [Nombre_Cliente], [Cantidad]) VALUES (1, 10, N'Ana', 2)
INSERT [dbo].[Pedido] ([Id_Cliente], [Id_Producto], [Nombre_Cliente], [Cantidad]) VALUES (1, 11, N'Ana', 1)
INSERT [dbo].[Pedido] ([Id_Cliente], [Id_Producto], [Nombre_Cliente], [Cantidad]) VALUES (2, 10, N'Luis', 5)
GO
ALTER TABLE [dbo].[Pedido]  WITH CHECK ADD  CONSTRAINT [FK_Pedido_Cliente] FOREIGN KEY([Id_Cliente])
REFERENCES [dbo].[Cliente] ([Id_Cliente])
GO
CREATE NONCLUSTERED INDEX [IX_Pedido_Cantidad] ON [dbo].[Pedido] ([Cantidad] ASC)
GO
