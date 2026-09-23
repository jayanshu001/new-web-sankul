/**
 * Stable API shape for testimonials (Mongo-compatible for admin / client).
 *
 * Legacy MySQL table `ws_testimonial` has a misspelled column `discription`;
 * the transformer maps it to the API field `description` so the contract
 * served to the React admin / client apps is unchanged.
 */

export interface TestimonialDto {
  _id: string;
  name: string;
  title: string;
  description: string;
  rating: number;
}

/** MySQL create payload (already in API casing). */
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
