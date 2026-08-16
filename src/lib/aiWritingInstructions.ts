export function composeAiWritingInstructions(input: {
  dialogStylePrompt?: string | null;
  additionalInstructions?: string | null;
}): string | null {
  const sections: string[] = [];
  if (input.dialogStylePrompt?.trim()) {
    sections.push(
      "Ориентиры, извлечённые из реальных диалогов. Используй их для тона, структуры и типового сценария, но не копируй персональные данные и частные факты из примеров:\n" +
        input.dialogStylePrompt.trim()
    );
  }
  if (input.additionalInstructions?.trim()) {
    sections.push(
      "Дополнительные инструкции организации. Они обязательны и имеют приоритет, если расходятся с ориентирами из диалогов:\n" +
        input.additionalInstructions.trim()
    );
  }
  return sections.length ? sections.join("\n\n") : null;
}
