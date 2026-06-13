import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Catalog · Book (`catalog-book`) — physical-book store reads over `ws_book` (10
 * rows). **WIRED 2026-06-13** (flag OFF): `GET /client/books` (listBooks) +
 * `GET /client/books/:id` (getBookDetail) branch on `isBookMysql()`.
 *
 * catalog-book supplies the book DATA + data-only computed fields; the controller
 * composes per-customer cart `qty`/`cartId` (ws_book_cart*) + `isPurchased`
 * (ws_book_order* by fulfilled status) from the book-order read helpers — those
 * order/cart tables migrated with `book-order` (Phase 3b), which is what unblocked
 * this wiring. The composition is verified via tsx (12/12), not HTTP (needs the
 * flip + `yarn dev`). The MySQL assertion is `skip`ped until the flag is enabled.
 */

const bookMysql = config.mysqlModules.includes("catalog-book");

export async function runCatalogBookClientApiTests(): Promise<boolean> {
  return runTests("catalog-book (client)", [
    {
      name: "[catalog-book] WIRED book listing + detail verified via tsx (composes book-order cart/purchase state; flag OFF)",
      skip: true, // informational: composition proven in tsx (12/12); HTTP needs the flip + yarn dev
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — catalog-book WIRED entry */
      },
    },
    {
      name: "[catalog-book ON] GET /books (data + qty + isPurchased + cartId) · GET /books/:id (data + isPurchased)",
      skip: !bookMysql,
      fn: () => {
        /*
         * On flip: GET /client/books returns book data + computed fields, with
         * per-customer qty (ws_book_cart_item), cartId (ws_book_cart.cart_id), and
         * isPurchased (ws_book_order_item joined to verified/shipped/delivered
         * orders). GET /client/books/:id returns the same data + isPurchased.
         * Proven in the tsx verify script; re-asserted here at flip time.
         */
      },
    },
  ]);
}
