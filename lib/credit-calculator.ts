import type { Message, FileData } from "@/types/workspace";

export function calculateGenerationCost(messages: Message[]): number {
  let cost = 1; // Base cost

  if (!messages || messages.length === 0) return cost;

  // Check if any message contains an image
  const hasImage = messages.some((msg) => !!msg.imageUrl);
  if (hasImage) {
    cost += 1;
  }

  // Check if the latest prompt is exceptionally long
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.content.length > 500) {
    cost += 1;
  }

  return cost;
}

export function calculateImprovementCost(
  fileData: FileData | null,
  userRequest: string
): number {
  let cost = 2; // Agent base cost is higher due to loops

  // Check workspace size complexity
  if (fileData && fileData.files) {
    const fileCount = Object.keys(fileData.files).length;
    if (fileCount > 10) {
      cost += 1;
    }
  }

  // Check prompt complexity
  if (userRequest && userRequest.length > 500) {
    cost += 1;
  }

  return cost;
}
