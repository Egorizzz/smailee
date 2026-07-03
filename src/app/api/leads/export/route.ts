import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// GET /api/leads/export — выгрузка заявок с лендинга в .xlsx
// Доступ только авторизованному пользователю (админка ЛК).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const leads = await prisma.landingLead.findMany({
    orderBy: { createdAt: "desc" },
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Заявки");
  ws.columns = [
    { header: "Дата", key: "createdAt", width: 20 },
    { header: "Имя", key: "name", width: 24 },
    { header: "Email", key: "email", width: 28 },
    { header: "Мессенджер", key: "messenger", width: 20 },
    { header: "Источник", key: "source", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const l of leads) {
    ws.addRow({
      createdAt: l.createdAt.toLocaleString("ru-RU"),
      name: l.name,
      email: l.email,
      messenger: l.messenger ?? "",
      source: l.source ?? "",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="smailee-leads.xlsx"`,
    },
  });
}
