// Package chat: DTO and input types.
export type ChatMediaType = "image" | "video" | "pdf" | "audio" | "other";
export type ChatSenderType = "admin" | "system";

export interface PackageChatDto {
  _id: string;
  packageId: string;
  text: string;
  mediaUrl: string | null;
  mediaType: ChatMediaType | null;
  senderType: ChatSenderType;
  /** Varchar admin id, or null for system posts. */
  senderId: string | null;
  pushSent: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface PackageChatPage {
  data: PackageChatDto[];
  total: number;
}

export interface PostChatInput {
  packageId: number;
  text?: string;
  mediaUrl?: string;
  mediaType?: ChatMediaType;
  senderId?: string | null;
  senderType?: ChatSenderType;
}
