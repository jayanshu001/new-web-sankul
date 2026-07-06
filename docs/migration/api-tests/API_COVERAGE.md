# Migration API coverage (migrated modules)

Endpoints exercised by `yarn migration:api`. **Write tests run by default** (revert after PUT where noted).

| Module | Method | Path | Test file |
|--------|--------|------|-----------|
| **app-update** | GET | `/api/v1/admin/cms/app-update` | app-update/admin |
| | PUT | `/api/v1/admin/cms/app-update` | app-update/admin (revert) |
| | GET | `/api/v1/client/upgrade` | app-update/client |
| **version** | GET | `/api/v1/admin/cms/version` | version/admin |
| | PUT | `/api/v1/admin/cms/version` | version/admin (revert) |
| | GET | `/api/v1/client/version` | version/client |
| | GET | `/api/v1/client/upgrade` | version/client, app-update/client |
| **faq** | GET | `/api/v1/admin/cms/faq-types` | faq/admin |
| | DELETE | `/api/v1/admin/cms/faq-types/:id` | faq/admin (expects **400** on MySQL) |
| | GET | `/api/v1/admin/cms/faqs` | faq/admin |
| | GET | `/api/v1/admin/cms/faqs/:id` | faq/admin |
| | POST | `/api/v1/admin/cms/faqs` | faq/admin |
| | PUT | `/api/v1/admin/cms/faqs/:id` | faq/admin |
| | DELETE | `/api/v1/admin/cms/faqs/:id` | faq/admin |
| | GET | `/api/v1/client/faq-types` | faq/client |
| | GET | `/api/v1/client/faqs?type=general` | faq/client |
| | GET | `/api/v1/client/faqs?type=referral` | faq/client |

### Not on MySQL (by design)

On `MIGRATION_MYSQL_MODULES` including `faq`, these admin routes still use Mongo handlers or fixed enums:

- `POST/PUT/GET /admin/cms/faq-types` (except list) — categories are enum `general` \| `referral`
- Use list + FAQ CRUD with body field `type` instead

---

To skip mutating data: `MIGRATION_API_SKIP_WRITE=true yarn migration:api`
