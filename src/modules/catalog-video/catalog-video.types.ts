// Video catalog: DTO and encryption-input types.
export type VideoPlatform = "youtube" | "aws" | "vimeo";
export type VideoPriceType = "free" | "paid";

/** Exact input consumed by `encryptVideoSource`; never reimplement the encryption. */
export interface VideoEncryptInput {
  platform: VideoPlatform;
  youtube_id?: string;
  aws_id?: string;
  vimeo_id?: string;
}

export interface VideoDto {
  _id: string;
  title: string;
  topic: string;
  slug: string;
  platform: VideoPlatform;
  priceType: VideoPriceType;
  youtube_id: string | null;
  aws_id: string | null;
  vimeo_id: string | null;
  videoCategoryId: string | null;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface VideoCategoryDto {
  _id: string;
  title: string;
  slug: string;
  image: string;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
