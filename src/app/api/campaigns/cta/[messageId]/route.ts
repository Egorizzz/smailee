import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushLead } from "@/lib/services/bitrix";
import { config } from "@/lib/config";
import { notifyOwnerOfHotLead } from "@/server/notifications";

/**
 * Клик по кнопке "Оставить заявку" в письме контент-серии.
 * Ссылка приходит уже размотанной из общего трекинга кликов
 * (/api/track/click/[messageId]?url=...) — здесь создаём Lead и пушим в CRM.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const thanksUrl = `${config.appUrl}/cta-thanks`;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { contact: true, campaign: true },
  });
  if (!message) return NextResponse.redirect(thanksUrl);

  const summary = `Кликнул «Оставить заявку» в письме серии «${message.campaign.seriesTopic ?? message.campaign.name}» (шаг ${message.step}).`;

  const lead = await prisma.lead.upsert({
    where: { messageId },
    update: { qualification: "HOT", summary },
    create: {
      userId: message.campaign.userId,
      messageId,
      qualification: "HOT",
      summary,
    },
  });

  if (!lead.pushedToCrm) {
    const res = await pushLead({
      title: `Smailee: заявка из серии «${message.campaign.seriesTopic ?? message.campaign.name}»`,
      name: message.contact.name,
      email: message.contact.email,
      comment: summary,
    });
    if (res.ok) {
      await prisma.lead.update({ where: { id: lead.id }, data: { pushedToCrm: true } });
    }
    await notifyOwnerOfHotLead({
      userId: message.campaign.userId,
      contactEmail: message.contact.email,
      contactName: message.contact.name,
      summary,
    });
  }

  return NextResponse.redirect(thanksUrl);
}
