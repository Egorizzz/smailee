<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## UI typography contract

- Inside the customer account, counters, metrics, dates, times and other numeric values use the same Commissioner display font as the landing through `metric-number` or `tabular`.
- Interface labels and headings stay in the approved sans/display fonts. Never use all-caps styling (`uppercase`) for filter, field or section labels.

## Product copy contract

- Internal implementation details, provider names, cache durations, budgets, limits and operational rules are not product copy by default.
- Before exposing system information, apply the marketing filter: does the user need it to make a decision or complete the task, and what user value does it communicate?
- Errors shown to users must be concise and actionable. Never render raw validation payloads, stack traces or supplier responses. Show a stable support code; keep diagnostic details only in logs or persisted issue records.

## Contact base context

- Before changing the contact database, AI prospecting, providers, email verification, site enrichment, or search/upload limits, read `docs/contact-base-context.md` and keep it synchronized with material product or architecture decisions.
