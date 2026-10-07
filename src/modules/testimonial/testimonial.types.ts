// Testimonials: DTO and input types.
export interface TestimonialDto {
  _id: string;
  name: string;
  title: string;
  description: string;
  rating: number;
}

export interface TestimonialCreateInput {
  name: string;
  title: string;
  description: string;
  rating: number;
}

export interface TestimonialUpdateInput {
  name?: string;
  title?: string;
  description?: string;
  rating?: number;
}
