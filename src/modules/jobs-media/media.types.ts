export interface MediaDto {
  _id: string;
  url: string;
  altText?: string;
  width?: number;
  height?: number;
}

export interface MediaCreateInput {
  url: string;
  altText?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  sizeBytes?: number;
}
